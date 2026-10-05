/**
 * Test doubles for the service worker: an in-memory Cache Storage (insertion-ordered, like the real one), a fake
 * network keyed by URL and a fake worker scope that records its listeners. No real network is ever touched.
 */
import type { FetchEventLike, MessageEventLike, WaitUntilEvent, WorkerEnv, WorkerScope } from '../worker.ts';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export class FakeCache {
  readonly entries = new Map<string, Response>();

  private readonly network: FakeNetwork | undefined;

  constructor(network?: FakeNetwork) {
    this.network = network;
  }

  match(input: RequestInfo | URL): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(urlOf(input))?.clone());
  }

  put(input: RequestInfo | URL, response: Response): Promise<void> {
    const url = urlOf(input);
    this.entries.delete(url);
    this.entries.set(url, response);
    return Promise.resolve();
  }

  delete(input: RequestInfo | URL): Promise<boolean> {
    return Promise.resolve(this.entries.delete(urlOf(input)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(url)));
  }

  async addAll(urls: string[]): Promise<void> {
    const network = this.network;
    if (network === undefined) throw new Error('no network');
    const responses = await Promise.all(urls.map((url) => network.fetch(url)));
    responses.forEach((response, i) => {
      if (!response.ok) throw new TypeError(`addAll: ${String(response.status)} for ${urls[i] ?? ''}`);
    });
    for (const [i, response] of responses.entries()) await this.put(urls[i] ?? '', response);
  }

  urls(): string[] {
    return [...this.entries.keys()];
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();

  private readonly network: FakeNetwork | undefined;

  constructor(network?: FakeNetwork) {
    this.network = network;
  }

  open(name: string): Promise<Cache> {
    let cache = this.stores.get(name);
    if (cache === undefined) {
      cache = new FakeCache(this.network);
      this.stores.set(name, cache);
    }
    return Promise.resolve(cache as unknown as Cache);
  }

  match(input: RequestInfo | URL, options: { cacheName?: string } = {}): Promise<Response | undefined> {
    const stores = options.cacheName === undefined ? [...this.stores.values()] : [this.stores.get(options.cacheName)];
    return stores.reduce<Promise<Response | undefined>>(
      async (found, store) => (await found) ?? store?.match(input),
      Promise.resolve(undefined),
    );
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }

  get(name: string): FakeCache | undefined {
    return this.stores.get(name);
  }
}

type Route = string | (() => Response) | Error | { status: number; body?: string; redirected?: boolean };

export class FakeNetwork {
  readonly routes = new Map<string, Route>();
  readonly requests: string[] = [];

  route(url: string, response: Route): this {
    this.routes.set(url, response);
    return this;
  }

  fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = urlOf(input);
    this.requests.push(url);
    const route = this.routes.get(url);
    if (route === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    if (route instanceof Error) return Promise.reject(route);
    if (typeof route === 'function') return Promise.resolve(route());
    if (typeof route === 'string') return Promise.resolve(new Response(route, { status: 200 }));
    const response = new Response(route.body ?? '', { status: route.status });
    if (route.redirected === true) Object.defineProperty(response, 'redirected', { value: true });
    return Promise.resolve(response);
  };
}

/** A request as the worker sees it; `mode: 'navigate'` cannot be built with `new Request` outside a browser. */
export function fakeRequest(url: string, init: { method?: string; mode?: string } = {}): Request {
  return { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' } as unknown as Request;
}

type Listener = (event: never) => void;

export class FakeScope implements WorkerScope {
  readonly listeners = new Map<string, Listener>();
  skipped = 0;
  claimed = 0;
  readonly clients = {
    claim: (): Promise<void> => {
      this.claimed += 1;
      return Promise.resolve();
    },
  };

  readonly registration: { readonly scope: string };

  constructor(registration: { readonly scope: string }) {
    this.registration = registration;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  skipWaiting(): Promise<void> {
    this.skipped += 1;
    return Promise.resolve();
  }

  /** Dispatches an extendable event and resolves once everything it waited on has settled. */
  async dispatch(type: 'install' | 'activate'): Promise<void> {
    const waits: Promise<unknown>[] = [];
    const event: WaitUntilEvent = { waitUntil: (promise) => void waits.push(promise) };
    (this.listeners.get(type) as ((event: WaitUntilEvent) => void) | undefined)?.(event);
    await Promise.all(waits);
  }

  async message(data: unknown): Promise<number> {
    const waits: Promise<unknown>[] = [];
    const event: MessageEventLike = { data, waitUntil: (promise) => void waits.push(promise) };
    (this.listeners.get('message') as ((event: MessageEventLike) => void) | undefined)?.(event);
    await Promise.all(waits);
    return waits.length;
  }

  /** Dispatches a fetch event; resolves to the response, or `null` when the worker did not answer. */
  async fetch(request: Request): Promise<{ response: Response | null; waits: Promise<unknown>[] }> {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | null = null;
    const event: FetchEventLike = {
      request,
      waitUntil: (promise) => void waits.push(promise),
      respondWith: (response) => {
        answer = response;
      },
    };
    (this.listeners.get('fetch') as ((event: FetchEventLike) => void) | undefined)?.(event);
    const response = answer === null ? null : await (answer as Promise<Response>);
    await Promise.all(waits);
    return { response, waits };
  }
}

/** A worker environment over a fake network and fake caches, at a fixed time that tests can move. */
export function fakeEnv(network: FakeNetwork, caches: FakeCacheStorage, clock = { now: 0 }): WorkerEnv {
  return { caches: caches as unknown as CacheStorage, fetch: network.fetch, now: () => clock.now };
}
