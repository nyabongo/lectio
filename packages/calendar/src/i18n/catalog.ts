/**
 * Name catalogs (`calendar/i18n/<locale>.json`, L-111): the names of the liturgical seasons, the
 * colours and every celebration id in one language, each with a review status. Pure: the caller
 * reads the file, `parseNameCatalog` checks its shape.
 */
import { SEASONS } from '@lectio/schema/calendar';
import { LITURGICAL_COLOURS } from '@lectio/schema/common';
import type { LiturgicalColour } from '@lectio/schema/common';

import type { Season } from '../map.ts';

/**
 * `provisional`: drafted, waiting for a native speaker's review. `reviewed`: checked by a native
 * speaker. `fallback`: no name in this language yet (`name` is null); the English name is shown.
 */
export const NAME_STATUSES = ['provisional', 'reviewed', 'fallback'] as const;
export type NameStatus = (typeof NAME_STATUSES)[number];

/** One name in a catalog. `name` is null exactly when `status` is `fallback`. */
export interface CatalogEntry {
  readonly name: string | null;
  readonly status: NameStatus;
  /** Why the entry is a fallback, or what a reviewer should check. */
  readonly note?: string;
}

export interface NameCatalog {
  /** BCP 47 language tag, e.g. `sw`. */
  readonly locale: string;
  /** The language's own name, e.g. `Kiswahili`. */
  readonly language: string;
  readonly seasons: Readonly<Record<Season, CatalogEntry>>;
  readonly colours: Readonly<Record<LiturgicalColour, CatalogEntry>>;
  /** Keyed by Lectio celebration id. */
  readonly celebrations: Readonly<Record<string, CatalogEntry>>;
}

const TOP_LEVEL_KEYS = new Set(['locale', 'language', 'description', 'sources', 'seasons', 'colours', 'celebrations']);
const ENTRY_KEYS = new Set(['name', 'status', 'note']);
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function entryProblems(path: string, value: unknown): string[] {
  if (!isRecord(value)) return [`${path}: must be an object with name and status`];
  const problems = Object.keys(value)
    .filter((key) => !ENTRY_KEYS.has(key))
    .map((key) => `${path}: unknown key ${JSON.stringify(key)}`);
  const { name, status, note } = value;
  if (!NAME_STATUSES.includes(status as NameStatus)) {
    problems.push(`${path}.status: must be one of ${NAME_STATUSES.join(', ')}`);
  } else if (status === 'fallback' ? name !== null : !isText(name)) {
    problems.push(
      status === 'fallback'
        ? `${path}.name: must be null for a fallback`
        : `${path}.name: must be a non-empty string (use status "fallback" with name null when there is none)`,
    );
  }
  if (note !== undefined && !isText(note)) problems.push(`${path}.note: must be a non-empty string`);
  return problems;
}

/** Checks a table that must name exactly `keys` (seasons, colours). */
function closedTableProblems(path: string, value: unknown, keys: readonly string[]): string[] {
  if (!isRecord(value)) return [`${path}: must be an object`];
  const problems = keys.filter((key) => !Object.hasOwn(value, key)).map((key) => `${path}.${key}: missing`);
  for (const [key, entry] of Object.entries(value)) {
    if (keys.includes(key)) problems.push(...entryProblems(`${path}.${key}`, entry));
    else problems.push(`${path}: unknown key ${JSON.stringify(key)}`);
  }
  return problems;
}

/** Every problem with a catalog's shape; empty when it is valid. */
export function catalogProblems(data: unknown): string[] {
  if (!isRecord(data)) return ['catalog: must be an object'];
  const problems = Object.keys(data)
    .filter((key) => !TOP_LEVEL_KEYS.has(key))
    .map((key) => `catalog: unknown key ${JSON.stringify(key)}`);
  if (typeof data['locale'] !== 'string' || !LOCALE.test(data['locale'])) {
    problems.push('locale: must be a language tag such as "sw"');
  }
  if (!isText(data['language'])) problems.push('language: must be a non-empty string');
  problems.push(...closedTableProblems('seasons', data['seasons'], SEASONS));
  problems.push(...closedTableProblems('colours', data['colours'], LITURGICAL_COLOURS));
  const celebrations = data['celebrations'];
  if (!isRecord(celebrations)) {
    problems.push('celebrations: must be an object');
  } else {
    for (const [id, entry] of Object.entries(celebrations)) {
      if (SLUG.test(id)) problems.push(...entryProblems(`celebrations.${id}`, entry));
      else problems.push(`celebrations: ${JSON.stringify(id)} is not a celebration id`);
    }
  }
  return problems;
}

/** The catalog, checked; throws listing every problem. `source` names the file in the message. */
export function parseNameCatalog(data: unknown, source = 'name catalog'): NameCatalog {
  const problems = catalogProblems(data);
  if (problems.length > 0) throw new Error(`Invalid ${source}:\n  ${problems.join('\n  ')}`);
  return data as NameCatalog;
}
