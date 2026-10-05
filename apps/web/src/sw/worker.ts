/**
 * The service worker's behaviour (L-061), written against small interfaces so it runs in the browser bundle
 * (`index.ts` hands it `self`, `caches` and `fetch`) and in unit tests with fakes. The policy (cache names,
 * strategies, the next seven days, the LRU trim) is in `src/lib/sw-policy.ts`.
 *
 * - install: precache the app shell into `lectio-shell-<version>`.
 * - activate: delete older shell and search caches, take control of open pages, then cache the next seven days from
 *   the device date (day page, Reading pages, day JSON) into `lectio-data-upcoming`, refreshing what is there.
 * - message `prefetch` (sent by every page on open, with the page's own date): the same, keeping what is cached;
 *   `skip-waiting` (the update toast's Reload button); `clear-offline-data` (deletes every `lectio-data-` cache).
 * - fetch: hashed assets cache first; pages and API JSON stale-while-revalidate (visited ones kept in
 *   `lectio-data-visited`, at most `VISITED_CACHE_LIMIT`, least recently used dropped first); a page that is
 *   neither cached nor reachable gets the offline page; the Pagefind bundle stale-while-revalidate in its own cache.
 */
import {
  OFFLINE_PAGE,
  VISITED_CACHE_LIMIT,
  cacheKey,
  cacheNames,
  dayDataUrl,
  dayPageUrls,
  daySlots,
  deviceDate,
  indexDates,
  indexUrl,
  isObsoleteCache,
  isOfflineDataCache,
  lruEvictions,
  parseClientMessage,
  requestStrategy,
  scopeUrl,
  shouldPrefetch,
  upcomingDates,
} from '../lib/sw-policy.ts';
import type { ServiceWorkerConfig, Strategy } from '../lib/sw-policy.ts';

/** An event whose work the browser waits for (`ExtendableEvent`). */
export interface WaitUntilEvent {
  waitUntil(promise: Promise<unknown>): void;
}

/** The slice of `FetchEvent` the worker uses. */
export interface FetchEventLike extends WaitUntilEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

/** The slice of `ExtendableMessageEvent` the worker uses. */
export interface MessageEventLike extends WaitUntilEvent {
  readonly data: unknown;
}

/** The slice of `ServiceWorkerGlobalScope` the worker uses. */
export interface WorkerScope {
  addEventListener(type: 'install' | 'activate', listener: (event: WaitUntilEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  readonly registration: { readonly scope: string };
}

/** What the worker reaches outside itself. */
export interface WorkerEnv {
  readonly caches: Pick<CacheStorage, 'open' | 'keys' | 'delete' | 'match'>;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Milliseconds since the epoch (`Date.now`). */
  readonly now: () => number;
}

/** The worker's operations; `installWorker` wires them to the scope's events (tests call them directly). */
export interface LectioWorker {
  install(): Promise<void>;
  activate(): Promise<void>;
  /** Caches the next seven days from `today`; `refresh` refetches pages already cached. Returns the dates cached. */
  prefetch(today: string, refresh?: boolean): Promise<string[]>;
  clearOfflineData(): Promise<number>;
  /** Whether a page's prefetch request for `today` should run now (the date changed or the last run is old). */
  wantsPrefetch(today: string): boolean;
  /** The response for a request, or `null` when the worker leaves it to the browser. */
  respond(request: Request, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> | null;
}

/** True when a response may be stored: a same-origin 200 that was not redirected. */
function storable(response: Response): boolean {
  return response.ok && response.type !== 'opaque' && !response.redirected;
}

export function createWorker(scope: WorkerScope, config: ServiceWorkerConfig, env: WorkerEnv): LectioWorker {
  const names = cacheNames(config.version);
  const root = scope.registration.scope;
  let lastPrefetch: { today: string; at: number } | null = null;
  // Prefetch runs one at a time, so an activate run never prunes what a page's run just stored.
  let queue: Promise<unknown> = Promise.resolve();

  async function fetchStorable(url: string): Promise<Response | null> {
    try {
      const response = await env.fetch(url, { cache: 'no-cache' });
      return storable(response) ? response : null;
    } catch {
      return null;
    }
  }

  async function runPrefetch(today: string, refresh: boolean): Promise<string[]> {
    const indexResponse = await fetchStorable(indexUrl(root));
    if (indexResponse === null) return [];
    let index: unknown;
    try {
      index = await indexResponse.json();
    } catch {
      return [];
    }
    const dates = upcomingDates(today, indexDates(index));
    const cache = await env.caches.open(names.upcoming);
    const keep = new Set<string>();
    const cached: string[] = [];
    let complete = true;
    for (const date of dates) {
      const dataUrl = dayDataUrl(root, date);
      const dayResponse = await fetchStorable(dataUrl);
      let day: unknown;
      try {
        day = await dayResponse?.clone().json();
      } catch {
        day = undefined;
      }
      if (dayResponse === null || day === undefined) {
        complete = false;
        continue;
      }
      await cache.put(dataUrl, dayResponse);
      keep.add(dataUrl);
      for (const url of dayPageUrls(root, date, daySlots(day))) {
        keep.add(url);
        if (!refresh && (await cache.match(url)) !== undefined) continue;
        const page = await fetchStorable(url);
        if (page !== null) await cache.put(url, page);
        else complete = false;
      }
      cached.push(date);
    }
    // Drop days that are no longer upcoming, but only after a clean run (offline, keep what there is).
    if (complete) for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
    return cached;
  }

  function prefetch(today: string, refresh = false): Promise<string[]> {
    lastPrefetch = { today, at: env.now() };
    const run = queue.then(() => runPrefetch(today, refresh));
    queue = run.catch(() => undefined);
    return run;
  }

  async function install(): Promise<void> {
    const cache = await env.caches.open(names.shell);
    await cache.addAll(config.precache.map((path) => scopeUrl(root, path)));
  }

  async function activate(): Promise<void> {
    const keys = await env.caches.keys();
    await Promise.all(
      keys.filter((name) => isObsoleteCache(name, config.version)).map((name) => env.caches.delete(name)),
    );
    await scope.clients.claim();
    // A new build may change pages' asset URLs, so refetch the upcoming pages rather than keep older copies.
    await prefetch(deviceDate(new Date(env.now())), true);
  }

  async function clearOfflineData(): Promise<number> {
    const data = (await env.caches.keys()).filter(isOfflineDataCache);
    const deleted = await Promise.all(data.map((name) => env.caches.delete(name)));
    lastPrefetch = null;
    return deleted.filter(Boolean).length;
  }

  async function lookup(key: string, order: readonly string[]): Promise<{ response: Response; cache: string } | null> {
    // `caches.match` with a cache name does not create the cache, unlike `caches.open`.
    for (const name of order) {
      const response = await env.caches.match(key, { cacheName: name });
      if (response !== undefined) return { response, cache: name };
    }
    return null;
  }

  /** Fetches `request` and stores a good response under `key` in `target`; rejects when the network fails. */
  async function revalidate(request: Request, key: string, target: string): Promise<Response> {
    const response = await env.fetch(request);
    if (storable(response)) {
      const cache = await env.caches.open(target);
      if (target === names.visited) {
        // Delete first so the entry moves to the end of the insertion order, which is the LRU order.
        await cache.delete(key);
        await cache.put(key, response.clone());
        const keys = (await cache.keys()).map((entry) => entry.url);
        for (const stale of lruEvictions(keys, VISITED_CACHE_LIMIT)) await cache.delete(stale);
      } else await cache.put(key, response.clone());
    }
    return response;
  }

  async function asset(request: Request): Promise<Response> {
    const cache = await env.caches.open(names.shell);
    const hit = await cache.match(request.url);
    if (hit !== undefined) return hit;
    try {
      const response = await env.fetch(request);
      if (storable(response)) await cache.put(request.url, response.clone());
      return response;
    } catch {
      return Response.error();
    }
  }

  async function staleWhileRevalidate(
    request: Request,
    strategy: Exclude<Strategy, 'asset' | 'network'>,
    waitUntil: (promise: Promise<unknown>) => void,
  ): Promise<Response> {
    const search = strategy === 'search';
    const key = search ? request.url : cacheKey(request.url);
    const order = search
      ? [names.search]
      : strategy === 'page'
        ? [names.visited, names.upcoming, names.shell]
        : [names.visited, names.upcoming];
    const hit = await lookup(key, order);
    const target = search ? names.search : hit?.cache === names.upcoming ? names.upcoming : names.visited;
    const network = revalidate(request, key, target);
    if (hit !== null) {
      waitUntil(network.catch(() => undefined));
      return hit.response;
    }
    try {
      return await network;
    } catch {
      if (strategy === 'page' && request.mode === 'navigate') {
        const offline = await lookup(scopeUrl(root, OFFLINE_PAGE), [names.shell]);
        if (offline !== null) return offline.response;
      }
      return Response.error();
    }
  }

  function respond(request: Request, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> | null {
    const strategy = requestStrategy({ url: request.url, method: request.method, mode: request.mode }, root);
    if (strategy === 'network') return null;
    return strategy === 'asset' ? asset(request) : staleWhileRevalidate(request, strategy, waitUntil);
  }

  return {
    install,
    activate,
    prefetch,
    clearOfflineData,
    wantsPrefetch: (today) => shouldPrefetch(lastPrefetch, today, env.now()),
    respond,
  };
}

/** Wires the worker to the scope's events. Returns the worker for tests. */
export function installWorker(scope: WorkerScope, config: ServiceWorkerConfig, env: WorkerEnv): LectioWorker {
  const worker = createWorker(scope, config, env);
  scope.addEventListener('install', (event) => {
    event.waitUntil(worker.install());
  });
  scope.addEventListener('activate', (event) => {
    event.waitUntil(worker.activate());
  });
  scope.addEventListener('fetch', (event) => {
    const response = worker.respond(event.request, (promise) => {
      event.waitUntil(promise);
    });
    if (response !== null) event.respondWith(response);
  });
  scope.addEventListener('message', (event) => {
    const message = parseClientMessage(event.data);
    if (message === null) return;
    if (message.type === 'skip-waiting') event.waitUntil(scope.skipWaiting());
    else if (message.type === 'clear-offline-data') event.waitUntil(worker.clearOfflineData());
    else if (worker.wantsPrefetch(message.today)) event.waitUntil(worker.prefetch(message.today));
  });
  return worker;
}
