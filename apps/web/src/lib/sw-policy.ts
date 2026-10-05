/**
 * The service worker's caching policy (L-061) as pure functions: cache names, which requests get which strategy,
 * the next seven days to keep offline, the URLs of a day, the LRU trim and the precache list. The worker itself
 * (`src/sw/worker.ts`) only wires these to Cache Storage and `fetch`; the build step (`src/sw/build.ts`) uses the
 * precache helpers. Nothing here touches the network, the clock or the DOM, and the worker bundle imports this file,
 * so it must stay free of Node and Astro imports.
 *
 * Caches:
 * - `lectio-shell-<version>`: the precached app shell (CSS, JS, fonts, icons, manifest, the offline page and a few
 *   shell pages). Versioned per build; older shell caches are deleted on activate.
 * - `lectio-search-<version>`: the Pagefind bundle, cached at run time (stale-while-revalidate). Pagefind writes its
 *   files after the service worker's build hook, so they cannot be precached.
 * - `lectio-data-upcoming`: the next seven days (day page, reading pages and day JSON), refreshed on activate and
 *   whenever a page opens.
 * - `lectio-data-visited`: pages and API documents the reader opened, stale-while-revalidate with an LRU cap.
 *
 * The data caches carry `OFFLINE_DATA_CACHE_PREFIX` (`lectio-data-`, from settings.ts), so Settings → Clear offline
 * data removes them and keeps the shell.
 */
import { OFFLINE_DATA_CACHE_PREFIX } from './settings.ts';

export { OFFLINE_DATA_CACHE_PREFIX };

/** Prefix of the versioned app-shell precache. Deliberately not `lectio-data-`. */
export const SHELL_CACHE_PREFIX = 'lectio-shell-';

/** Prefix of the versioned run-time cache for the Pagefind bundle. */
export const SEARCH_CACHE_PREFIX = 'lectio-search-';

/** The next seven days: today and the six days after it. */
export const UPCOMING_DAY_COUNT = 7;

/** How many visited pages and API documents the visited cache keeps (least recently used go first). */
export const VISITED_CACHE_LIMIT = 60;

/** A page open asks for a refresh of the upcoming days at most this often (per worker), unless the date changed. */
export const PREFETCH_INTERVAL_MS = 15 * 60 * 1000;

/** The worker's file name at the base path. */
export const SERVICE_WORKER_FILE = 'sw.js';

/** Where the static API lives under the base path. */
export const API_PREFIX = 'api/v1/';

/** Where Pagefind writes its bundle under the base path. */
export const PAGEFIND_PREFIX = 'pagefind/';

/** The offline fallback page, relative to the base path. */
export const OFFLINE_PAGE = 'offline/';

/** Every cache name the worker uses for one build. */
export interface CacheNames {
  readonly shell: string;
  readonly search: string;
  readonly upcoming: string;
  readonly visited: string;
}

export function cacheNames(version: string): CacheNames {
  return {
    shell: `${SHELL_CACHE_PREFIX}${version}`,
    search: `${SEARCH_CACHE_PREFIX}${version}`,
    upcoming: `${OFFLINE_DATA_CACHE_PREFIX}upcoming`,
    visited: `${OFFLINE_DATA_CACHE_PREFIX}visited`,
  };
}

/** True for a Lectio cache from another build (an old shell or search cache), which activate deletes. */
export function isObsoleteCache(name: string, version: string): boolean {
  const current = cacheNames(version);
  return (
    (name.startsWith(SHELL_CACHE_PREFIX) && name !== current.shell) ||
    (name.startsWith(SEARCH_CACHE_PREFIX) && name !== current.search)
  );
}

/** True for a cache that "Clear offline data" removes. */
export function isOfflineDataCache(name: string): boolean {
  return name.startsWith(OFFLINE_DATA_CACHE_PREFIX);
}

/** How the worker answers a request. `network` means it does not answer at all (the browser fetches as usual). */
export type Strategy =
  /** Cache first from the shell cache, filled at run time if missing (hashed assets, fonts, icons, manifest). */
  | 'asset'
  /** Stale-while-revalidate over the data caches and the shell; a miss goes to the network, then the offline page. */
  | 'page'
  /** Stale-while-revalidate over the data caches (API JSON). */
  | 'data'
  /** Stale-while-revalidate in the search cache (the Pagefind bundle). */
  | 'search'
  | 'network';

/** What the policy needs to know about a request. */
export interface RequestInfo {
  readonly url: string;
  readonly method: string;
  /** `Request.mode`; `navigate` for page loads. */
  readonly mode: string;
}

const ASSET_PATTERN = /^(?:_astro\/|fonts\/|icons\/|manifest\.webmanifest$)/;

/** The path of `url` relative to `scope` (an absolute URL ending in `/`), or `null` when it is outside it. */
export function scopedPath(url: string, scope: string): string | null {
  const target = new URL(url);
  const root = new URL(scope);
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) return null;
  return target.pathname.slice(root.pathname.length);
}

/** True when `path` (relative to the base) looks like an HTML page: a directory URL or an `.html` file. */
export function isPagePath(path: string): boolean {
  return path === '' || path.endsWith('/') || path.endsWith('.html');
}

/** The strategy for a request, given the worker's scope (`registration.scope`). */
export function requestStrategy(request: RequestInfo, scope: string): Strategy {
  if (request.method !== 'GET') return 'network';
  const path = scopedPath(request.url, scope);
  if (path === null || path === SERVICE_WORKER_FILE) return 'network';
  if (ASSET_PATTERN.test(path)) return 'asset';
  if (path.startsWith(PAGEFIND_PREFIX)) return 'search';
  if (path.startsWith(API_PREFIX)) return path.endsWith('.json') ? 'data' : 'network';
  if (request.mode === 'navigate' || isPagePath(path)) return 'page';
  return 'network';
}

/** The key a page or document is cached under: the URL without its query string and fragment. */
export function cacheKey(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

/** `YYYY-MM-DD` of a calendar date in the device's own time zone. */
export function deviceDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** `date` plus `days` (calendar arithmetic in UTC, so no time zone or DST shifts). */
export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** The slice of `/api/v1/index.json` the worker reads: the first and last dates the site has. */
export interface IndexDates {
  readonly first: string;
  readonly last: string;
}

/** The `dates` range of an index document, or `null` when it is missing or malformed. */
export function indexDates(index: unknown): IndexDates | null {
  if (typeof index !== 'object' || index === null) return null;
  const { dates } = index as { dates?: unknown };
  if (typeof dates !== 'object' || dates === null) return null;
  const { first, last } = dates as { first?: unknown; last?: unknown };
  return isIsoDate(first) && isIsoDate(last) && first <= last ? { first, last } : null;
}

/** The next `count` dates from `today` (inclusive) that fall within the site's dates. */
export function upcomingDates(today: string, range: IndexDates | null, count = UPCOMING_DAY_COUNT): string[] {
  if (range === null || !isIsoDate(today)) return [];
  return Array.from({ length: count }, (_, offset) => addDays(today, offset)).filter(
    (date) => date >= range.first && date <= range.last,
  );
}

/** The reading slots of a `days/{date}.json` document, in order and without repeats (shared slots appear once). */
export function daySlots(day: unknown): string[] {
  const slots = new Set<string>();
  const masses = (day as { masses?: unknown } | null)?.masses;
  if (!Array.isArray(masses)) return [];
  for (const mass of masses as unknown[]) {
    const readings = (mass as { readings?: unknown } | null)?.readings;
    if (!Array.isArray(readings)) continue;
    for (const reading of readings as unknown[]) {
      const slot = (reading as { slot?: unknown } | null)?.slot;
      if (typeof slot === 'string' && /^[a-z0-9-]+$/.test(slot)) slots.add(slot);
    }
  }
  return [...slots];
}

/** Absolute URL of `path` under the worker scope. */
export function scopeUrl(scope: string, path: string): string {
  return new URL(path.replace(/^\/+/, ''), scope).href;
}

/** URL of the API index. */
export function indexUrl(scope: string): string {
  return scopeUrl(scope, `${API_PREFIX}index.json`);
}

/** URL of a day's API document. */
export function dayDataUrl(scope: string, date: string): string {
  return scopeUrl(scope, `${API_PREFIX}days/${date}.json`);
}

/** The pages kept offline for one upcoming day: the day page and one Reading page per slot. */
export function dayPageUrls(scope: string, date: string, slots: readonly string[]): string[] {
  return [scopeUrl(scope, `${date}/`), ...slots.map((slot) => scopeUrl(scope, `${date}/${slot}/`))];
}

/** The keys to delete so that at most `limit` remain; `keys` are oldest first (Cache Storage insertion order). */
export function lruEvictions(keys: readonly string[], limit: number = VISITED_CACHE_LIMIT): string[] {
  return keys.length > limit ? keys.slice(0, keys.length - limit) : [];
}

/** Whether a page open should refresh the upcoming days: the date changed or the last run is old enough. */
export function shouldPrefetch(
  last: { readonly today: string; readonly at: number } | null,
  today: string,
  now: number,
  interval: number = PREFETCH_INTERVAL_MS,
): boolean {
  return last === null || last.today !== today || now - last.at >= interval;
}

/** Messages a page sends the worker. */
export type ClientMessage =
  | { readonly type: 'prefetch'; readonly today: string }
  | { readonly type: 'skip-waiting' }
  | { readonly type: 'clear-offline-data' };

/** The message, if `data` is one the worker understands. */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, today } = data as { type?: unknown; today?: unknown };
  if (type === 'prefetch') return isIsoDate(today) ? { type, today } : null;
  if (type === 'skip-waiting' || type === 'clear-offline-data') return { type };
  return null;
}

/** Shell pages precached with the assets, relative to the base: the home page, the offline page and Settings. */
export const SHELL_PAGES: readonly string[] = ['', OFFLINE_PAGE, 'settings/'];

/** Built files precached as assets: hashed bundles, fonts, icons and the manifest. */
const PRECACHE_FILE = /^(?:_astro\/.+\.(?:css|js|mjs)|fonts\/.+\.woff2|icons\/.+\.(?:png|svg)|manifest\.webmanifest)$/;

/**
 * The precache list for a build: `files` are paths relative to the output directory (`/`-separated). Assets are
 * listed as they are; a shell page `x/` is listed when `x/index.html` was built. Sorted, without repeats.
 */
export function precachePaths(files: readonly string[]): string[] {
  const built = new Set(files);
  const assets = files.filter((file) => PRECACHE_FILE.test(file));
  const pages = SHELL_PAGES.filter((page) => built.has(`${page}index.html`));
  return [...new Set([...pages, ...assets])].sort();
}

/** The worker's build-time configuration, injected into the bundle. */
export interface ServiceWorkerConfig {
  /** Changes whenever a precached file changes; names the shell and search caches. */
  readonly version: string;
  /** Precached paths relative to the scope (`''` is the home page). */
  readonly precache: readonly string[];
}
