/**
 * Azure AI Speech text-to-speech over the REST API
 * (`POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`).
 *
 * Long text is split into chunks under the per-request limits, each chunk is sent as
 * its own SSML document, and the MP3 responses are concatenated (constant-bitrate MP3
 * frames join without re-encoding). Rate limits, outages, timeouts and network errors
 * are retried with exponential backoff; everything else maps onto {@link ProviderError}.
 */
import type { LectioConfig } from '@lectio/config';
import { ProviderError } from '@lectio/providers';
import type { TtsFormat, TtsProvider, TtsRequest, TtsResult } from '@lectio/providers';

import { chunkText, codePointLength } from './chunk.ts';
import { buildSsml, stripInvalidXmlChars, voiceLocale } from './ssml.ts';

/** Azure output format: 24 kHz, 48 kbit/s constant-bitrate mono MP3. */
export const AZURE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
/** Bit rate of {@link AZURE_OUTPUT_FORMAT}, used to compute durations from byte counts. */
export const AZURE_MP3_BITRATE = 48_000;
/**
 * Default code points of text per request. Azure caps one request at 10 minutes of audio
 * and 64 KiB of SSML; 3000 characters is roughly 3–4 minutes of speech and stays far
 * under the SSML size even when every character needs escaping.
 */
export const DEFAULT_MAX_CHUNK_CHARS = 3000;
/** Hard ceiling on `maxChunkChars`, keeping the escaped SSML well under 64 KiB. */
export const MAX_CHUNK_CHARS_LIMIT = 5000;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8000;
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Environment variable holding the Speech resource key. */
export const AZURE_SPEECH_KEY_ENV = 'AZURE_SPEECH_KEY';
/** Environment variable holding the Speech resource region (for example `westeurope`). */
export const AZURE_SPEECH_REGION_ENV = 'AZURE_SPEECH_REGION';

export interface AzureTtsOptions {
  /** Speech resource key (sent as `Ocp-Apim-Subscription-Key`). */
  readonly key: string;
  /** Speech resource region, for example `westeurope`. Ignored when `endpoint` is set. */
  readonly region?: string;
  /** Full synthesis URL (https only), overriding the one derived from `region`. */
  readonly endpoint?: string;
  /** Code points of text per request (default {@link DEFAULT_MAX_CHUNK_CHARS}). */
  readonly maxChunkChars?: number;
  /** Attempts per chunk, including the first (default {@link DEFAULT_MAX_ATTEMPTS}). */
  readonly maxAttempts?: number;
  /** First retry delay; doubles on each retry up to `maxDelayMs`. A non-negative integer. */
  readonly baseDelayMs?: number;
  /**
   * Longest wait between attempts, at least `baseDelayMs`. A `Retry-After` longer than this stops
   * the retries instead of being shortened, so a throttled resource is not hammered.
   */
  readonly maxDelayMs?: number;
  /** Per-request timeout. */
  readonly timeoutMs?: number;
  /** Injected for tests; defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Injected for tests; defaults to a `setTimeout` promise. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** `User-Agent` header (Azure requires one). */
  readonly userAgent?: string;
}

const REGION = /^[a-z0-9]+$/;

/** The synthesis endpoint for a Speech resource region. */
export function azureTtsEndpoint(region: string): string {
  if (!REGION.test(region)) {
    throw new ProviderError('invalid-request', `not an Azure region name: "${region}" (expected e.g. westeurope)`);
  }
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

/** Playback length of constant-bitrate MP3 bytes in {@link AZURE_OUTPUT_FORMAT}. */
export function mp3DurationMs(bytes: number): number {
  return Math.round((bytes * 8 * 1000) / AZURE_MP3_BITRATE);
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInteger(name: string, value: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}, got ${value}`);
  }
  return value;
}

const positiveInteger = (name: string, value: number, max?: number): number => boundedInteger(name, value, 1, max);

/** An endpoint override: an absolute https URL, since the request carries the resource key. */
function httpsEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProviderError('invalid-request', `Azure Speech endpoint is not a URL: "${endpoint}"`);
  }
  if (url.protocol !== 'https:') {
    throw new ProviderError('invalid-request', `Azure Speech endpoint must use https: "${endpoint}"`);
  }
  return endpoint;
}

/** Seconds (or an HTTP date) from a `Retry-After` header, as milliseconds; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Maps an unsuccessful Azure response onto a {@link ProviderError}. */
export function errorForStatus(status: number, detail: string): ProviderError {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) {
    return new ProviderError(
      'invalid-request',
      `Azure Speech rejected the credentials (${status}); check ${AZURE_SPEECH_KEY_ENV} and ${AZURE_SPEECH_REGION_ENV}${suffix}`,
      { retryable: false },
    );
  }
  if (status === 404) return new ProviderError('not-found', `Azure Speech endpoint not found (404)${suffix}`);
  if (status === 408) return new ProviderError('timeout', `Azure Speech timed out (408)${suffix}`);
  if (status === 429) return new ProviderError('rate-limited', `Azure Speech rate limit (429)${suffix}`);
  if (status >= 500) return new ProviderError('unavailable', `Azure Speech unavailable (${status})${suffix}`);
  return new ProviderError('invalid-request', `Azure Speech rejected the request (${status})${suffix}`);
}

function errorForThrown(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProviderError('timeout', `Azure Speech request timed out: ${message}`, { cause: error });
  }
  return new ProviderError('unavailable', `Azure Speech request failed: ${message}`, { cause: error });
}

/** Text-to-speech through Azure AI Speech. Produces mono MP3. */
export class AzureTtsProvider implements TtsProvider {
  readonly formats: readonly TtsFormat[] = ['mp3'];

  readonly #key: string;
  readonly #endpoint: string;
  readonly #maxChunkChars: number;
  readonly #maxAttempts: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #userAgent: string;

  constructor(options: AzureTtsOptions) {
    if (options.key.trim() === '') throw new ProviderError('invalid-request', 'Azure Speech key is empty');
    if (options.endpoint !== undefined) {
      this.#endpoint = httpsEndpoint(options.endpoint);
    } else if (options.region !== undefined) {
      this.#endpoint = azureTtsEndpoint(options.region);
    } else {
      throw new ProviderError('invalid-request', 'Azure Speech needs a region or an endpoint');
    }
    this.#key = options.key;
    this.#maxChunkChars = positiveInteger(
      'maxChunkChars',
      options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS,
      MAX_CHUNK_CHARS_LIMIT,
    );
    this.#maxAttempts = positiveInteger('maxAttempts', options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.#baseDelayMs = boundedInteger('baseDelayMs', options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS, 0);
    this.#maxDelayMs = boundedInteger('maxDelayMs', options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS, this.#baseDelayMs);
    this.#timeoutMs = positiveInteger('timeoutMs', options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#userAgent = options.userAgent ?? 'lectio-tts';
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (request.format !== 'mp3') {
      throw new ProviderError('unsupported', `Azure TTS here produces mp3 only, not ${request.format}`);
    }
    voiceLocale(request.voice); // validates before any request is sent
    const chunks = chunkText(stripInvalidXmlChars(request.text), this.#maxChunkChars);
    if (chunks.length === 0) throw new ProviderError('invalid-request', 'nothing to synthesize');

    const parts: Uint8Array[] = [];
    for (const chunk of chunks) parts.push(await this.#synthesizeChunk(buildSsml(chunk, request.voice)));
    const audio = concat(parts);
    return {
      audio,
      format: 'mp3',
      contentType: 'audio/mpeg',
      durationMs: mp3DurationMs(audio.length),
      characters: codePointLength(request.text),
    };
  }

  async #synthesizeChunk(ssml: string): Promise<Uint8Array> {
    for (let attempt = 1; ; attempt++) {
      let error: ProviderError;
      let wait: number | undefined;
      try {
        const response = await this.#fetch(this.#endpoint, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': this.#key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': AZURE_OUTPUT_FORMAT,
            'User-Agent': this.#userAgent,
          },
          body: ssml,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (response.ok) {
          const audio = new Uint8Array(await response.arrayBuffer());
          if (audio.length === 0) throw new ProviderError('malformed-output', 'Azure Speech returned no audio');
          return audio;
        }
        const detail = (await response.text().catch(() => '')).trim().slice(0, 200);
        error = errorForStatus(response.status, detail);
        wait = retryAfterMs(response.headers.get('retry-after'));
      } catch (thrown) {
        error = errorForThrown(thrown);
      }
      if (!error.retryable || attempt >= this.#maxAttempts) throw error;
      if (wait !== undefined && wait > this.#maxDelayMs) {
        // Waiting less than the service asked for would only be throttled again: stop, and say so.
        throw new ProviderError(
          error.code,
          `${error.message}; Retry-After of ${String(Math.ceil(wait / 1000))} s exceeds the ${String(this.#maxDelayMs)} ms retry cap, giving up`,
          { retryable: false, cause: error },
        );
      }
      const backoff = Math.min(this.#maxDelayMs, this.#baseDelayMs * 2 ** (attempt - 1));
      await this.#sleep(wait ?? backoff);
    }
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** True when `env` holds what {@link azureTtsFromEnv} needs. */
export function hasAzureTtsSecrets(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env[AZURE_SPEECH_KEY_ENV]?.trim() && env[AZURE_SPEECH_REGION_ENV]?.trim());
}

/** An {@link AzureTtsProvider} from `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`; throws when either is missing. */
export function azureTtsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: Omit<AzureTtsOptions, 'key' | 'region'> = {},
): AzureTtsProvider {
  const key = env[AZURE_SPEECH_KEY_ENV]?.trim();
  const region = env[AZURE_SPEECH_REGION_ENV]?.trim();
  if (!key || !region) {
    throw new ProviderError(
      'invalid-request',
      `Azure TTS needs ${AZURE_SPEECH_KEY_ENV} and ${AZURE_SPEECH_REGION_ENV} in the environment`,
    );
  }
  return new AzureTtsProvider({ ...options, key, region });
}

/**
 * A `createProviders` live factory for the `tts` slot:
 * `createProviders(config, env, { tts: azureTts })`.
 */
export function azureTts(context: { readonly env: Readonly<Record<string, string | undefined>> }): AzureTtsProvider {
  return azureTtsFromEnv(context.env);
}

/** The configured voice for `locale` (`config.tts.voices`). */
export function voiceFor(config: Pick<LectioConfig, 'tts'>, locale: string): string {
  const voice = config.tts.voices[locale];
  if (voice === undefined) {
    throw new ProviderError('invalid-request', `no TTS voice configured for locale "${locale}" (config.tts.voices)`);
  }
  return voice;
}
