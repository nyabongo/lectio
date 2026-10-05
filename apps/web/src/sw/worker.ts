/**
 * The service worker's behaviour (L-061), written against small interfaces so it runs in the browser bundle
 * (`index.ts` hands it `self`, `caches` and `fetch`) and in unit tests with fakes. The policy (cache names,
 * strategies, the next seven days, the LRU trim) is in `src/lib/sw-policy.ts`.
 *
 * - install: precache the app shell into `lectio-shell-<version>` and the hashed bundles into `lectio-assets`
 *   (only those not already there: their names are content hashes).
 * - activate: delete older shell and search caches and take control of open pages. Nothing else waits on it: the
 *   pruning of `lectio-assets` starts afterwards and is handed to the next fetch or message event.
 * - message `prefetch` (sent by every page on open, with the page's own date and the reader's saved language): cache
 *   the next seven days (day page, Listen page when Listen is built, Reading pages, day JSON) into
 *   `lectio-data-upcoming`, the pages under `/<locale>/` (and that locale's day JSON, when the build has its API
 *   mirror) when that language is a non-default site locale, refetching pages stored by another build and dropping
 *   past days and, after a clean run, the other language's pages; `skip-waiting` (the update toast's Reload button);
 *   `clear-offline-data` (deletes every `lectio-data-` cache). Messages from another origin are ignored.
 * - fetch: assets cache first; pages and API JSON stale-while-revalidate (visited ones kept in `lectio-data-visited`,
 *   at most `VISITED_CACHE_LIMIT`, least recently used dropped first); a cached page from another build is served
 *   network first and from the cache only when the network fails; a page that is neither cached nor reachable gets
 *   the offline page in its language; the Pagefind bundle stale-while-revalidate in its own cache.
 *
 * Deploys: a page cached under an older build keeps working offline because the hashed CSS and JS it references stay
 * in `lectio-assets` until no cached page refers to them; online, the page itself is refetched first.
 */
import {
  OFFLINE_PAGE,
  VERSION_HEADER,
  VISITED_CACHE_LIMIT,
  cacheKey,
  cacheNames,
  dayDataUrl,
  dayPageUrls,
  daySlots,
  entryDate,
  indexDates,
  indexUrl,
  isHashedAsset,
  isObsoleteCache,
  isOfflineDataCache,
  isPagePath,
  isTrustedSender,
  lruEvictions,
  offlinePageFor,
  pageLocale,
  parseClientMessage,
  referencedAssets,
  requestStrategy,
  scopeUrl,
  scopedPath,
  shouldPrefetch,
  upcomingDates,
} from '../lib/sw-policy.ts';
import type { PrefetchRequest, ServiceWorkerConfig, Strategy } from '../lib/sw-policy.ts';

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
  /** The sender's origin. */
  readonly origin: string;
  /** The sending client (a page), when there is one. */
  readonly source?: { readonly url?: string } | null;
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
  /** Deletes older caches and claims the pages; resolves without waiting for the asset pruning it starts. */
  activate(): Promise<void>;
  /** The background work `activate` started (asset pruning), once; `null` when there is none. */
  takeBackground(): Promise<void> | null;
  /** Drops hashed assets that neither the shell nor any cached page references. Returns how many it deleted. */
  pruneAssets(): Promise<number>;
  /**
   * Caches the next seven days from `today`, in the reader's saved `language` when it is a non-default site locale.
   * Returns the dates cached.
   */
  prefetch(today: string, language?: string): Promise<string[]>;
  clearOfflineData(): Promise<number>;
  /** Whether a page's prefetch request should run now (the date or the language changed, or the last run is old). */
  wantsPrefetch(today: string, language?: string): boolean;
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
  const dataCaches = [names.visited, names.upcoming];
  let lastPrefetch: (PrefetchRequest & { at: number }) | null = null;
  /** The prefetch request for a page's date and saved language. */
  const prefetchRequest = (today: string, language: string | undefined): PrefetchRequest => {
    const locale = pageLocale(language, config.locales);
    return locale === undefined ? { today } : { today, locale };
  };
  let background: Promise<void> | null = null;
  // Prefetch runs one at a time, so one run never prunes what another just stored.
  let queue: Promise<unknown> = Promise.resolve();

  /** A copy of `response` that records the build which stored it. */
  async function stamp(response: Response): Promise<Response> {
    const headers = new Headers(response.headers);
    headers.set(VERSION_HEADER, config.version);
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const current = (response: Response): boolean => response.headers.get(VERSION_HEADER) === config.version;

  async function fetchStorable(url: string): Promise<Response | null> {
    try {
      const response = await env.fetch(url, { cache: 'no-cache' });
      return storable(response) ? response : null;
    } catch {
      return null;
    }
  }

  async function runPrefetch({ today, locale }: PrefetchRequest): Promise<string[]> {
    const cache = await env.caches.open(names.upcoming);
    // Past days can never be upcoming again: drop them on every run, even offline.
    for (const request of await cache.keys()) {
      const date = entryDate(request.url, root);
      if (date !== null && date < today) await cache.delete(request);
    }
    const indexResponse = await fetchStorable(indexUrl(root));
    if (indexResponse === null) return [];
    let index: unknown;
    try {
      index = await indexResponse.json();
    } catch {
      return [];
    }
    const dates = upcomingDates(today, indexDates(index));
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
      await cache.put(dataUrl, await stamp(dayResponse));
      keep.add(dataUrl);
      // In another language, its day document too (the Listen page reads it) when the build has that API mirror; a
      // locale without one (`api/v1/<locale>/`) must not keep every run incomplete.
      const urls = dayPageUrls(root, date, daySlots(day), { listen: config.listen, locale });
      if (locale !== undefined && (config.apiLocales ?? []).includes(locale))
        urls.unshift(dayDataUrl(root, date, locale));
      for (const url of urls) {
        keep.add(url);
        // A page stored by this build is kept (visits revalidate it); one from another build is refetched.
        const stored = await cache.match(url);
        if (stored !== undefined && current(stored)) continue;
        const page = await fetchStorable(url);
        if (page !== null) await cache.put(url, await stamp(page));
        else complete = false;
      }
      cached.push(date);
    }
    // Other entries (say, a day the calendar no longer lists) go only after a clean run.
    if (complete) for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
    return cached;
  }

  function prefetch(today: string, language?: string): Promise<string[]> {
    const request = prefetchRequest(today, language);
    lastPrefetch = { ...request, at: env.now() };
    const run = queue.then(() => runPrefetch(request));
    queue = run.catch(() => undefined);
    return run;
  }

  async function install(): Promise<void> {
    const urls = (hashed: boolean): string[] =>
      config.precache.filter((path) => isHashedAsset(path) === hashed).map((path) => scopeUrl(root, path));
    const assets = await env.caches.open(names.assets);
    const missing: string[] = [];
    for (const url of urls(true)) if ((await assets.match(url)) === undefined) missing.push(url);
    await assets.addAll(missing);
    await (await env.caches.open(names.shell)).addAll(urls(false));
  }

  async function pruneAssets(): Promise<number> {
    const existing = new Set(await env.caches.keys());
    if (!existing.has(names.assets)) return 0;
    const assets = await env.caches.open(names.assets);
    const keep = new Set(config.precache.filter(isHashedAsset).map((path) => scopeUrl(root, path)));
    const pending = [...keep];
    const follow = (text: string, url: string): void => {
      for (const ref of referencedAssets(text, url, root))
        if (!keep.has(ref)) {
          keep.add(ref);
          pending.push(ref);
        }
    };
    for (const name of [names.shell, ...dataCaches].filter((cache) => existing.has(cache))) {
      const cache = await env.caches.open(name);
      for (const request of await cache.keys()) {
        if (!isPagePath(new URL(request.url).pathname)) continue;
        const page = await cache.match(request);
        if (page !== undefined) follow(await page.text(), request.url);
      }
    }
    // Follow CSS and JS into the chunks and files they import.
    for (let url = pending.pop(); url !== undefined; url = pending.pop()) {
      if (!/\.(?:css|m?js)$/.test(url)) continue;
      const asset = await assets.match(url);
      if (asset !== undefined) follow(await asset.text(), url);
    }
    let deleted = 0;
    for (const request of await assets.keys())
      if (!keep.has(request.url) && (await assets.delete(request))) deleted += 1;
    return deleted;
  }

  async function activate(): Promise<void> {
    const keys = await env.caches.keys();
    await Promise.all(
      keys.filter((name) => isObsoleteCache(name, config.version)).map((name) => env.caches.delete(name)),
    );
    await scope.clients.claim();
    background = pruneAssets().then(
      () => undefined,
      () => undefined,
    );
  }

  function takeBackground(): Promise<void> | null {
    const work = background;
    background = null;
    return work;
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

  /** Stores `response` under `key`; in the visited cache it goes to the end (most recent) and the oldest are trimmed. */
  async function store(target: string, key: string, response: Response): Promise<void> {
    const cache = await env.caches.open(target);
    const stamped = await stamp(response);
    if (target !== names.visited) return cache.put(key, stamped);
    // Delete first so the entry moves to the end of the insertion order, which is the LRU order.
    await cache.delete(key);
    await cache.put(key, stamped);
    const keys = (await cache.keys()).map((entry) => entry.url);
    for (const stale of lruEvictions(keys, VISITED_CACHE_LIMIT)) await cache.delete(stale);
  }

  /** Fetches `request` and stores a good response under `key` in `target`; rejects when the network fails. */
  async function revalidate(request: Request, key: string, target: string): Promise<Response> {
    const response = await env.fetch(request);
    if (storable(response)) await store(target, key, response.clone());
    return response;
  }

  async function asset(request: Request, hashed: boolean): Promise<Response> {
    const cache = await env.caches.open(hashed ? names.assets : names.shell);
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
    strategy: Exclude<Strategy, 'hashed' | 'asset' | 'network'>,
    waitUntil: (promise: Promise<unknown>) => void,
  ): Promise<Response> {
    const search = strategy === 'search';
    const key = search ? request.url : cacheKey(request.url);
    const order = search ? [names.search] : strategy === 'page' ? [...dataCaches, names.shell] : dataCaches;
    const hit = await lookup(key, order);
    const target = search ? names.search : hit?.cache === names.upcoming ? names.upcoming : names.visited;
    const network = revalidate(request, key, target);
    // The shell is this build's by definition; a data-cache page must have been stored by this build.
    const fresh = hit !== null && (strategy !== 'page' || hit.cache === names.shell || current(hit.response));
    if (hit !== null && fresh) {
      // Offline, the revalidation fails; still mark a visited entry as just used, so the LRU order follows reading.
      const copy = hit.cache === names.visited ? hit.response.clone() : null;
      waitUntil(
        network.then(
          () => undefined,
          () => (copy === null ? undefined : store(names.visited, key, copy).catch(() => undefined)),
        ),
      );
      return hit.response;
    }
    try {
      return await network;
    } catch {
      // A page from another build is still better than nothing offline: its assets stay in `lectio-assets`.
      if (hit !== null) return hit.response;
      if (strategy === 'page' && request.mode === 'navigate') {
        // The offline page in the page's language, else the default one (a shell cached before it had mirrors).
        const localised = offlinePageFor(scopedPath(request.url, root), config.locales);
        for (const page of new Set([localised, OFFLINE_PAGE])) {
          const offline = await lookup(scopeUrl(root, page), [names.shell]);
          if (offline !== null) return offline.response;
        }
      }
      return Response.error();
    }
  }

  function respond(request: Request, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> | null {
    const strategy = requestStrategy({ url: request.url, method: request.method, mode: request.mode }, root);
    if (strategy === 'network') return null;
    if (strategy === 'hashed' || strategy === 'asset') return asset(request, strategy === 'hashed');
    return staleWhileRevalidate(request, strategy, waitUntil);
  }

  return {
    install,
    activate,
    takeBackground,
    pruneAssets,
    prefetch,
    clearOfflineData,
    wantsPrefetch: (today, language) => shouldPrefetch(lastPrefetch, prefetchRequest(today, language), env.now()),
    respond,
  };
}

/** Wires the worker to the scope's events. Returns the worker for tests. */
export function installWorker(scope: WorkerScope, config: ServiceWorkerConfig, env: WorkerEnv): LectioWorker {
  const worker = createWorker(scope, config, env);
  const root = scope.registration.scope;
  /** Keeps the worker alive for the background work `activate` started, on the first event after it. */
  const adoptBackground = (event: WaitUntilEvent): void => {
    const work = worker.takeBackground();
    if (work !== null) event.waitUntil(work);
  };
  scope.addEventListener('install', (event) => {
    event.waitUntil(worker.install());
  });
  scope.addEventListener('activate', (event) => {
    event.waitUntil(worker.activate());
  });
  scope.addEventListener('fetch', (event) => {
    adoptBackground(event);
    const response = worker.respond(event.request, (promise) => {
      event.waitUntil(promise);
    });
    if (response !== null) event.respondWith(response);
  });
  scope.addEventListener('message', (event) => {
    adoptBackground(event);
    if (!isTrustedSender(event.origin, event.source?.url ?? undefined, root)) return;
    const message = parseClientMessage(event.data);
    if (message === null) return;
    if (message.type === 'skip-waiting') event.waitUntil(scope.skipWaiting());
    else if (message.type === 'clear-offline-data') event.waitUntil(worker.clearOfflineData());
    else if (worker.wantsPrefetch(message.today, message.language))
      event.waitUntil(worker.prefetch(message.today, message.language));
  });
  return worker;
}
