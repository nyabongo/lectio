import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { UNLOCALISED_PAGES, listPageFiles, localeRoutes, pagePattern } from './locale-routes.ts';

const locales = ['en', 'sw'] as const;

describe('pagePattern', () => {
  it('turns Astro page files into route patterns', () => {
    expect(pagePattern('index.astro', locales)).toBe('/');
    expect(pagePattern('about/index.astro', locales)).toBe('/about');
    expect(pagePattern('calendar/[yyyy]/[mm]/index.astro', locales)).toBe('/calendar/[yyyy]/[mm]');
    expect(pagePattern('[date]/[slot]/notes/[noteId]/index.astro', locales)).toBe('/[date]/[slot]/notes/[noteId]');
    expect(pagePattern('feed.astro', locales)).toBe('/feed');
  });

  it('leaves out endpoints, private files, the not-found page and locale directories', () => {
    expect(pagePattern('api/v1/index.json.ts', locales)).toBeNull();
    expect(pagePattern('about/_Licence.astro', locales)).toBeNull();
    expect(pagePattern('search/_search-page.test.ts', locales)).toBeNull();
    expect(pagePattern('_drafts/index.astro', locales)).toBeNull();
    expect(pagePattern('.hidden/index.astro', locales)).toBeNull();
    expect(pagePattern('404.astro', locales)).toBeNull();
    expect(pagePattern('sw/index.astro', locales)).toBeNull();
    expect(pagePattern('en/index.astro', locales)).toBeNull();
    expect(pagePattern('/index.astro', locales)).toBeNull();
    expect([...UNLOCALISED_PAGES]).toEqual(['404', '500']);
  });
});

describe('localeRoutes', () => {
  const files = ['settings/index.astro', 'index.astro', '404.astro', 'api/v1/index.json.ts', '[date]/index.astro'];

  it('mirrors every page for every non-default locale, rendered by the same file', () => {
    expect(localeRoutes(files, '/site/src/pages', [...locales, 'pt-BR'], 'en')).toEqual([
      { pattern: '/sw/[date]', entrypoint: join('/site/src/pages', '[date]', 'index.astro') },
      { pattern: '/sw', entrypoint: join('/site/src/pages', 'index.astro') },
      { pattern: '/sw/settings', entrypoint: join('/site/src/pages', 'settings', 'index.astro') },
      { pattern: '/pt-BR/[date]', entrypoint: join('/site/src/pages', '[date]', 'index.astro') },
      { pattern: '/pt-BR', entrypoint: join('/site/src/pages', 'index.astro') },
      { pattern: '/pt-BR/settings', entrypoint: join('/site/src/pages', 'settings', 'index.astro') },
    ]);
  });

  it('injects nothing for a single-locale site', () => {
    expect(localeRoutes(files, '/site/src/pages', ['en'], 'en')).toEqual([]);
  });
});

describe('listPageFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-pages-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists every file below a directory with / separators, sorted', async () => {
    for (const file of ['index.astro', 'calendar/[yyyy]/[mm]/index.astro', 'api/v1/index.json.ts']) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), '');
    }
    expect(await listPageFiles(dir)).toEqual([
      'api/v1/index.json.ts',
      'calendar/[yyyy]/[mm]/index.astro',
      'index.astro',
    ]);
  });

  it('localises every real page type and nothing else', async () => {
    const pagesDir = fileURLToPath(new URL('../pages/', import.meta.url));
    const patterns = localeRoutes(await listPageFiles(pagesDir), pagesDir, locales, 'en').map((r) => r.pattern);
    expect(patterns).toEqual(
      expect.arrayContaining([
        '/sw',
        '/sw/[date]',
        '/sw/[date]/[slot]',
        '/sw/[date]/[slot]/notes/[noteId]',
        '/sw/about',
        '/sw/calendar',
        '/sw/calendar/[yyyy]/[mm]',
        '/sw/passages',
        '/sw/passages/[key]',
        '/sw/search',
        '/sw/settings',
      ]),
    );
    expect(patterns.filter((pattern) => pattern.includes('api') || pattern.includes('404'))).toEqual([]);
  });
});
