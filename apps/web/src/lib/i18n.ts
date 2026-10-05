/**
 * UI string catalogs, plural-aware translation, date formatting and locale-prefixed paths for the site.
 *
 * Catalogs are JSON files at `src/i18n/<locale>/<feature>.json`; `src/i18n/index.ts` loads them with
 * `import.meta.glob` and hands them to `buildCatalogs`, which flattens each file into dotted keys namespaced by the
 * file name (`en/day.json` → `{ "title": "…" }` gives the key `day.title`). Adding a feature catalog is adding a
 * file: nothing else changes.
 *
 * A catalog value is a string or a nested object. An object whose keys are all `Intl.PluralRules` categories and
 * that has `other` (`{ "one": "{count} note", "other": "{count} notes" }`) is a plural message: `t` picks the form
 * for `params.count`. `{name}` placeholders are filled from `params`.
 *
 * Everything here is pure (no file system, no config) so it is unit-tested directly; `src/i18n/index.ts` binds it
 * to the real catalogs and the config's timezone.
 */

/** The locale served at the site root, and the fallback for keys a locale has not translated yet. */
export const DEFAULT_LOCALE = 'en';

/** Placeholder values for `t`. `count` also selects the plural form. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** A plural message: one string per `Intl.PluralRules` category, `other` required. */
export type PluralMessage = Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>;

/** A flattened message: plain text or a plural message. */
export type Message = string | PluralMessage;

/** One locale's messages by dotted key. */
export type LocaleCatalog = ReadonlyMap<string, Message>;

/** Every locale's messages, plus the file that defined each key (for error messages and the catalog tests). */
export interface Catalogs {
  readonly locales: ReadonlyMap<string, LocaleCatalog>;
  /** `<locale>:<key>` → the catalog path that defined it. */
  readonly sources: ReadonlyMap<string, string>;
}

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const CATALOG_PATH = /(?:^|\/)([^/]+)\/([^/]+)\.json$/;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPluralMessage(value: Record<string, unknown>): value is PluralMessage {
  const keys = Object.keys(value);
  return keys.includes('other') && keys.every((key) => PLURAL_CATEGORIES.has(key) && typeof value[key] === 'string');
}

/** The `<locale>` and `<feature>` of a catalog path such as `./en/common.json`. */
export function parseCatalogPath(path: string): { locale: string; feature: string } {
  const match = CATALOG_PATH.exec(path);
  if (match === null) throw new Error(`catalog path must look like <locale>/<feature>.json, got ${path}`);
  const [, locale = '', feature = ''] = match;
  if (!feature.split('.').every((segment) => SEGMENT.test(segment)))
    throw new Error(`catalog feature name must be letters, digits, "-" or "_", got ${path}`);
  return { locale, feature };
}

/** Flattens one catalog file's JSON into dotted keys under `namespace`. */
export function flattenCatalog(value: unknown, namespace: string, path: string): [string, Message][] {
  if (typeof value === 'string') return [[namespace, value]];
  if (!isRecord(value)) throw new Error(`${path}: "${namespace}" must be a string or an object`);
  if (isPluralMessage(value)) return [[namespace, value]];
  const entries = Object.entries(value);
  if (entries.length === 0) throw new Error(`${path}: "${namespace}" is an empty object`);
  return entries.flatMap(([key, child]) => {
    if (!SEGMENT.test(key))
      throw new Error(`${path}: key "${key}" under "${namespace}" must be letters, digits, "-" or "_"`);
    return flattenCatalog(child, `${namespace}.${key}`, path);
  });
}

/**
 * Merges catalog modules (path → parsed JSON, as `import.meta.glob(..., { eager: true })` returns them, with or
 * without a `default` wrapper) into per-locale flat catalogs. Throws when two files define the same key.
 */
export function buildCatalogs(modules: Readonly<Record<string, unknown>>): Catalogs {
  const locales = new Map<string, Map<string, Message>>();
  const sources = new Map<string, string>();
  for (const path of Object.keys(modules).sort()) {
    const { locale, feature } = parseCatalogPath(path);
    const module = modules[path];
    const json = isRecord(module) && 'default' in module ? module.default : module;
    let catalog = locales.get(locale);
    if (catalog === undefined) {
      catalog = new Map();
      locales.set(locale, catalog);
    }
    for (const [key, message] of flattenCatalog(json, feature, path)) {
      const source = `${locale}:${key}`;
      const previous = sources.get(source);
      if (previous !== undefined)
        throw new Error(`key "${key}" (${locale}) is defined in both ${previous} and ${path}`);
      sources.set(source, path);
      catalog.set(key, message);
    }
  }
  return { locales, sources };
}

/** The Intl locale used to format numbers, plurals and dates for a site locale (British-style dates for English). */
export function intlLocale(locale: string): string {
  return locale === 'en' ? 'en-GB' : locale;
}

function lookup(catalogs: Catalogs, locale: string, key: string): Message | undefined {
  return catalogs.locales.get(locale)?.get(key) ?? catalogs.locales.get(DEFAULT_LOCALE)?.get(key);
}

function interpolate(text: string, locale: string, key: string, params: MessageParams): string {
  return text.replace(/\{(\w+)\}/g, (_placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`message "${key}" needs the parameter "${name}"`);
    return typeof value === 'number' ? new Intl.NumberFormat(intlLocale(locale)).format(value) : value;
  });
}

/**
 * The message for `key` in `locale` (falling back to the default locale), with `{name}` placeholders filled from
 * `params`. A plural message picks its form with `Intl.PluralRules` for `params.count`. Throws on an unknown key
 * or a missing parameter, so a broken string fails the build instead of shipping.
 */
export function translate(catalogs: Catalogs, locale: string, key: string, params: MessageParams = {}): string {
  const message = lookup(catalogs, locale, key);
  if (message === undefined) throw new Error(`unknown message key "${key}" (${locale})`);
  if (typeof message === 'string') return interpolate(message, locale, key, params);
  const { count } = params;
  if (typeof count !== 'number') throw new Error(`plural message "${key}" needs a numeric "count" parameter`);
  const category = new Intl.PluralRules(intlLocale(locale)).select(count);
  return interpolate(message[category] ?? message.other, locale, key, params);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date as the site writes it, e.g. `Sunday 20 September 2026` in English. An ISO date string (`YYYY-MM-DD`) is
 * a calendar day and is formatted as is; a `Date` is an instant and is formatted as the day it falls on in
 * `timeZone` (the config's `site.timezone`). `options` replaces the default weekday-day-month-year format.
 */
export function formatDate(
  locale: string,
  date: string | Date,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  let instant: Date;
  let zone = timeZone;
  if (typeof date === 'string') {
    instant = new Date(`${date}T00:00:00Z`);
    if (!ISO_DATE.test(date) || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== date)
      throw new RangeError(`date must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(date)}`);
    zone = 'UTC';
  } else {
    if (Number.isNaN(date.getTime())) throw new RangeError('date is an invalid Date');
    instant = date;
  }
  const format = options ?? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const parts = new Intl.DateTimeFormat(intlLocale(locale), { ...format, timeZone: zone }).formatToParts(instant);
  // The site's style drops the comma after the weekday: "Sunday 20 September 2026".
  return parts
    .map((part, index) => (part.type === 'literal' && parts[index - 1]?.type === 'weekday' ? ' ' : part.value))
    .join('');
}

/**
 * A root-relative site path for `locale`: the default locale stays at the root (`/calendar/`), every other locale
 * lives under `/<locale>/` (`/sw/calendar/`). Combine with `withBase` (src/lib/site.ts) for the base path.
 */
export function localePath(locale: string, path = ''): string {
  const rest = path.replace(/^\/+/, '');
  return locale === DEFAULT_LOCALE ? `/${rest}` : `/${locale}/${rest}`;
}
