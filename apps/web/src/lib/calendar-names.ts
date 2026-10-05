/**
 * Celebration names in the page language (L-110), behind one adapter so the site can switch to L-111's lookup
 * (`packages/calendar/src/i18n`, backed by `calendar/i18n/<locale>.json`) with a one-line change: point
 * `celebrationLookup` at it. Until then no locale has translated names, so every page shows the calendar's English
 * name. Season, rank and colour names are UI strings and already come from the catalogs (`day.season.*` …).
 */

/** The fields of a calendar celebration the adapter needs. */
export interface NamedCelebration {
  readonly id: string;
  readonly name: string;
}

/** A celebration's name in `locale`, or `undefined` when there is no translation. */
export type CelebrationLookup = (locale: string, id: string) => string | undefined;

/** The lookup the site uses. L-111: replace with its API, e.g. `(locale, id) => celebrationNameIn(locale, id)`. */
export const celebrationLookup: CelebrationLookup = () => undefined;

/** The celebration's name in `locale`, falling back to the calendar's (English) name; as is without a locale. */
export function celebrationName(
  celebration: NamedCelebration,
  locale?: string,
  lookup: CelebrationLookup = celebrationLookup,
): string {
  return locale === undefined ? celebration.name : (lookup(locale, celebration.id) ?? celebration.name);
}
