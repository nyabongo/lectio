/**
 * Calendar names in English and Kiswahili (L-111): seasons, colours and celebrations. English
 * celebration names come from romcal (or the regional overrides); Kiswahili ones from
 * `calendar/i18n/sw.json`. A celebration without a Kiswahili name falls back to its English name
 * with status `fallback`, so a lookup never fails.
 *
 * Stable API for the web and app UIs (L-110 and later): `seasonName`, `colourName`,
 * `celebrationName`, `celebrationNames` and the `SWAHILI` catalog.
 */
import type { LiturgicalColour } from '@lectio/schema/common';

import swahiliData from '../../../../calendar/i18n/sw.json' with { type: 'json' };
import type { Season } from '../map.ts';
import { parseNameCatalog } from './catalog.ts';
import type { NameCatalog, NameStatus } from './catalog.ts';

export { NAME_STATUSES, catalogProblems, parseNameCatalog } from './catalog.ts';
export type { CatalogEntry, NameCatalog, NameStatus } from './catalog.ts';

/** Languages the calendar names exist in. */
export const CALENDAR_LOCALES = ['en', 'sw'] as const;
export type CalendarLocale = (typeof CALENDAR_LOCALES)[number];

/** `calendar/i18n/sw.json`, checked when the module loads. */
export const SWAHILI: NameCatalog = parseNameCatalog(swahiliData, 'calendar/i18n/sw.json');

/** English season names, as the Roman Missal prints them. */
export const ENGLISH_SEASON_NAMES: Readonly<Record<Season, string>> = Object.freeze({
  advent: 'Advent',
  christmas: 'Christmas Time',
  'ordinary-time': 'Ordinary Time',
  lent: 'Lent',
  'paschal-triduum': 'Paschal Triduum',
  easter: 'Easter Time',
});

/** English colour names. */
export const ENGLISH_COLOUR_NAMES: Readonly<Record<LiturgicalColour, string>> = Object.freeze({
  white: 'White',
  red: 'Red',
  green: 'Green',
  violet: 'Violet',
  rose: 'Rose',
  black: 'Black',
  gold: 'Gold',
});

/** A celebration's name in both languages, as `calendar/<year>.json` stores it (`names`). */
export interface CelebrationNames {
  readonly en: string;
  readonly sw: string;
}

/** A name with its review status; `fallback` means the English name stands in. */
export interface LocalisedName {
  readonly name: string;
  readonly status: NameStatus;
}

/**
 * The Kiswahili name of celebration `id`, or `english` with status `fallback` when the catalog
 * has none (no entry, or an entry flagged `fallback`).
 */
export function celebrationName(id: string, english: string, catalog: NameCatalog = SWAHILI): LocalisedName {
  const entry = Object.hasOwn(catalog.celebrations, id) ? catalog.celebrations[id] : undefined;
  return entry?.name ? { name: entry.name, status: entry.status } : { name: english, status: 'fallback' };
}

/** `{ en, sw }` for a celebration; `sw` is the English name when there is no Kiswahili one. */
export function celebrationNames(id: string, english: string, catalog: NameCatalog = SWAHILI): CelebrationNames {
  return { en: english, sw: celebrationName(id, english, catalog).name };
}

/** The name of a season in `locale` (English when the catalog's entry is a fallback). */
export function seasonName(season: Season, locale: CalendarLocale = 'en', catalog: NameCatalog = SWAHILI): string {
  const english = ENGLISH_SEASON_NAMES[season];
  return locale === 'en' ? english : (catalog.seasons[season].name ?? english);
}

/** The name of a liturgical colour in `locale` (English when the catalog's entry is a fallback). */
export function colourName(
  colour: LiturgicalColour,
  locale: CalendarLocale = 'en',
  catalog: NameCatalog = SWAHILI,
): string {
  const english = ENGLISH_COLOUR_NAMES[colour];
  return locale === 'en' ? english : (catalog.colours[colour].name ?? english);
}

/** The ids among `ids` that have no catalog entry at all (not even a flagged fallback), sorted. */
export function unnamedCelebrations(ids: Iterable<string>, catalog: NameCatalog = SWAHILI): string[] {
  return [...new Set(ids)].filter((id) => !Object.hasOwn(catalog.celebrations, id)).sort();
}
