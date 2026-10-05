/**
 * The site's UI strings. Every `src/i18n/<locale>/<feature>.json` is picked up by the glob below and namespaced by
 * its file name, so a feature adds `en/<feature>.json` and calls `t(locale, '<feature>.<key>')`: no other edit.
 * Keys are string literals in `t(…)` calls: `index.test.ts` checks that every key used in `src` exists, that every
 * catalog key is used, and that no key is defined twice. The logic lives in `src/lib/i18n.ts`.
 *
 * Build-time only (pages and layouts): `formatDate` reads the config's timezone through `siteContext()`.
 */
import { buildCatalogs, formatDate as formatDateIn, translate } from '../lib/i18n.ts';
import type { MessageParams } from '../lib/i18n.ts';
import { siteContext } from '../lib/site.ts';

export { DEFAULT_LOCALE, localePath } from '../lib/i18n.ts';
export type { MessageParams } from '../lib/i18n.ts';

/** Every catalog, flattened per locale. */
export const catalogs = buildCatalogs(import.meta.glob('./*/*.json', { eager: true, import: 'default' }));

/** The message for `key` (e.g. `common.nav.calendar`) in `locale`; see `translate` in src/lib/i18n.ts. */
export function t(locale: string, key: string, params?: MessageParams): string {
  return translate(catalogs, locale, key, params);
}

/** `date` (an ISO date, or a `Date` taken in `config.site.timezone`) as the site writes it in `locale`. */
export function formatDate(locale: string, date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return formatDateIn(locale, date, siteContext().config.site.timezone, options);
}
