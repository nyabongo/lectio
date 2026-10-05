/**
 * Calendar names in English and Kiswahili (L-111): seasons, colours and celebrations. English
 * celebration names come from romcal (or the regional overrides); Kiswahili ones from the catalog
 * `calendar/i18n/sw.json` at the repository root. Every Kiswahili name carries its review status
 * (`provisional`, `reviewed`, `fallback`) so consumers can flag or hide unreviewed names.
 *
 * The catalog is data, not code: it is read from the repository root and validated on first use
 * (`loadNameCatalog`, cached), never at import time, so a broken catalog fails the build that uses
 * it rather than every importer of `@lectio/calendar`. Lookups take an explicit catalog or fall back
 * to `swahiliCatalog()`, the catalog of the repository around the working directory.
 *
 * Stable API for the web and app UIs (L-110 and later): `celebrationNameIn`, `celebrationStatusIn`,
 * `celebrationName`, `celebrationNames`, `seasonName`, `colourName`, `loadNameCatalog`,
 * `swahiliCatalog`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepoRoot } from '@lectio/config';
import type { LiturgicalColour } from '@lectio/schema/common';

import type { Season } from '../map.ts';
import { parseNameCatalog } from './catalog.ts';
import type { NameCatalog, NameStatus } from './catalog.ts';

export { NAME_STATUSES, catalogProblems, parseNameCatalog } from './catalog.ts';
export type { CatalogEntry, NameCatalog, NameStatus } from './catalog.ts';

/** Languages the calendar names exist in. */
export const CALENDAR_LOCALES = ['en', 'sw'] as const;
export type CalendarLocale = (typeof CALENDAR_LOCALES)[number];

/** `calendar/i18n/<locale>.json` under the repository root. */
export function nameCatalogPath(repoRoot: string, locale = 'sw'): string {
  return join(repoRoot, 'calendar', 'i18n', `${locale}.json`);
}

const loaded = new Map<string, NameCatalog>();

/** The catalog of `locale` in the repository at `repoRoot`, read and validated once per path. Throws when invalid. */
export function loadNameCatalog(repoRoot: string, locale = 'sw'): NameCatalog {
  const path = nameCatalogPath(repoRoot, locale);
  let catalog = loaded.get(path);
  if (catalog === undefined) {
    catalog = parseNameCatalog(JSON.parse(readFileSync(path, 'utf8')), `calendar/i18n/${locale}.json`);
    loaded.set(path, catalog);
  }
  return catalog;
}

/**
 * The Kiswahili catalog of the repository around `start` (default: `INIT_CWD`, which npm sets to
 * where the command was typed, else the working directory). Loaded on first call.
 */
export function swahiliCatalog(start: string = process.env['INIT_CWD'] ?? process.cwd()): NameCatalog {
  return loadNameCatalog(findRepoRoot(start), 'sw');
}

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

/**
 * A celebration's names as `calendar/<year>.json` stores them (`names`). `sw` is the English name
 * when `swStatus` is `fallback`; consumers that care must read `swStatus`.
 */
export interface CelebrationNames {
  readonly en: string;
  readonly sw: string;
  readonly swStatus: NameStatus;
}

/** A name with its review status; `fallback` means the English name stands in. */
export interface LocalisedName {
  readonly name: string;
  readonly status: NameStatus;
}

/** The entry for `id` when it has a name (not a fallback); prototype keys never match. */
function namedEntry(catalog: NameCatalog, id: string): LocalisedName | undefined {
  const entry = Object.hasOwn(catalog.celebrations, id) ? catalog.celebrations[id] : undefined;
  return entry?.name ? { name: entry.name, status: entry.status } : undefined;
}

/**
 * The Kiswahili name of celebration `id` with its status, or `english` with status `fallback`
 * when the catalog has none (no entry, or an entry flagged `fallback`).
 */
export function celebrationName(id: string, english: string, catalog: NameCatalog = swahiliCatalog()): LocalisedName {
  return namedEntry(catalog, id) ?? { name: english, status: 'fallback' };
}

/** `{ en, sw, swStatus }` for a celebration, as the calendar build writes it. */
export function celebrationNames(
  id: string,
  english: string,
  catalog: NameCatalog = swahiliCatalog(),
): CelebrationNames {
  const { name, status } = celebrationName(id, english, catalog);
  return { en: english, sw: name, swStatus: status };
}

export interface NameInOptions {
  /** Also return names still waiting for review (default true); false returns only `reviewed` names. */
  readonly includeProvisional?: boolean;
  /** Defaults to {@link swahiliCatalog}. */
  readonly catalog?: NameCatalog;
}

/**
 * The translated name of celebration `id` in `locale`, or undefined when there is none (English,
 * another locale, an unknown id, a flagged fallback, or a provisional name with
 * `includeProvisional: false`): the caller keeps the calendar's own name. Matches the web's
 * `CelebrationLookup` adapter (L-110); {@link celebrationStatusIn} gives the status to flag it.
 */
export function celebrationNameIn(locale: string, id: string, options: NameInOptions = {}): string | undefined {
  if (locale !== 'sw') return undefined;
  const entry = namedEntry(options.catalog ?? swahiliCatalog(), id);
  if (entry === undefined || (options.includeProvisional === false && entry.status !== 'reviewed')) return undefined;
  return entry.name;
}

/**
 * The review status of celebration `id`'s name in `locale`: `fallback` when it has none, undefined
 * for English (the source language, nothing to review).
 */
export function celebrationStatusIn(
  locale: string,
  id: string,
  catalog: NameCatalog = swahiliCatalog(),
): NameStatus | undefined {
  if (locale === 'en') return undefined;
  if (locale !== 'sw') return 'fallback';
  return namedEntry(catalog, id)?.status ?? 'fallback';
}

/** The name of a season in `locale` (English when the catalog's entry is a fallback). */
export function seasonName(
  season: Season,
  locale: CalendarLocale = 'en',
  catalog: NameCatalog = swahiliCatalog(),
): string {
  const english = ENGLISH_SEASON_NAMES[season];
  return locale === 'en' ? english : (catalog.seasons[season].name ?? english);
}

/** The name of a liturgical colour in `locale` (English when the catalog's entry is a fallback). */
export function colourName(
  colour: LiturgicalColour,
  locale: CalendarLocale = 'en',
  catalog: NameCatalog = swahiliCatalog(),
): string {
  const english = ENGLISH_COLOUR_NAMES[colour];
  return locale === 'en' ? english : (catalog.colours[colour].name ?? english);
}

/** The ids among `ids` that have no catalog entry at all (not even a flagged fallback), sorted. */
export function unnamedCelebrations(ids: Iterable<string>, catalog: NameCatalog = swahiliCatalog()): string[] {
  return [...new Set(ids)].filter((id) => !Object.hasOwn(catalog.celebrations, id)).sort();
}
