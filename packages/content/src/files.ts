/**
 * Reading and validating one content file: `passages/<key>.json` or `calendar/<year>.json`.
 * Shared by the repository loader and `npm run content:validate`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { validateCalendarYear } from '@lectio/schema/calendar';
import type { CalendarYear } from '@lectio/schema/calendar';
import { validatePassage } from '@lectio/schema/passage';
import type { Passage } from '@lectio/schema/passage';

import { ContentError, issuesFromAjv } from './errors.ts';
import type { ContentIssue } from './errors.ts';

/** Directory of the calendar year files, relative to the content root. */
export const CALENDAR_DIR = 'calendar';
/** Directory of the passage files, relative to the content root. */
export const PASSAGES_DIR = 'passages';

export type ContentKind = 'passage' | 'calendar';

/** The file-system calls the loader makes; tests inject their own. Both throw `ENOENT` for a missing path. */
export interface ContentFs {
  readFile(path: string): string;
  readdir(path: string): string[];
}

export const nodeFs: ContentFs = {
  readFile: (path) => readFileSync(path, 'utf8'),
  readdir: (path) => readdirSync(path),
};

/** True when `error` is a Node "no such file or directory" error. */
export function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

function fail(file: string, issues: readonly [ContentIssue, ...ContentIssue[]]): never {
  throw new ContentError(file, issues);
}

/** Parses JSON, or throws a `ContentError` pointing at the whole file. */
export function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return fail(file, [{ pointer: '', message: `not valid JSON (${(error as Error).message})` }]);
  }
}

/** Validates a passage against its schema and, when given, the key its file name promises. */
export function checkPassage(value: unknown, file: string, expectedKey?: string): Passage {
  if (!validatePassage(value)) return fail(file, issuesFromAjv(validatePassage.errors));
  if (expectedKey !== undefined && value.key !== expectedKey) {
    fail(file, [{ pointer: '/key', message: `must equal the file name key ${JSON.stringify(expectedKey)}` }]);
  }
  return value;
}

/**
 * Validates a calendar year against its schema and, when given, the year its file name promises.
 * Every day must fall inside `year`, so `resolveDay`, `listDays` and `datesForPassage` agree.
 */
export function checkCalendarYear(value: unknown, file: string, expectedYear?: number): CalendarYear {
  if (!validateCalendarYear(value)) return fail(file, issuesFromAjv(validateCalendarYear.errors));
  if (expectedYear !== undefined && value.year !== expectedYear) {
    fail(file, [{ pointer: '/year', message: `must equal the file name year ${String(expectedYear)}` }]);
  }
  const prefix = `${String(value.year)}-`;
  const outside = value.days.flatMap((day, index) =>
    day.date.startsWith(prefix)
      ? []
      : [{ pointer: `/days/${String(index)}/date`, message: `must fall in ${String(value.year)}` }],
  );
  const [first, ...rest] = outside;
  if (first !== undefined) fail(file, [first, ...rest]);
  return value;
}

/** `passage` for `…/passages/*.json`, `calendar` for `…/calendar/*.json`, otherwise `null`. */
export function contentKindOf(path: string): ContentKind | null {
  if (!path.endsWith('.json')) return null;
  const dir = basename(dirname(path));
  if (dir === PASSAGES_DIR) return 'passage';
  if (dir === CALENDAR_DIR) return 'calendar';
  return null;
}

const YEAR_FILE = /^([0-9]{4})\.json$/;

/** The year a calendar file name promises (`2026.json` → 2026), or `null`. */
export function yearOfFileName(name: string): number | null {
  const match = YEAR_FILE.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Parses and validates the text of a content file, checking it against the key or year in
 * its file name. Returns the typed value or throws a `ContentError` naming `file`.
 */
export function checkContentText(kind: ContentKind, text: string, file: string): Passage | CalendarYear {
  const value = parseJson(text, file);
  const name = basename(file);
  if (kind === 'passage') return checkPassage(value, file, name.slice(0, -'.json'.length));
  const year = yearOfFileName(name);
  if (year === null) fail(file, [{ pointer: '', message: 'calendar files are named <year>.json' }]);
  return checkCalendarYear(value, file, year);
}
