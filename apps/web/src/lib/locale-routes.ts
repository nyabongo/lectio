/**
 * Which pages get a `/<locale>/` mirror (L-110). The mirrors are not files: the `lectio:i18n` integration
 * (src/integrations/i18n.ts) lists the page files with `listPageFiles` and injects one route per non-default locale
 * and page with `localeRoutes`, rendered by the same page file. A page reads its language from its URL
 * (`localeOf(Astro.url)` in src/i18n/index.ts), so a new page type is localised with no other edit. Build-time only (it reads the disk).
 */
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Pages that never get a locale mirror: the not-found and error pages, and the offline fallback the service worker
 * (L-061) serves for any page it has not saved, are served once for the whole site.
 */
export const UNLOCALISED_PAGES: ReadonlySet<string> = new Set(['404', '500', 'offline']);

/** One injected route: the `/<locale>/…` pattern and the page file that renders it. */
export interface LocaleRoute {
  readonly pattern: string;
  readonly entrypoint: string;
}

/**
 * The route pattern of a page file (relative to `src/pages`, with `/` separators) when it is an Astro page that
 * gets locale mirrors, else `null`: `calendar/[yyyy]/[mm]/index.astro` is `/calendar/[yyyy]/[mm]`, `index.astro`
 * is `/`. Endpoints (`.ts`, the JSON API), files and directories starting with `_` or `.`, the
 * `UNLOCALISED_PAGES` and anything already under a locale directory are left out.
 */
export function pagePattern(file: string, locales: readonly string[]): string | null {
  if (!file.endsWith('.astro')) return null;
  const segments = file.slice(0, -'.astro'.length).split('/');
  if (segments.some((segment) => segment === '' || segment.startsWith('_') || segment.startsWith('.'))) return null;
  if (segments.length > 1 && locales.includes(segments[0] as string)) return null;
  if (segments.at(-1) === 'index') segments.pop();
  if (segments.length === 1 && UNLOCALISED_PAGES.has(segments[0] as string)) return null;
  return `/${segments.join('/')}`;
}

/**
 * The injected routes for every locale but the default one: each localisable page in `files` (relative to
 * `pagesDir`) under `/<locale>`, rendered by the same file. Sorted by locale, then by file.
 */
export function localeRoutes(
  files: readonly string[],
  pagesDir: string,
  locales: readonly string[],
  defaultLocale: string,
): LocaleRoute[] {
  const pages = [...files].sort().flatMap((file) => {
    const pattern = pagePattern(file, locales);
    return pattern === null ? [] : [{ file, pattern }];
  });
  return locales
    .filter((locale) => locale !== defaultLocale)
    .flatMap((locale) =>
      pages.map(({ file, pattern }) => ({
        pattern: pattern === '/' ? `/${locale}` : `/${locale}${pattern}`,
        entrypoint: join(pagesDir, ...file.split('/')),
      })),
    );
}

/** Every file under `dir`, relative to it with `/` separators, sorted. */
export async function listPageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}
