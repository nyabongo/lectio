/**
 * Celebration names in the page language (L-110), behind one adapter so the site can switch to L-111's lookup
 * (`packages/calendar/src/i18n`, backed by `calendar/i18n/<locale>.json`) with a one-line change: point
 * `celebrationLookup` at it. Until then no locale has translated names, so every page shows the calendar's English
 * name, and the adapter says so (`lang`) so the page can mark it `lang="en"` (WCAG 3.1.2). Season, rank and colour
 * names are UI strings and already come from the catalogs (`day.season.*` …).
 */

/** The language of the names in the committed calendars. */
export const CALENDAR_LOCALE = 'en';

/** The fields of a calendar celebration the adapter needs. */
export interface NamedCelebration {
  readonly id: string;
  readonly name: string;
}

/** A celebration's name in `locale`, or `undefined` when there is no translation. */
export type CelebrationLookup = (locale: string, id: string) => string | undefined;

/** The lookup the site uses. L-111: replace with its API, e.g. `(locale, id) => celebrationNameIn(locale, id)`. */
export const celebrationLookup: CelebrationLookup = () => undefined;

/** A name and, when it is not in the page locale, the language it is in. */
export interface LocalisedName {
  readonly name: string;
  /** Set only when the name fell back to another language than the page's (`lang` attribute value). */
  readonly lang?: string | undefined;
}

/**
 * The celebration's name in `locale`, falling back to the calendar's (English) name with `lang` set to it. Without
 * a locale, or in the calendar's own locale, the calendar name as is.
 */
export function celebrationName(
  celebration: NamedCelebration,
  locale?: string,
  lookup: CelebrationLookup = celebrationLookup,
): LocalisedName {
  if (locale === undefined || locale === CALENDAR_LOCALE) return { name: celebration.name };
  const translated = lookup(locale, celebration.id);
  return translated === undefined ? { name: celebration.name, lang: CALENDAR_LOCALE } : { name: translated };
}
