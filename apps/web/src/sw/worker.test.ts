import { describe, expect, it } from 'vitest';

import { PREFETCH_INTERVAL_MS, VERSION_HEADER, VISITED_CACHE_LIMIT } from '../lib/sw-policy.ts';
import type { ServiceWorkerConfig } from '../lib/sw-policy.ts';
import { FakeCacheStorage, FakeNetwork, FakeScope, fakeEnv, fakeRequest } from './fixtures/fakes.ts';
import { createWorker, installWorker } from './worker.ts';

const SCOPE = 'https://example.org/lectio/';
const url = (path: string): string => new URL(path, SCOPE).href;
const CONFIG = { version: 'v2', precache: ['', 'offline/', '_astro/app.css'] };
const SHELL = 'lectio-shell-v2';
const ASSETS = 'lectio-assets';
const UPCOMING = 'lectio-data-upcoming';
const VISITED = 'lectio-data-visited';

const INDEX = JSON.stringify({ apiVersion: 1, dates: { first: '2026-09-19', last: '2026-09-21' } });
const day = (...slots: string[]): string =>
  JSON.stringify({ masses: [{ id: 'day', readings: slots.map((slot) => ({ slot })) }] });

/** A site with the fixture's three days; 2026-09-20 and 2026-09-21 are upcoming from 2026-09-20. */
function site(): FakeNetwork {
  return new FakeNetwork()
    .route(url(''), 'home')
    .route(url('offline/'), 'offline page')
    .route(url('_astro/app.css'), 'css')
    .route(url('api/v1/index.json'), INDEX)
    .route(url('api/v1/days/2026-09-19.json'), day())
    .route(url('2026-09-19/'), 'day 19')
    .route(url('api/v1/days/2026-09-20.json'), day('first-reading', 'gospel'))
    .route(url('api/v1/days/2026-09-21.json'), day('gospel'))
    .route(url('2026-09-20/'), 'day 20')
    .route(url('2026-09-20/first-reading/'), 'reading 20/1')
    .route(url('2026-09-20/gospel/'), 'gospel 20')
    .route(url('2026-09-21/'), 'day 21')
    .route(url('2026-09-21/gospel/'), 'gospel 21');
}

function setup(
  network = site(),
  clock = { now: Date.UTC(2026, 8, 20, 6) },
  caches = new FakeCacheStorage(network),
  config: ServiceWorkerConfig = CONFIG,
) {
  const scope = new FakeScope({ scope: SCOPE });
  const worker = createWorker(scope, config, fakeEnv(network, caches, clock));
  return { network, caches, scope, worker, clock };
}

const UPCOMING_URLS = [
  url('api/v1/days/2026-09-20.json'),
  url('2026-09-20/'),
  url('2026-09-20/first-reading/'),
  url('2026-09-20/gospel/'),
  url('api/v1/days/2026-09-21.json'),
  url('2026-09-21/'),
  url('2026-09-21/gospel/'),
];

const noWait = (): void => undefined;

/** Collects `waitUntil` promises so a test can await them. */
function waiter(): { waits: Promise<unknown>[]; waitUntil: (promise: Promise<unknown>) => void } {
  const waits: Promise<unknown>[] = [];
  return { waits, waitUntil: (promise) => void waits.push(promise) };
}

describe('install and activate', () => {
  it('precaches the shell under the scope and the hashed assets in the shared asset cache', async () => {
    const { caches, worker } = setup();
    await worker.install();
    expect(caches.get(SHELL)?.urls()).toEqual([url(''), url('offline/')]);
    expect(caches.get(ASSETS)?.urls()).toEqual([url('_astro/app.css')]);
  });

  it('does not download a hashed asset it already has', async () => {
    const { network, worker } = setup();
    await worker.install();
    const before = network.requests.length;
    await worker.install();
    expect(network.requests.slice(before)).toEqual([url(''), url('offline/')]);
  });

  it('fails the install when a shell file is missing', async () => {
    const network = site().route(url('offline/'), { status: 404 });
    await expect(setup(network).worker.install()).rejects.toThrow(/404/);
  });

  it('deletes older shell and search caches and claims the pages, without any network work', async () => {
    const { caches, network, scope, worker } = setup();
    for (const name of ['lectio-shell-v1', 'lectio-search-v1', 'lectio-search-v2', VISITED, ASSETS, 'other'])
      await caches.open(name);
    await worker.activate();
    expect(await caches.keys()).toEqual(['lectio-search-v2', VISITED, ASSETS, 'other']);
    expect(scope.claimed).toBe(1);
    expect(network.requests).toEqual([]);
    await worker.takeBackground();
    expect(worker.takeBackground()).toBeNull();
  });

  it('resolves activate before the asset pruning it starts has finished', async () => {
    const { caches, worker } = setup();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const keys = caches.keys.bind(caches);
    let calls = 0;
    // The second keys() call is the pruning's: hold it until activate has resolved.
    caches.keys = async () => {
      calls += 1;
      if (calls === 2) await gate;
      return keys();
    };
    await worker.activate();
    const background = worker.takeBackground();
    expect(background).not.toBeNull();
    release();
    await background;
  });

  it('swallows a failed pruning', async () => {
    const { caches, worker } = setup();
    await caches.open(ASSETS);
    await worker.activate();
    caches.open = () => Promise.reject(new Error('quota'));
    await expect(worker.takeBackground()).resolves.toBeUndefined();
  });
});

describe('deploys', () => {
  it('keeps an older page styled offline and refetches it online after a new build activates', async () => {
    const network = site()
      .route(url('_astro/a.css'), 'build A css')
      .route(url('_astro/a.js'), 'import"./chunk-a.js";')
      .route(url('_astro/chunk-a.js'), 'chunk a')
      .route(
        url('2026-09-19/'),
        '<link rel="stylesheet" href="/lectio/_astro/a.css"><script type="module" src="/lectio/_astro/a.js"></script>',
      );
    const caches = new FakeCacheStorage(network);
    const buildA = { version: 'a', precache: ['', 'offline/', '_astro/a.css', '_astro/a.js', '_astro/chunk-a.js'] };
    const a = setup(network, undefined, caches, buildA).worker;
    await a.install();
    await a.activate();
    await a.takeBackground();
    // The reader opens the 19th under build A.
    await a.respond(fakeRequest(url('2026-09-19/'), { mode: 'navigate' }), noWait);
    network.route(url('_astro/old-unused.css'), 'unused');
    await a.respond(fakeRequest(url('_astro/old-unused.css')), noWait);

    // Build B is deployed: A's hashed files are gone from the server and the page now uses b.css.
    for (const path of ['_astro/a.css', '_astro/a.js', '_astro/chunk-a.js', '_astro/old-unused.css'])
      network.route(url(path), { status: 404 });
    network
      .route(url('_astro/b.css'), 'build B css')
      .route(url('2026-09-19/'), '<link rel="stylesheet" href="/lectio/_astro/b.css">');
    const buildB = { version: 'b', precache: ['', 'offline/', '_astro/b.css'] };
    const b = setup(network, undefined, caches, buildB).worker;
    await b.install();
    await b.activate();
    // The pruning activate started drops only the file no cached page uses.
    await b.takeBackground();
    expect(caches.get(ASSETS)?.urls().sort()).toEqual(
      [url('_astro/a.css'), url('_astro/a.js'), url('_astro/b.css'), url('_astro/chunk-a.js')].sort(),
    );

    // Offline, the page from build A still finds its CSS and its JS chunk.
    network.route(url('2026-09-19/'), new Error('offline'));
    const offline = await b.respond(fakeRequest(url('2026-09-19/'), { mode: 'navigate' }), noWait);
    expect(await offline?.text()).toContain('_astro/a.css');
    expect(await (await b.respond(fakeRequest(url('_astro/a.css')), noWait))?.text()).toBe('build A css');
    expect(await (await b.respond(fakeRequest(url('_astro/chunk-a.js')), noWait))?.text()).toBe('chunk a');

    // Online, the page from build A is not served stale: the reload gets build B's page, styled with b.css.
    network.route(url('2026-09-19/'), '<link rel="stylesheet" href="/lectio/_astro/b.css">');
    const online = await b.respond(fakeRequest(url('2026-09-19/'), { mode: 'navigate' }), noWait);
    const html = (await online?.text()) ?? '';
    expect(html).toContain('_astro/b.css');
    expect(await (await b.respond(fakeRequest(url('_astro/b.css')), noWait))?.text()).toBe('build B css');
    const stored = await caches.get(VISITED)?.match(url('2026-09-19/'));
    expect(stored?.headers.get(VERSION_HEADER)).toBe('b');

    // Once no cached page needs build A's files, they are pruned.
    expect(await b.pruneAssets()).toBe(3);
    expect(caches.get(ASSETS)?.urls()).toEqual([url('_astro/b.css')]);
  });

  it('prunes nothing when there is no asset cache yet', async () => {
    expect(await setup().worker.pruneAssets()).toBe(0);
  });
});

describe('prefetch', () => {
  it('caches the day JSON, the day page and each Reading page of the next seven days, stamped with the build', async () => {
    const { caches, worker } = setup();
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20', '2026-09-21']);
    expect(caches.get(UPCOMING)?.urls()).toEqual(UPCOMING_URLS);
    const page = await caches.get(UPCOMING)?.match(url('2026-09-21/'));
    expect(page?.headers.get(VERSION_HEADER)).toBe('v2');
  });

  it('keeps pages this build already cached', async () => {
    const { network, worker } = setup();
    await worker.prefetch('2026-09-20');
    const before = network.requests.length;
    await worker.prefetch('2026-09-20');
    // The index and the two day documents only.
    expect(network.requests.slice(before)).toEqual([
      url('api/v1/index.json'),
      url('api/v1/days/2026-09-20.json'),
      url('api/v1/days/2026-09-21.json'),
    ]);
  });

  it('refetches upcoming pages stored by another build', async () => {
    const network = site();
    const caches = new FakeCacheStorage(network);
    await setup(network, undefined, caches, { version: 'v1', precache: [] }).worker.prefetch('2026-09-20');
    network.route(url('2026-09-21/'), 'day 21, new build');
    await setup(network, undefined, caches).worker.prefetch('2026-09-20');
    const page = await caches.get(UPCOMING)?.match(url('2026-09-21/'));
    expect(await page?.text()).toBe('day 21, new build');
    expect(page?.headers.get(VERSION_HEADER)).toBe('v2');
  });

  it('drops past days on every run, even offline', async () => {
    const { caches, network, worker } = setup();
    await worker.prefetch('2026-09-19');
    expect(caches.get(UPCOMING)?.urls()).toContain(url('2026-09-19/'));
    network.route(url('api/v1/index.json'), new Error('offline'));
    expect(await worker.prefetch('2026-09-21')).toEqual([]);
    expect(caches.get(UPCOMING)?.urls()).toEqual([
      url('api/v1/days/2026-09-21.json'),
      url('2026-09-21/'),
      url('2026-09-21/gospel/'),
    ]);
  });

  it('drops entries that are no longer listed only after a clean run', async () => {
    const { caches, network, worker } = setup();
    const unlisted = url('2026-09-25/');
    await (await caches.open(UPCOMING)).put(unlisted, new Response('gone'));
    await (await caches.open(UPCOMING)).put(url('extra.txt'), new Response('no date'));

    network.route(url('api/v1/days/2026-09-21.json'), new Error('offline'));
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20']);
    expect(caches.get(UPCOMING)?.urls()).toContain(unlisted);

    network.route(url('api/v1/days/2026-09-21.json'), 'not json');
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20']);

    network.route(url('api/v1/days/2026-09-21.json'), day('gospel')).route(url('2026-09-21/gospel/'), {
      status: 500,
    });
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20', '2026-09-21']);
    expect(caches.get(UPCOMING)?.urls()).toContain(unlisted);
    expect(caches.get(UPCOMING)?.urls()).not.toContain(url('2026-09-21/gospel/'));

    network.route(url('2026-09-21/gospel/'), 'gospel 21');
    await worker.prefetch('2026-09-20');
    expect(caches.get(UPCOMING)?.urls()).not.toContain(unlisted);
    expect(caches.get(UPCOMING)?.urls()).not.toContain(url('extra.txt'));
  });

  it('does nothing without a usable index', async () => {
    for (const route of [new Error('offline'), { status: 503 }, 'not json', { status: 200, redirected: true }]) {
      const network = site().route(url('api/v1/index.json'), route);
      const { caches, worker } = setup(network);
      expect(await worker.prefetch('2026-09-20')).toEqual([]);
      expect(caches.get(UPCOMING)?.urls()).toEqual([]);
    }
  });

  it('runs one prefetch at a time and recovers from a failed one', async () => {
    const { caches, worker } = setup();
    const open = caches.open.bind(caches);
    let failures = 1;
    caches.open = (name: string) => (failures-- > 0 ? Promise.reject(new Error('quota')) : open(name));
    const first = worker.prefetch('2026-09-21');
    const second = worker.prefetch('2026-09-20');
    await expect(first).rejects.toThrow('quota');
    expect(await second).toEqual(['2026-09-20', '2026-09-21']);
  });
});

describe('prefetch throttle and clearing', () => {
  it('wants a prefetch first, on a new date and after the interval', async () => {
    const { worker, clock } = setup();
    expect(worker.wantsPrefetch('2026-09-20')).toBe(true);
    await worker.prefetch('2026-09-20');
    expect(worker.wantsPrefetch('2026-09-20')).toBe(false);
    expect(worker.wantsPrefetch('2026-09-21')).toBe(true);
    clock.now += PREFETCH_INTERVAL_MS;
    expect(worker.wantsPrefetch('2026-09-20')).toBe(true);
  });

  it('clears only the offline data caches and forgets the last prefetch', async () => {
    const { caches, worker } = setup();
    await worker.install();
    await worker.prefetch('2026-09-20');
    await caches.open(VISITED);
    expect(await worker.clearOfflineData()).toBe(2);
    expect(await caches.keys()).toEqual([ASSETS, SHELL]);
    expect(worker.wantsPrefetch('2026-09-20')).toBe(true);
  });
});

describe('respond', () => {
  it('leaves requests outside its strategies to the browser', () => {
    const { worker } = setup();
    expect(worker.respond(fakeRequest(url(''), { method: 'POST' }), noWait)).toBeNull();
    expect(worker.respond(fakeRequest('https://cdn.example.com/x.js'), noWait)).toBeNull();
    expect(worker.respond(fakeRequest(url('sw.js')), noWait)).toBeNull();
  });

  it('serves assets cache first and fills the asset and shell caches at run time', async () => {
    const { caches, network, worker } = setup();
    await worker.install();
    const before = network.requests.length;
    expect(await (await worker.respond(fakeRequest(url('_astro/app.css')), noWait))?.text()).toBe('css');
    expect(network.requests.length).toBe(before);

    network.route(url('fonts/new.woff2'), 'font').route(url('_astro/late.js'), 'js');
    expect(await (await worker.respond(fakeRequest(url('fonts/new.woff2')), noWait))?.text()).toBe('font');
    expect(caches.get(SHELL)?.urls()).toContain(url('fonts/new.woff2'));
    await worker.respond(fakeRequest(url('_astro/late.js')), noWait);
    expect(caches.get(ASSETS)?.urls()).toContain(url('_astro/late.js'));

    const missing = await worker.respond(fakeRequest(url('icons/none.png')), noWait);
    expect(missing?.status).toBe(404);
    expect(caches.get(SHELL)?.urls()).not.toContain(url('icons/none.png'));

    network.route(url('icons/down.png'), new Error('offline'));
    expect((await worker.respond(fakeRequest(url('icons/down.png')), noWait))?.type).toBe('error');
  });

  it('serves a cached upcoming page at once and revalidates it in the upcoming cache', async () => {
    const { caches, network, worker } = setup();
    await worker.prefetch('2026-09-20');
    network.route(url('2026-09-21/'), 'day 21, updated');
    const { waits, waitUntil } = waiter();
    const response = await worker.respond(fakeRequest(url('2026-09-21/'), { mode: 'navigate' }), waitUntil);
    expect(await response?.text()).toBe('day 21');
    await Promise.all(waits);
    expect(await (await caches.get(UPCOMING)?.match(url('2026-09-21/')))?.text()).toBe('day 21, updated');
    expect(caches.get(VISITED)).toBeUndefined();
  });

  it('keeps a page found only in the shell in the visited cache when revalidated', async () => {
    const { caches, worker } = setup();
    await worker.install();
    const { waits, waitUntil } = waiter();
    await worker.respond(fakeRequest(url(''), { mode: 'navigate' }), waitUntil);
    await Promise.all(waits);
    expect(caches.get(VISITED)?.urls()).toEqual([url('')]);
  });

  it('swallows a failed revalidation when the cache answered', async () => {
    const { network, worker } = setup();
    await worker.install();
    network.route(url(''), new Error('offline'));
    const { waits, waitUntil } = waiter();
    const response = await worker.respond(fakeRequest(url(''), { mode: 'navigate' }), waitUntil);
    expect(await response?.text()).toBe('home');
    await expect(Promise.all(waits)).resolves.toEqual([undefined]);
  });

  it('fetches an unvisited page, keeps it and trims the visited cache to its limit, oldest first', async () => {
    const network = site();
    for (let i = 0; i <= VISITED_CACHE_LIMIT; i += 1) network.route(url(`page-${String(i)}/`), `page ${String(i)}`);
    const { caches, worker } = setup(network);
    for (let i = 0; i <= VISITED_CACHE_LIMIT; i += 1) {
      const response = await worker.respond(fakeRequest(url(`page-${String(i)}/`), { mode: 'navigate' }), noWait);
      expect(await response?.text()).toBe(`page ${String(i)}`);
      // Revisit the first page each time, so it stays the most recently used.
      if (i > 0) {
        const { waits, waitUntil } = waiter();
        await worker.respond(fakeRequest(url('page-0/')), waitUntil);
        await Promise.all(waits);
      }
    }
    const visited = caches.get(VISITED)?.urls() ?? [];
    expect(visited).toHaveLength(VISITED_CACHE_LIMIT);
    expect(visited).toContain(url('page-0/'));
    expect(visited).not.toContain(url('page-1/'));
  });

  it('moves a visited page to the most recent end on an offline hit too', async () => {
    const { caches, network, worker } = setup();
    network.route(url('a/'), 'a').route(url('b/'), 'b');
    await worker.respond(fakeRequest(url('a/')), noWait);
    await worker.respond(fakeRequest(url('b/')), noWait);
    network.route(url('a/'), new Error('offline'));
    const { waits, waitUntil } = waiter();
    expect(await (await worker.respond(fakeRequest(url('a/')), waitUntil))?.text()).toBe('a');
    await Promise.all(waits);
    expect(caches.get(VISITED)?.urls()).toEqual([url('b/'), url('a/')]);
  });

  it('does not keep error pages or redirected responses', async () => {
    const network = site().route(url('moved/'), { status: 200, redirected: true });
    const { caches, worker } = setup(network);
    expect((await worker.respond(fakeRequest(url('nowhere/'), { mode: 'navigate' }), noWait))?.status).toBe(404);
    await worker.respond(fakeRequest(url('moved/'), { mode: 'navigate' }), noWait);
    expect(caches.get(VISITED)).toBeUndefined();
  });

  it('falls back to the offline page for a navigation it cannot serve', async () => {
    const network = site().route(url('calendar/'), new Error('offline'));
    const { worker } = setup(network);
    // Before install there is no offline page either.
    expect((await worker.respond(fakeRequest(url('calendar/'), { mode: 'navigate' }), noWait))?.type).toBe('error');
    await worker.install();
    const response = await worker.respond(fakeRequest(url('calendar/'), { mode: 'navigate' }), noWait);
    expect(await response?.text()).toBe('offline page');
    // A page fetched by script gets a network error, not the offline page.
    expect((await worker.respond(fakeRequest(url('calendar/')), noWait))?.type).toBe('error');
  });

  it('serves API documents stale-while-revalidate from the data caches, whatever build stored them', async () => {
    const network = site();
    const caches = new FakeCacheStorage(network);
    await setup(network, undefined, caches, { version: 'v1', precache: [] }).worker.prefetch('2026-09-20');
    const { network: net, worker } = setup(network, undefined, caches);
    net.route(url('api/v1/days/2026-09-20.json'), day('gospel'));
    const cached = await worker.respond(fakeRequest(url('api/v1/days/2026-09-20.json')), noWait);
    expect(await cached?.json()).toEqual(JSON.parse(day('first-reading', 'gospel')));

    const { waits, waitUntil } = waiter();
    await worker.respond(fakeRequest(url('api/v1/index.json')), waitUntil);
    expect(caches.get(VISITED)?.urls()).toEqual([url('api/v1/index.json')]);
    expect(waits).toEqual([]);

    net.route(url('api/v1/calendar/2026.json'), new Error('offline'));
    expect((await worker.respond(fakeRequest(url('api/v1/calendar/2026.json')), noWait))?.type).toBe('error');
  });

  it('caches the Pagefind bundle by full URL in the search cache', async () => {
    const network = site().route(url('pagefind/pagefind.js?v=1'), 'pagefind');
    const { caches, worker } = setup(network);
    expect(await (await worker.respond(fakeRequest(url('pagefind/pagefind.js?v=1')), noWait))?.text()).toBe('pagefind');
    expect(caches.get('lectio-search-v2')?.urls()).toEqual([url('pagefind/pagefind.js?v=1')]);
    network.route(url('pagefind/pagefind.js?v=1'), new Error('offline'));
    const { waits, waitUntil } = waiter();
    const again = await worker.respond(fakeRequest(url('pagefind/pagefind.js?v=1')), waitUntil);
    expect(await again?.text()).toBe('pagefind');
    await Promise.all(waits);
  });
});

describe('installWorker', () => {
  function installed(network = site()) {
    const caches = new FakeCacheStorage(network);
    const scope = new FakeScope({ scope: SCOPE });
    const clock = { now: Date.UTC(2026, 8, 20, 6) };
    const worker = installWorker(scope, CONFIG, fakeEnv(network, caches, clock));
    return { caches, scope, worker, network, clock };
  }

  it('precaches on install, activates without caching days and hands its pruning to the next event', async () => {
    const { caches, scope } = installed();
    await scope.dispatch('install');
    await scope.dispatch('activate');
    expect(caches.get(SHELL)?.urls()).toHaveLength(2);
    expect(caches.get(UPCOMING)).toBeUndefined();
    expect(scope.claimed).toBe(1);
    const first = await scope.fetch(fakeRequest('https://cdn.example.com/x.js'));
    expect(first.waits).toHaveLength(1);
    expect((await scope.fetch(fakeRequest('https://cdn.example.com/x.js'))).waits).toHaveLength(0);
  });

  it('answers fetches it has a strategy for and leaves the rest', async () => {
    const { scope } = installed();
    await scope.dispatch('install');
    const page = await scope.fetch(fakeRequest(url(''), { mode: 'navigate' }));
    expect(await page.response?.text()).toBe('home');
    expect(page.waits).toHaveLength(1);
    expect((await scope.fetch(fakeRequest('https://cdn.example.com/x.js'))).response).toBeNull();
  });

  it('handles skip-waiting, clear-offline-data and prefetch messages', async () => {
    const { caches, scope, network } = installed();
    expect(await scope.message({ type: 'skip-waiting' })).toBe(1);
    expect(scope.skipped).toBe(1);

    expect(await scope.message({ type: 'prefetch', today: '2026-09-20' })).toBe(1);
    expect(caches.get(UPCOMING)?.urls()).toEqual(UPCOMING_URLS);
    // A second page open on the same date soon after does not refetch.
    const before = network.requests.length;
    expect(await scope.message({ type: 'prefetch', today: '2026-09-20' })).toBe(0);
    expect(network.requests.length).toBe(before);

    expect(await scope.message({ type: 'clear-offline-data' })).toBe(1);
    expect(caches.get(UPCOMING)).toBeUndefined();

    expect(await scope.message({ type: 'unknown' })).toBe(0);
    expect(await scope.message(null)).toBe(0);
  });

  it('ignores messages from another origin', async () => {
    const { caches, scope } = installed();
    await scope.message({ type: 'prefetch', today: '2026-09-20' });
    const foreign = { origin: 'https://evil.example' };
    expect(await scope.message({ type: 'clear-offline-data' }, foreign)).toBe(0);
    expect(await scope.message({ type: 'skip-waiting' }, foreign)).toBe(0);
    expect(caches.get(UPCOMING)).toBeDefined();
    expect(scope.skipped).toBe(0);
    // With no origin, the sending page's URL decides.
    expect(
      await scope.message({ type: 'skip-waiting' }, { origin: '', source: { url: 'https://evil.example/' } }),
    ).toBe(0);
    expect(await scope.message({ type: 'skip-waiting' }, { origin: '', source: null })).toBe(0);
    expect(await scope.message({ type: 'skip-waiting' }, { origin: '', source: { url: url('2026-09-20/') } })).toBe(1);
  });
});
