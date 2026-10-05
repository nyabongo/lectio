import { describe, expect, it } from 'vitest';

import { OFFLINE_DATA_CACHE_PREFIX } from './settings.ts';
import {
  PREFETCH_INTERVAL_MS,
  SHELL_PAGES,
  UPCOMING_DAY_COUNT,
  VISITED_CACHE_LIMIT,
  addDays,
  cacheKey,
  cacheNames,
  dayDataUrl,
  dayPageUrls,
  daySlots,
  deviceDate,
  indexDates,
  indexUrl,
  entryDate,
  isHashedAsset,
  isIsoDate,
  isTrustedSender,
  isObsoleteCache,
  isOfflineDataCache,
  isPagePath,
  lruEvictions,
  parseClientMessage,
  precachePaths,
  referencedAssets,
  requestStrategy,
  scopeUrl,
  scopedPath,
  shouldPrefetch,
  upcomingDates,
} from './sw-policy.ts';

const SCOPE = 'https://example.org/lectio/';

describe('cache names', () => {
  it('versions the shell and search caches and keeps the data caches under the offline-data prefix', () => {
    const names = cacheNames('abc');
    expect(names).toEqual({
      shell: 'lectio-shell-abc',
      assets: 'lectio-assets',
      search: 'lectio-search-abc',
      upcoming: 'lectio-data-upcoming',
      visited: 'lectio-data-visited',
    });
    expect(names.shell.startsWith(OFFLINE_DATA_CACHE_PREFIX)).toBe(false);
    expect(names.search.startsWith(OFFLINE_DATA_CACHE_PREFIX)).toBe(false);
    expect(isOfflineDataCache(names.upcoming)).toBe(true);
    expect(isOfflineDataCache(names.visited)).toBe(true);
    expect(isOfflineDataCache(names.shell)).toBe(false);
    expect(isOfflineDataCache(names.assets)).toBe(false);
    expect(isObsoleteCache(names.assets, 'abc')).toBe(false);
  });

  it.each([
    ['lectio-shell-old', true],
    ['lectio-search-old', true],
    ['lectio-shell-abc', false],
    ['lectio-search-abc', false],
    ['lectio-data-visited', false],
    ['someone-else', false],
  ])('%s is obsolete for version abc: %s', (name, expected) => {
    expect(isObsoleteCache(name, 'abc')).toBe(expected);
  });
});

describe('requestStrategy', () => {
  const get = (path: string, mode = 'cors') => ({ url: new URL(path, SCOPE).href, method: 'GET', mode });

  it.each([
    ['_astro/index.abc.css', 'asset'],
    ['fonts/source.woff2', 'asset'],
    ['icons/icon-192.png', 'asset'],
    ['manifest.webmanifest', 'asset'],
    ['pagefind/pagefind.js', 'search'],
    ['api/v1/index.json', 'data'],
    ['api/v1/days/2026-09-20.json', 'data'],
    ['api/v1/readme.txt', 'network'],
    ['', 'page'],
    ['2026-09-20/', 'page'],
    ['404.html', 'page'],
    ['sw.js', 'network'],
    ['robots.txt', 'network'],
    ['og/2026-09-20.png', 'network'],
  ])('%s → %s', (path, expected) => {
    expect(requestStrategy(get(path), SCOPE)).toBe(expected);
  });

  it('treats any navigation in scope as a page', () => {
    expect(requestStrategy(get('feed.xml', 'navigate'), SCOPE)).toBe('page');
  });

  it('leaves other methods, other origins and paths outside the scope to the network', () => {
    expect(requestStrategy({ ...get(''), method: 'POST' }, SCOPE)).toBe('network');
    expect(requestStrategy({ url: 'https://cdn.example.com/lectio/x/', method: 'GET', mode: 'cors' }, SCOPE)).toBe(
      'network',
    );
    expect(requestStrategy({ url: 'https://example.org/other/', method: 'GET', mode: 'navigate' }, SCOPE)).toBe(
      'network',
    );
  });
});

describe('paths and URLs', () => {
  it('scopedPath strips the scope and rejects what is outside it', () => {
    expect(scopedPath('https://example.org/lectio/a/b/?q=1', SCOPE)).toBe('a/b/');
    expect(scopedPath('https://example.org/lectio/', SCOPE)).toBe('');
    expect(scopedPath('https://example.org/elsewhere/', SCOPE)).toBeNull();
    expect(scopedPath('https://evil.example/lectio/', SCOPE)).toBeNull();
  });

  it('isPagePath accepts directory URLs and HTML files', () => {
    expect(isPagePath('')).toBe(true);
    expect(isPagePath('calendar/')).toBe(true);
    expect(isPagePath('404.html')).toBe(true);
    expect(isPagePath('robots.txt')).toBe(false);
  });

  it('cacheKey drops the query string and the fragment', () => {
    expect(cacheKey('https://example.org/lectio/search/?q=grace#top')).toBe('https://example.org/lectio/search/');
  });

  it('builds URLs under the scope', () => {
    expect(scopeUrl(SCOPE, '/calendar/')).toBe('https://example.org/lectio/calendar/');
    expect(scopeUrl(SCOPE, '')).toBe(SCOPE);
    expect(indexUrl(SCOPE)).toBe('https://example.org/lectio/api/v1/index.json');
    expect(dayDataUrl(SCOPE, '2026-09-20')).toBe('https://example.org/lectio/api/v1/days/2026-09-20.json');
    expect(dayPageUrls(SCOPE, '2026-09-20', ['first-reading', 'gospel'])).toEqual([
      'https://example.org/lectio/2026-09-20/',
      'https://example.org/lectio/2026-09-20/first-reading/',
      'https://example.org/lectio/2026-09-20/gospel/',
    ]);
  });
});

describe('dates', () => {
  it('deviceDate uses the local calendar date', () => {
    expect(deviceDate(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
    expect(deviceDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });

  it.each([
    ['2026-09-20', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-9-20', false],
    [20260920, false],
    [null, false],
  ])('isIsoDate(%s) is %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });

  it('addDays crosses months and years', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-28', 6)).toBe('2027-01-03');
    expect(addDays('2026-03-29', 0)).toBe('2026-03-29');
  });

  it('indexDates reads a valid range and rejects anything else', () => {
    const range = { first: '2026-01-01', last: '2027-12-31' };
    expect(indexDates({ apiVersion: 1, dates: range })).toEqual(range);
    expect(indexDates({ dates: null })).toBeNull();
    expect(indexDates({ dates: { first: '2026-01-01' } })).toBeNull();
    expect(indexDates({ dates: { first: '2027-01-01', last: '2026-01-01' } })).toBeNull();
    expect(indexDates({})).toBeNull();
    expect(indexDates(null)).toBeNull();
    expect(indexDates('index')).toBeNull();
  });

  it('upcomingDates is today and the six days after it, within the site dates', () => {
    const range = { first: '2026-01-01', last: '2026-12-31' };
    expect(upcomingDates('2026-09-20', range)).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
    expect(upcomingDates('2026-12-29', range)).toEqual(['2026-12-29', '2026-12-30', '2026-12-31']);
    expect(upcomingDates('2026-09-20', { first: '2026-09-19', last: '2026-09-21' })).toEqual([
      '2026-09-20',
      '2026-09-21',
    ]);
    expect(upcomingDates('2026-09-20', range, 2)).toEqual(['2026-09-20', '2026-09-21']);
    expect(upcomingDates('2026-09-20', null)).toEqual([]);
    expect(upcomingDates('not a date', range)).toEqual([]);
    expect(UPCOMING_DAY_COUNT).toBe(7);
  });
});

describe('daySlots', () => {
  it('lists each slot once, in order, across Masses', () => {
    const day = {
      masses: [
        { id: 'vigil', readings: [{ slot: 'first-reading' }, { slot: 'gospel' }] },
        { id: 'day', readings: [{ slot: 'first-reading' }, { slot: 'psalm' }, { slot: 'gospel' }] },
      ],
    };
    expect(daySlots(day)).toEqual(['first-reading', 'gospel', 'psalm']);
  });

  it('skips malformed Masses, readings and slots', () => {
    const day = {
      masses: [null, { readings: 'none' }, { readings: [null, { slot: 3 }, { slot: '../x' }, { slot: 'gospel' }] }],
    };
    expect(daySlots(day)).toEqual(['gospel']);
    expect(daySlots({})).toEqual([]);
    expect(daySlots(null)).toEqual([]);
  });
});

describe('lruEvictions', () => {
  it('drops the oldest keys beyond the limit', () => {
    expect(lruEvictions(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
    expect(lruEvictions(['a', 'b'], 2)).toEqual([]);
    expect(lruEvictions(Array.from({ length: VISITED_CACHE_LIMIT + 1 }, (_, i) => String(i)))).toEqual(['0']);
  });
});

describe('shouldPrefetch', () => {
  it('runs first, on a new date and after the interval', () => {
    expect(shouldPrefetch(null, '2026-09-20', 0)).toBe(true);
    const last = { today: '2026-09-20', at: 1000 };
    expect(shouldPrefetch(last, '2026-09-20', 1000 + PREFETCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPrefetch(last, '2026-09-20', 1000 + PREFETCH_INTERVAL_MS)).toBe(true);
    expect(shouldPrefetch(last, '2026-09-21', 1001)).toBe(true);
    expect(shouldPrefetch(last, '2026-09-20', 1500, 100)).toBe(true);
  });
});

describe('parseClientMessage', () => {
  it('accepts the three messages and rejects anything else', () => {
    expect(parseClientMessage({ type: 'prefetch', today: '2026-09-20' })).toEqual({
      type: 'prefetch',
      today: '2026-09-20',
    });
    expect(parseClientMessage({ type: 'skip-waiting' })).toEqual({ type: 'skip-waiting' });
    expect(parseClientMessage({ type: 'clear-offline-data', extra: 1 })).toEqual({ type: 'clear-offline-data' });
    expect(parseClientMessage({ type: 'prefetch', today: 'soon' })).toBeNull();
    expect(parseClientMessage({ type: 'other' })).toBeNull();
    expect(parseClientMessage('skip-waiting')).toBeNull();
    expect(parseClientMessage(null)).toBeNull();
  });
});

describe('precachePaths', () => {
  it('lists the built shell pages and assets, sorted and once each', () => {
    const files = [
      'index.html',
      'offline/index.html',
      '2026-09-20/index.html',
      '_astro/index.abc.css',
      '_astro/page.def.js',
      '_astro/brand-card.123.png',
      'fonts/source.woff2',
      'fonts/OFL.txt',
      'icons/icon-192.png',
      'icons/icon.svg',
      'manifest.webmanifest',
      'robots.txt',
      'api/v1/index.json',
      'pagefind/pagefind.js',
      'sw.js',
    ];
    expect(precachePaths(files)).toEqual([
      '',
      '_astro/index.abc.css',
      '_astro/page.def.js',
      'fonts/source.woff2',
      'icons/icon-192.png',
      'icons/icon.svg',
      'manifest.webmanifest',
      'offline/',
    ]);
  });

  it('leaves out shell pages that were not built', () => {
    expect(precachePaths(['settings/index.html'])).toEqual(['settings/']);
    expect(SHELL_PAGES).toContain('offline/');
  });
});

describe('isHashedAsset', () => {
  it('is true under _astro/ only', () => {
    expect(isHashedAsset('_astro/index.abc.css')).toBe(true);
    expect(isHashedAsset('fonts/a.woff2')).toBe(false);
  });
});

describe('entryDate', () => {
  it.each([
    ['2026-09-20/', '2026-09-20'],
    ['2026-09-20/gospel/', '2026-09-20'],
    ['api/v1/days/2026-09-20.json', '2026-09-20'],
    ['api/v1/index.json', null],
    ['calendar/2026/09/', null],
    ['2026-02-30/', null],
    ['2026-09-20.json', null],
  ])('%s → %s', (path, expected) => {
    expect(entryDate(new URL(path, SCOPE).href, SCOPE)).toBe(expected);
  });

  it('is null outside the scope', () => {
    expect(entryDate('https://example.org/2026-09-20/', SCOPE)).toBeNull();
  });
});

describe('referencedAssets', () => {
  it('finds hashed assets in HTML, CSS and JS, resolved against the referring URL', () => {
    const html =
      '<link rel="stylesheet" href="/lectio/_astro/index.abc.css">' +
      "<script type=module src='/lectio/_astro/page.def.js?v=1'></script>" +
      '<link rel="preload" href="/lectio/fonts/a.woff2">' +
      '<img src="https://cdn.example.com/_astro/x.png">' +
      '<a href="/lectio/_astro/index.abc.css#again">';
    expect(referencedAssets(html, new URL('2026-09-20/', SCOPE).href, SCOPE)).toEqual([
      'https://example.org/lectio/_astro/index.abc.css',
      'https://example.org/lectio/_astro/page.def.js',
    ]);
    const js = 'import{a}from"./chunk.123.js";import("./lazy.456.js");const u=`../fonts/b.woff2`;';
    expect(referencedAssets(js, new URL('_astro/page.def.js', SCOPE).href, SCOPE)).toEqual([
      'https://example.org/lectio/_astro/chunk.123.js',
      'https://example.org/lectio/_astro/lazy.456.js',
    ]);
    const css = '.a{background:url(./bg.789.png)}';
    expect(referencedAssets(css, new URL('_astro/index.abc.css', SCOPE).href, SCOPE)).toEqual([
      'https://example.org/lectio/_astro/bg.789.png',
    ]);
  });

  it('skips references that are not URLs', () => {
    expect(referencedAssets('"http://[bad.js"', SCOPE, SCOPE)).toEqual([]);
  });
});

describe('isTrustedSender', () => {
  it('trusts the scope origin, or a source page inside the scope when there is no origin', () => {
    expect(isTrustedSender('https://example.org', undefined, SCOPE)).toBe(true);
    expect(isTrustedSender('https://evil.example', url('2026-09-20/'), SCOPE)).toBe(false);
    expect(isTrustedSender('', 'https://example.org/lectio/settings/', SCOPE)).toBe(true);
    expect(isTrustedSender('', 'https://example.org/other/', SCOPE)).toBe(false);
    expect(isTrustedSender('', 'not a url', SCOPE)).toBe(false);
    expect(isTrustedSender('', undefined, SCOPE)).toBe(false);
  });

  function url(path: string): string {
    return new URL(path, SCOPE).href;
  }
});
