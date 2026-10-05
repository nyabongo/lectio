import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isSitemapPage,
  SITEMAP_INDEX,
  sitemapIndexUrl,
  sitemapOptions,
  updateRobotsFile,
  withSitemapLine,
} from './sitemap.ts';

function withSite(site: Partial<LectioConfig['site']>): Pick<LectioConfig, 'site'> {
  return { site: { ...DEFAULT_CONFIG.site, ...site } };
}

describe('isSitemapPage', () => {
  it.each([
    ['https://nyabongo.github.io/lectio/', true],
    ['https://nyabongo.github.io/lectio/calendar/', true],
    ['https://nyabongo.github.io/lectio/2026-09-20/gospel/', true],
    ['https://nyabongo.github.io/lectio/page.html', true],
    ['https://nyabongo.github.io/lectio/api/v1/days/2026-09-20.json', false],
    ['https://nyabongo.github.io/lectio/og/2026-09-20.png', false],
    ['https://nyabongo.github.io/lectio/feed.xml', false],
  ])('%s is %s', (url, expected) => {
    expect(isSitemapPage(url)).toBe(expected);
  });
});

describe('sitemapOptions', () => {
  it('filters pages and has no i18n block with one locale', () => {
    const options = sitemapOptions(DEFAULT_CONFIG);
    expect(options.filter).toBe(isSitemapPage);
    expect(options.i18n).toBeUndefined();
  });

  it('maps every locale for hreflang once there are several', () => {
    const options = sitemapOptions(withSite({ locales: ['en', 'sw'], defaultLocale: 'en' }));
    expect(options.i18n).toEqual({ defaultLocale: 'en', locales: { en: 'en', sw: 'sw' } });
  });
});

describe('sitemapIndexUrl', () => {
  it('is the index under the base path', () => {
    expect(sitemapIndexUrl(DEFAULT_CONFIG)).toBe(`https://nyabongo.github.io/lectio/${SITEMAP_INDEX}`);
  });

  it('works at a domain root', () => {
    expect(sitemapIndexUrl(withSite({ baseUrl: 'https://lectio.example/', basePath: '' }))).toBe(
      'https://lectio.example/sitemap-index.xml',
    );
  });
});

describe('withSitemapLine', () => {
  const url = 'https://lectio.example/sitemap-index.xml';

  it('replaces an existing Sitemap line, whatever its case', () => {
    expect(withSitemapLine('User-agent: *\nsitemap: https://old.example/s.xml\n', url)).toBe(
      `User-agent: *\nSitemap: ${url}\n`,
    );
  });

  it('appends a line when there is none', () => {
    expect(withSitemapLine('User-agent: *\nAllow: /\n', url)).toBe(`User-agent: *\nAllow: /\nSitemap: ${url}\n`);
    expect(withSitemapLine('User-agent: *', url)).toBe(`User-agent: *\nSitemap: ${url}\n`);
    expect(withSitemapLine('', url)).toBe(`Sitemap: ${url}\n`);
  });
});

describe('updateRobotsFile', () => {
  let dir: string;
  let dirUrl: URL;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lectio-robots-'));
    dirUrl = pathToFileURL(`${dir}/`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rewrites the built robots.txt', async () => {
    await writeFile(join(dir, 'robots.txt'), 'User-agent: *\nSitemap: https://old.example/s.xml\n');
    expect(await updateRobotsFile(dirUrl, 'https://lectio.example/sitemap-index.xml')).toBe(true);
    expect(await readFile(join(dir, 'robots.txt'), 'utf8')).toBe(
      'User-agent: *\nSitemap: https://lectio.example/sitemap-index.xml\n',
    );
  });

  it('does nothing when the build has no robots.txt', async () => {
    expect(await updateRobotsFile(dirUrl, 'https://lectio.example/sitemap-index.xml')).toBe(false);
  });
});

describe('public/robots.txt', () => {
  it('allows crawling and names the default site sitemap', async () => {
    const robots = await readFile(new URL('../../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toContain(`Sitemap: ${sitemapIndexUrl(DEFAULT_CONFIG)}`);
  });
});
