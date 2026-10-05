/**
 * Sitemap and robots.txt settings, used by `src/integrations/sitemap.ts`: the `@astrojs/sitemap` options derived
 * from `config.site`, and the `Sitemap:` line of the built robots.txt (public/robots.txt ships the default site's
 * URL; the build rewrites it for the configured site and base path).
 */
import { readFile, writeFile } from 'node:fs/promises';

import type { SitemapOptions } from '@astrojs/sitemap';
import type { LectioConfig } from '@lectio/config';

import { absoluteUrl } from './seo.ts';
import { normaliseBase } from './site.ts';

/** The sitemap index `@astrojs/sitemap` writes at the root of the build. */
export const SITEMAP_INDEX = 'sitemap-index.xml';

/**
 * Pages that are `noindex` and so stay out of the sitemap, by their last path segment (in any locale and under
 * any base path): the search page (L-060) has no content of its own.
 */
export const NOINDEX_PAGES: ReadonlySet<string> = new Set(['search']);

/**
 * Whether a built URL is an HTML page that belongs in the sitemap. Files with an extension (the static JSON API,
 * OG images, feeds) are not pages, nor are the `NOINDEX_PAGES`; `@astrojs/sitemap` already leaves out the 404 page.
 */
export function isSitemapPage(url: string): boolean {
  const { pathname } = new URL(url);
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  // A directory URL (`…/search/`): its page name is the segment before the trailing slash.
  if (last === '')
    return !pathname
      .split('/')
      .slice(-2, -1)
      .some((segment) => NOINDEX_PAGES.has(segment));
  return !last.includes('.') || last.endsWith('.html');
}

/** The `@astrojs/sitemap` options for `config`: the page filter and, once there are several locales, hreflang. */
export function sitemapOptions(config: Pick<LectioConfig, 'site'>): NonNullable<SitemapOptions> {
  const { locales, defaultLocale } = config.site;
  if (locales.length < 2) return { filter: isSitemapPage };
  return {
    filter: isSitemapPage,
    i18n: { defaultLocale, locales: Object.fromEntries(locales.map((locale) => [locale, locale])) },
  };
}

/** The absolute URL of the sitemap index for `config`'s site and base path. */
export function sitemapIndexUrl(config: Pick<LectioConfig, 'site'>): string {
  return absoluteUrl(config.site.baseUrl, normaliseBase(config.site.basePath), SITEMAP_INDEX);
}

/** robots.txt with its `Sitemap:` line pointing at `sitemapUrl` (replaced if present, appended otherwise). */
export function withSitemapLine(robots: string, sitemapUrl: string): string {
  const line = `Sitemap: ${sitemapUrl}`;
  if (/^sitemap:.*$/im.test(robots)) return robots.replace(/^sitemap:.*$/gim, line);
  const body = robots === '' || robots.endsWith('\n') ? robots : `${robots}\n`;
  return `${body}${line}\n`;
}

/**
 * Rewrites `robots.txt` in the build output `dir` so its `Sitemap:` line names `sitemapUrl`. Returns `false` (and
 * writes nothing) when the build has no robots.txt.
 */
export async function updateRobotsFile(dir: URL, sitemapUrl: string): Promise<boolean> {
  const file = new URL('robots.txt', dir);
  let robots: string;
  try {
    robots = await readFile(file, 'utf8');
  } catch {
    return false;
  }
  await writeFile(file, withSitemapLine(robots, sitemapUrl));
  return true;
}
