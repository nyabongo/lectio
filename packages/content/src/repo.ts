/**
 * The content repository: `calendar/<year>.json` and `passages/<key>.json` under one root.
 * Files are read lazily, validated against their schema on first use and cached; an invalid
 * file throws a `ContentError` with its repository-relative path and a JSON pointer.
 */
import { join } from 'node:path';

import type { CalendarDay, CalendarYear, Mass, Reading } from '@lectio/schema/calendar';
import { PASSAGE_KEY_PATTERN } from '@lectio/schema/common';
import type { Passage } from '@lectio/schema/passage';
import { isIsoDate } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

import { ContentError } from './errors.ts';
import {
  CALENDAR_DIR,
  PASSAGES_DIR,
  checkCalendarYear,
  checkPassage,
  isMissing,
  nodeFs,
  parseJson,
  yearOfFileName,
} from './files.ts';
import type { ContentFs } from './files.ts';

/** A calendar reading with the passage notes for its key. */
export interface ResolvedReading extends Reading {
  /** The passage file for `key`, or `null` when none exists yet. */
  readonly passage: Passage | null;
  /** `true` when the passage exists and its review status is `approved`. */
  readonly approved: boolean;
}

export interface ResolvedMass extends Omit<Mass, 'readings'> {
  readonly readings: readonly ResolvedReading[];
}

/** One date: the calendar day as stored, and its Masses with every reading resolved. */
export interface ResolvedDay {
  readonly date: IsoDate;
  readonly day: CalendarDay;
  readonly masses: readonly ResolvedMass[];
}

export interface OpenRepoOptions {
  /** File-system access; defaults to Node's `fs`. */
  readonly fs?: ContentFs;
}

export interface ContentRepo {
  /** Absolute or caller-relative root the repository was opened at. */
  readonly root: string;
  /** The validated calendar for `year`, or `null` when `calendar/<year>.json` does not exist. */
  calendarYear(year: number): CalendarYear | null;
  /** Years that have a calendar file, ascending. */
  years(): number[];
  /** The validated passage for `key`, or `null` when `passages/<key>.json` does not exist. */
  passage(key: string): Passage | null;
  /** Keys of every passage file, sorted; files whose names are not passage keys are skipped. */
  passageKeys(): string[];
  /** The day for `date` with its readings resolved, or `null` when the calendar has no such day. */
  resolveDay(date: IsoDate): ResolvedDay | null;
  /** Every calendar day from `from` to `to` (inclusive), resolved, in date order; dates without a day are skipped. */
  listDays(from: IsoDate, to: IsoDate): ResolvedDay[];
  /** Every calendar date on which a reading has passage key `key`, ascending, across all calendar years. */
  datesForPassage(key: string): IsoDate[];
}

function requireDate(date: IsoDate, name: string): void {
  if (!isIsoDate(date)) throw new RangeError(`${name} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(date)}`);
}

const KEY_SHAPE = new RegExp(PASSAGE_KEY_PATTERN);

interface YearEntry {
  readonly calendar: CalendarYear;
  readonly byDate: Map<IsoDate, CalendarDay>;
}

/** Opens the content repository at `root` (the directory holding `calendar/` and `passages/`). */
export function openRepo(root: string, options: OpenRepoOptions = {}): ContentRepo {
  const fs = options.fs ?? nodeFs;
  const years = new Map<number, YearEntry | null>();
  const passages = new Map<string, Passage | null>();
  let keyIndex: Map<string, IsoDate[]> | undefined;

  /** Reads `relative` under the root; `null` when the file does not exist. */
  function readText(relative: string): string | null {
    try {
      return fs.readFile(join(root, relative));
    } catch (error) {
      if (isMissing(error)) return null;
      throw new ContentError(relative, [{ pointer: '', message: `cannot read file (${(error as Error).message})` }]);
    }
  }

  function listDir(relative: string): string[] {
    try {
      return fs.readdir(join(root, relative));
    } catch (error) {
      if (isMissing(error)) return [];
      throw new ContentError(relative, [
        { pointer: '', message: `cannot list directory (${(error as Error).message})` },
      ]);
    }
  }

  function loadYear(year: number): YearEntry | null {
    const cached = years.get(year);
    if (cached !== undefined) return cached;
    const file = `${CALENDAR_DIR}/${String(year)}.json`;
    const text = readText(file);
    let entry: YearEntry | null = null;
    if (text !== null) {
      const calendar = checkCalendarYear(parseJson(text, file), file, year);
      entry = { calendar, byDate: new Map(calendar.days.map((day) => [day.date, day])) };
    }
    years.set(year, entry);
    return entry;
  }

  function passage(key: string): Passage | null {
    if (!KEY_SHAPE.test(key)) throw new RangeError(`Not a passage key: ${JSON.stringify(key)}`);
    const cached = passages.get(key);
    if (cached !== undefined) return cached;
    const file = `${PASSAGES_DIR}/${key}.json`;
    const text = readText(file);
    const value = text === null ? null : checkPassage(parseJson(text, file), file, key);
    passages.set(key, value);
    return value;
  }

  function resolve(day: CalendarDay): ResolvedDay {
    return {
      date: day.date,
      day,
      masses: day.masses.map((mass) => ({
        ...mass,
        readings: mass.readings.map((reading) => {
          const notes = passage(reading.key);
          return { ...reading, passage: notes, approved: isApproved(notes) };
        }),
      })),
    };
  }

  function listYears(): number[] {
    return listDir(CALENDAR_DIR)
      .map(yearOfFileName)
      .filter((year) => year !== null)
      .sort((a, b) => a - b);
  }

  return {
    root,
    calendarYear: (year) => loadYear(year)?.calendar ?? null,
    years: listYears,
    passage,
    passageKeys: () =>
      listDir(PASSAGES_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter((key) => KEY_SHAPE.test(key))
        .sort(),
    resolveDay(date) {
      requireDate(date, 'date');
      const day = loadYear(Number(date.slice(0, 4)))?.byDate.get(date);
      return day === undefined ? null : resolve(day);
    },
    listDays(from, to) {
      requireDate(from, 'from');
      requireDate(to, 'to');
      const days: CalendarDay[] = [];
      for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
        const entry = loadYear(year);
        if (entry === null) continue;
        for (const day of entry.calendar.days) if (day.date >= from && day.date <= to) days.push(day);
      }
      return days.sort((a, b) => a.date.localeCompare(b.date)).map(resolve);
    },
    datesForPassage(key) {
      if (keyIndex === undefined) {
        const index = new Map<string, Set<IsoDate>>();
        for (const year of listYears()) {
          for (const day of loadYear(year)?.calendar.days ?? []) {
            for (const mass of day.masses) {
              for (const { key: readingKey } of mass.readings) {
                const dates = index.get(readingKey) ?? new Set<IsoDate>();
                dates.add(day.date);
                index.set(readingKey, dates);
              }
            }
          }
        }
        keyIndex = new Map([...index].map(([readingKey, dates]) => [readingKey, [...dates].sort()]));
      }
      return [...(keyIndex.get(key) ?? [])];
    },
  };
}

/** `true` when `passage` exists and has been approved (by a reviewer or the merge rule). */
export function isApproved(passage: Passage | null | undefined): passage is Passage {
  return passage?.review.status === 'approved';
}

/**
 * What a reader may see: the same day with every unapproved passage replaced by `null`.
 * The site and the API publish only approved notes. `null` (no such day) passes through, so
 * `approvedOnly(repo.resolveDay(date))` works directly.
 */
export function approvedOnly(day: ResolvedDay): ResolvedDay;
export function approvedOnly(day: ResolvedDay | null): ResolvedDay | null;
export function approvedOnly(day: ResolvedDay | null): ResolvedDay | null {
  if (day === null) return null;
  return {
    ...day,
    masses: day.masses.map((mass) => ({
      ...mass,
      readings: mass.readings.map((reading) => (reading.approved ? reading : { ...reading, passage: null })),
    })),
  };
}
