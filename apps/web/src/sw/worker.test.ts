import { describe, expect, it } from 'vitest';

import { PREFETCH_INTERVAL_MS, VISITED_CACHE_LIMIT } from '../lib/sw-policy.ts';
import { FakeCacheStorage, FakeNetwork, FakeScope, fakeEnv, fakeRequest } from './fixtures/fakes.ts';
import { createWorker, installWorker } from './worker.ts';

const SCOPE = 'https://example.org/lectio/';
const url = (path: string): string => new URL(path, SCOPE).href;
const CONFIG = { version: 'v2', precache: ['', 'offline/', '_astro/app.css'] };
const SHELL = 'lectio-shell-v2';
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

function setup(network = site(), clock = { now: Date.UTC(2026, 8, 20, 6) }) {
  const caches = new FakeCacheStorage(network);
  const scope = new FakeScope({ scope: SCOPE });
  const worker = createWorker(scope, CONFIG, fakeEnv(network, caches, clock));
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

describe('install and activate', () => {
  it('precaches the shell under the scope', async () => {
    const { caches, worker } = setup();
    await worker.install();
    expect(caches.get(SHELL)?.urls()).toEqual([url(''), url('offline/'), url('_astro/app.css')]);
  });

  it('fails the install when a shell file is missing', async () => {
    const network = site().route(url('offline/'), { status: 404 });
    await expect(setup(network).worker.install()).rejects.toThrow(/404/);
  });

  it('deletes older shell and search caches, claims the pages and caches the upcoming days', async () => {
    const { caches, scope, worker } = setup();
    for (const name of ['lectio-shell-v1', 'lectio-search-v1', 'lectio-search-v2', VISITED, 'other'])
      await caches.open(name);
    await worker.activate();
    expect(await caches.keys()).toEqual(['lectio-search-v2', VISITED, 'other', UPCOMING]);
    expect(scope.claimed).toBe(1);
    expect(caches.get(UPCOMING)?.urls()).toEqual(UPCOMING_URLS);
  });

  it('refetches upcoming pages on activate even when they are cached', async () => {
    const { caches, network, worker } = setup();
    await worker.prefetch('2026-09-20');
    network.route(url('2026-09-21/'), 'day 21, new build');
    await worker.activate();
    expect(await (await caches.get(UPCOMING)?.match(url('2026-09-21/')))?.text()).toBe('day 21, new build');
  });
});

describe('prefetch', () => {
  it('caches the day JSON, the day page and each Reading page of the next seven days', async () => {
    const { caches, worker } = setup();
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20', '2026-09-21']);
    expect(caches.get(UPCOMING)?.urls()).toEqual(UPCOMING_URLS);
  });

  it('keeps pages already cached unless refreshing', async () => {
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

  it('drops days that are no longer upcoming after a clean run', async () => {
    const { caches, worker } = setup();
    await worker.prefetch('2026-09-20');
    await worker.prefetch('2026-09-21');
    expect(caches.get(UPCOMING)?.urls()).toEqual([
      url('2026-09-21/'),
      url('2026-09-21/gospel/'),
      url('api/v1/days/2026-09-21.json'),
    ]);
  });

  it('keeps what it has when a day or a page cannot be fetched', async () => {
    const { caches, network, worker } = setup();
    await worker.prefetch('2026-09-19');
    network.route(url('api/v1/days/2026-09-21.json'), new Error('offline'));
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20']);
    // The 19th's entries survive because the run was not complete.
    expect(caches.get(UPCOMING)?.urls()).toContain(url('api/v1/days/2026-09-19.json'));

    network.route(url('api/v1/days/2026-09-21.json'), 'not json');
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20']);

    await caches.get(UPCOMING)?.delete(url('2026-09-21/gospel/'));
    network.route(url('api/v1/days/2026-09-21.json'), day('gospel')).route(url('2026-09-21/gospel/'), {
      status: 500,
    });
    expect(await worker.prefetch('2026-09-20')).toEqual(['2026-09-20', '2026-09-21']);
    expect(caches.get(UPCOMING)?.urls()).toContain(url('api/v1/days/2026-09-19.json'));
    expect(caches.get(UPCOMING)?.urls()).not.toContain(url('2026-09-21/gospel/'));
  });

  it('does nothing without a usable index', async () => {
    for (const route of [new Error('offline'), { status: 503 }, 'not json', { status: 200, redirected: true }]) {
      const network = site().route(url('api/v1/index.json'), route);
      const { caches, worker } = setup(network);
      expect(await worker.prefetch('2026-09-20')).toEqual([]);
      expect(caches.get(UPCOMING)).toBeUndefined();
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

describe('page requests', () => {
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
    expect(await caches.keys()).toEqual([SHELL]);
    expect(worker.wantsPrefetch('2026-09-20')).toBe(true);
  });
});

describe('respond', () => {
  const noWait = (): void => undefined;

  it('leaves requests outside its strategies to the browser', () => {
    const { worker } = setup();
    expect(worker.respond(fakeRequest(url(''), { method: 'POST' }), noWait)).toBeNull();
    expect(worker.respond(fakeRequest('https://cdn.example.com/x.js'), noWait)).toBeNull();
    expect(worker.respond(fakeRequest(url('sw.js')), noWait)).toBeNull();
  });

  it('serves assets cache first and fills the shell cache at run time', async () => {
    const { caches, network, worker } = setup();
    await worker.install();
    const before = network.requests.length;
    expect(await (await worker.respond(fakeRequest(url('_astro/app.css')), noWait))?.text()).toBe('css');
    expect(network.requests.length).toBe(before);

    network.route(url('fonts/new.woff2'), 'font');
    expect(await (await worker.respond(fakeRequest(url('fonts/new.woff2')), noWait))?.text()).toBe('font');
    expect(caches.get(SHELL)?.urls()).toContain(url('fonts/new.woff2'));

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
    const waits: Promise<unknown>[] = [];
    const response = await worker.respond(fakeRequest(url('2026-09-21/'), { mode: 'navigate' }), (p) => waits.push(p));
    expect(await response?.text()).toBe('day 21');
    await Promise.all(waits);
    expect(await (await caches.get(UPCOMING)?.match(url('2026-09-21/')))?.text()).toBe('day 21, updated');
    expect(caches.get(VISITED)).toBeUndefined();
  });

  it('keeps a page found only in the shell in the visited cache when revalidated', async () => {
    const { caches, worker } = setup();
    await worker.install();
    const waits: Promise<unknown>[] = [];
    await worker.respond(fakeRequest(url(''), { mode: 'navigate' }), (p) => waits.push(p));
    await Promise.all(waits);
    expect(caches.get(VISITED)?.urls()).toEqual([url('')]);
  });

  it('swallows a failed revalidation when the cache answered', async () => {
    const { network, worker } = setup();
    await worker.install();
    network.route(url(''), new Error('offline'));
    const waits: Promise<unknown>[] = [];
    const response = await worker.respond(fakeRequest(url(''), { mode: 'navigate' }), (p) => waits.push(p));
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
      if (i > 0) await worker.respond(fakeRequest(url('page-0/')), noWait);
    }
    const visited = caches.get(VISITED)?.urls() ?? [];
    expect(visited).toHaveLength(VISITED_CACHE_LIMIT);
    expect(visited).toContain(url('page-0/'));
    expect(visited).not.toContain(url('page-1/'));
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

  it('serves API documents stale-while-revalidate from the data caches', async () => {
    const { caches, network, worker } = setup();
    await worker.prefetch('2026-09-20');
    const cached = await worker.respond(fakeRequest(url('api/v1/days/2026-09-20.json')), noWait);
    expect(await cached?.json()).toEqual(JSON.parse(day('first-reading', 'gospel')));

    const waits: Promise<unknown>[] = [];
    await worker.respond(fakeRequest(url('api/v1/index.json')), (p) => waits.push(p));
    expect(caches.get(VISITED)?.urls()).toEqual([url('api/v1/index.json')]);
    expect(waits).toEqual([]);

    network.route(url('api/v1/calendar/2026.json'), new Error('offline'));
    expect((await worker.respond(fakeRequest(url('api/v1/calendar/2026.json')), noWait))?.type).toBe('error');
  });

  it('caches the Pagefind bundle by full URL in the search cache', async () => {
    const network = site().route(url('pagefind/pagefind.js?v=1'), 'pagefind');
    const { caches, worker } = setup(network);
    expect(await (await worker.respond(fakeRequest(url('pagefind/pagefind.js?v=1')), noWait))?.text()).toBe('pagefind');
    expect(caches.get('lectio-search-v2')?.urls()).toEqual([url('pagefind/pagefind.js?v=1')]);
    network.route(url('pagefind/pagefind.js?v=1'), new Error('offline'));
    const waits: Promise<unknown>[] = [];
    const again = await worker.respond(fakeRequest(url('pagefind/pagefind.js?v=1')), (p) => waits.push(p));
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

  it('precaches on install and caches the upcoming days on activate', async () => {
    const { caches, scope } = installed();
    await scope.dispatch('install');
    await scope.dispatch('activate');
    expect(caches.get(SHELL)?.urls()).toHaveLength(3);
    expect(caches.get(UPCOMING)?.urls()).toEqual(UPCOMING_URLS);
    expect(scope.claimed).toBe(1);
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
});
