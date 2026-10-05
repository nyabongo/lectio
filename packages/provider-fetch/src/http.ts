/**
 * The HTTP core shared by the live fetcher and downloader: a fixed User-Agent, a per-attempt timeout, retries with
 * exponential backoff (honouring `Retry-After`), a response size cap, and redirects followed by hand so every hop
 * is checked (SSRF guard, then for example robots.txt) and the final URL is known.
 */
import { ProviderError } from '@lectio/providers';

import { assertPublicUrl, systemResolveHost } from './ssrf.ts';
import type { ResolveHost } from './ssrf.ts';

/** The User-Agent every Lectio request sends. Its product token (`LectioBot`) is what robots.txt groups match. */
export const USER_AGENT = 'LectioBot (+https://github.com/nyabongo/lectio)';

/** Statuses worth retrying: request timeout, rate limit, and transient server failures. */
const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export interface HttpOptions {
  /** The fetch implementation. Defaults to Node's global fetch (intercepted by msw in unit tests). */
  readonly fetch?: typeof fetch;
  /** Defaults to {@link USER_AGENT}. */
  readonly userAgent?: string;
  /** Timeout of each attempt, body included, in milliseconds. */
  readonly timeoutMs?: number;
  /** Retries after the first attempt for retryable failures (408, 429, 5xx, network errors, timeouts). Default 3. */
  readonly retries?: number;
  /** First backoff delay; doubled on each retry. Default 500 ms. */
  readonly backoffMs?: number;
  /** Ceiling for any single delay, `Retry-After` included. Default 30 s. */
  readonly maxBackoffMs?: number;
  /** Redirects followed before giving up. Default 10. */
  readonly maxRedirects?: number;
  /** How to wait between retries. Injectable so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Largest response body accepted, in bytes. A larger `Content-Length` is refused before reading; a body that
   * streams past the cap is cancelled. Either way the request fails without retrying.
   */
  readonly maxBytes?: number;
  /** Resolves hostnames for the SSRF guard. Default: `dns.promises.lookup`. Tests inject a fake to stay offline. */
  readonly resolveHost?: ResolveHost;
  /** Turns the SSRF guard off (loopback, private and link-local hosts allowed). Never set it in CI. Default false. */
  readonly allowPrivateHosts?: boolean;
}

export interface HttpResult {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
  /** The URL that produced this response, after redirects. */
  readonly url: string;
}

export interface GetOptions {
  readonly accept?: string;
  /** Called before each request, the first and every redirect target; it may throw to stop the fetch. */
  readonly beforeRequest?: (url: URL) => Promise<void>;
  /** A smaller (or larger) size cap for this request than the client's `maxBytes`. */
  readonly maxBytes?: number;
  /** What to do with a body over the cap: fail (default) or keep its first `maxBytes` bytes. */
  readonly overflow?: 'error' | 'truncate';
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Parses a URL and refuses anything but http(s). */
export function parseHttpUrl(url: string): URL {
  const parsed = URL.parse(url);
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new ProviderError('invalid-request', `not an http(s) URL: ${url}`);
  }
  return parsed;
}

/** Milliseconds a `Retry-After` header asks for (delta-seconds or an HTTP date), or undefined. */
export function retryAfterMs(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function failure(error: unknown, url: string, timeoutMs: number): ProviderError {
  if (error instanceof ProviderError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProviderError('timeout', `GET ${url}: timed out after ${timeoutMs} ms`, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError('unavailable', `GET ${url}: ${message}`, { cause: error });
}

type Attempt = Omit<HttpResult, 'url'>;

interface Limits {
  readonly maxBytes: number;
  readonly overflow: 'error' | 'truncate';
}

function tooLarge(url: string, maxBytes: number): ProviderError {
  return new ProviderError('unsupported', `GET ${url}: response larger than ${maxBytes} bytes`, { retryable: false });
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Reads a body up to `maxBytes`, refusing an oversized Content-Length up front and cancelling an oversized stream. */
async function readBody(response: Response, url: string, { maxBytes, overflow }: Limits): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const length = Number(response.headers.get('content-length') ?? Number.NaN);
  if (overflow === 'error' && length > maxBytes) {
    await response.body.cancel();
    throw tooLarge(url, maxBytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) {
      await reader.cancel();
      if (overflow === 'error') throw tooLarge(url, maxBytes);
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  return concat(chunks, total);
}

export class HttpClient {
  readonly #fetch: typeof fetch;
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #backoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #maxRedirects: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxBytes: number;
  readonly #resolveHost: ResolveHost;
  readonly #allowPrivateHosts: boolean;

  constructor(options: HttpOptions, defaults: { readonly timeoutMs: number; readonly maxBytes: number }) {
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#userAgent = options.userAgent ?? USER_AGENT;
    this.#timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
    this.#maxBytes = options.maxBytes ?? defaults.maxBytes;
    this.#resolveHost = options.resolveHost ?? systemResolveHost;
    this.#allowPrivateHosts = options.allowPrivateHosts ?? false;
    this.#retries = options.retries ?? 3;
    this.#backoffMs = options.backoffMs ?? 500;
    this.#maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.#maxRedirects = options.maxRedirects ?? 10;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  get userAgent(): string {
    return this.#userAgent;
  }

  /**
   * GETs `url`, following redirects. Every hop must pass the SSRF guard. HTTP errors resolve with their status;
   * network failures, refused hosts, oversized bodies and a redirect without `Location` reject.
   */
  async get(url: string, options: GetOptions = {}): Promise<HttpResult> {
    const limits: Limits = { maxBytes: options.maxBytes ?? this.#maxBytes, overflow: options.overflow ?? 'error' };
    let current = parseHttpUrl(url);
    for (let hop = 0; ; hop += 1) {
      if (!this.#allowPrivateHosts) await assertPublicUrl(current, this.#resolveHost);
      await options.beforeRequest?.(current);
      const result = await this.#withRetries(current.href, options.accept ?? '*/*', limits);
      if (result.status < 300 || result.status >= 400) return { ...result, url: current.href };
      const location = result.headers.get('location');
      if (location === null) {
        throw new ProviderError('unavailable', `GET ${current.href}: HTTP ${result.status} without a Location header`, {
          retryable: false,
        });
      }
      if (hop >= this.#maxRedirects) {
        throw new ProviderError('unavailable', `GET ${url}: more than ${this.#maxRedirects} redirects`, {
          retryable: false,
        });
      }
      current = parseHttpUrl(new URL(location, current).href);
    }
  }

  async #withRetries(url: string, accept: string, limits: Limits): Promise<Attempt> {
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= this.#retries;
      let asked: number | undefined;
      try {
        const result = await this.#once(url, accept, limits);
        if (last || !RETRY_STATUSES.has(result.status)) return result;
        asked = retryAfterMs(result.headers.get('retry-after'));
      } catch (error) {
        const failed = failure(error, url, this.#timeoutMs);
        if (last || !failed.retryable) throw failed;
      }
      await this.#sleep(Math.min(asked ?? this.#backoffMs * 2 ** attempt, this.#maxBackoffMs));
    }
  }

  async #once(url: string, accept: string, limits: Limits): Promise<Attempt> {
    const response = await this.#fetch(url, {
      headers: { 'user-agent': this.#userAgent, accept },
      redirect: 'manual',
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const body = await readBody(response, url, limits);
    return { status: response.status, headers: response.headers, body };
  }
}
