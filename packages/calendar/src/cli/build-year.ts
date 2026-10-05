/**
 * Builds `calendar/<year>.json` (L-017): the region's calendar (romcal + overrides, L-015), the
 * readings the lectionary resolver gives each day (L-016) and a link-out per reading (L-007).
 *
 * The output is deterministic: days sorted by date, every object built with a fixed key order,
 * two-space JSON with LF line endings and a final newline. `calendar:check` relies on it to
 * compare a fresh build with the committed file byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { Lectionary, loadLectionary, refKey, resolveDay } from '@lectio/lectionary';
import type { ResolvedReading } from '@lectio/lectionary';
import { VersificationError, linkoutUrl } from '@lectio/refs';
import { validateCalendarYear } from '@lectio/schema/calendar';
import type { CalendarDay, CalendarYear, Mass, Reading } from '@lectio/schema/calendar';

import { romcalVersion } from '../generate.ts';
import { toCalendarDay } from '../map.ts';
import type { DetailedDay } from '../map.ts';
import { generateRegionalDays, loadOverrides, overridesPath } from '../overrides/region.ts';

/** The link-out URL of a reading (`key`) on `date`; throws `VersificationError` when it has none. */
export type LinkoutFor = (key: string, date: string) => string;

export interface AssembleInput {
  readonly year: number;
  readonly region: string;
  readonly generatedBy: string;
  /** The region's detailed days, sorted by date (`generateRegionalDays`). */
  readonly days: readonly DetailedDay[];
  readonly lectionary: Lectionary;
  readonly linkout: LinkoutFor;
}

export interface BuildResult {
  readonly calendar: CalendarYear;
  /** Readings left out because they have no link-out, and similar notes for the build log. */
  readonly warnings: readonly string[];
}

/** `@lectio/calendar <version> (romcal <version>)`, for `generatedBy`. */
export function generatedBy(packageVersion: string, romcal: string = romcalVersion()): string {
  return `@lectio/calendar ${packageVersion} (romcal ${romcal})`;
}

/** The version in `packages/calendar/package.json`. */
export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

/** The `linkout` of the config as a {@link LinkoutFor}. */
export function configLinkout(config: Pick<LectioConfig, 'linkout'>): LinkoutFor {
  return (key, date) => linkoutUrl(key, date, config).url;
}

/** The key of a ref, or undefined when it does not parse. */
function keyOf(ref: string): string | undefined {
  try {
    return refKey(ref);
  } catch {
    return undefined;
  }
}

/**
 * The citation the calendar shows: as printed (letters kept) when the source records it and it
 * names the same passage as the key, else the canonical ref. A printed form such as Greek Esther's
 * `Est 4:17n, p-r, aa-bb, gg-hh` (OLM numbering for Est C:12, 14-16, 23-25) does not parse, so it falls back.
 */
function displayRef(reading: ResolvedReading, date: string, warnings: string[]): string {
  const { printed } = reading;
  if (printed === undefined) return reading.ref;
  if (keyOf(printed) === reading.key) return printed;
  warnings.push(
    `${date} ${reading.slot} ${reading.key}: printed "${printed}" does not match the key; using "${reading.ref}"`,
  );
  return reading.ref;
}

function toReading(reading: ResolvedReading, date: string, linkout: LinkoutFor, warnings: string[]): Reading[] {
  const ref = displayRef(reading, date, warnings);
  try {
    return [{ slot: reading.slot, ref, key: reading.key, linkout: linkout(reading.key, date) }];
  } catch (error) {
    if (!(error instanceof VersificationError)) throw error;
    warnings.push(`${date} ${reading.slot} ${reading.key}: left out, no link-out (${error.message})`);
    return [];
  }
}

/**
 * One day with its Masses. `lectionaryMissing` is true when the lectionary has no data for the
 * day (`masses: []`), when a Mass lacks a slot it needs (L-070 reports those days) or when a
 * reading was left out for want of a link-out; Masses left without any reading are dropped.
 */
export function assembleDay(
  day: DetailedDay,
  lectionary: Lectionary,
  linkout: LinkoutFor,
  warnings: string[],
): CalendarDay {
  let incomplete = false;
  const masses: Mass[] = [];
  for (const mass of resolveDay(day, lectionary).masses) {
    const readings = mass.readings.flatMap((reading) => toReading(reading, day.date, linkout, warnings));
    if (mass.missingSlots.length > 0 || readings.length < mass.readings.length) incomplete = true;
    if (readings.length > 0) masses.push({ id: mass.id, label: mass.label, readings });
  }
  return toCalendarDay({ ...day, masses, lectionaryMissing: masses.length === 0 || incomplete });
}

/** The calendar year file for already generated days. Pure: no I/O. */
export function assembleYear(input: AssembleInput): BuildResult {
  const warnings: string[] = [];
  const days = [...input.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => assembleDay(day, input.lectionary, input.linkout, warnings));
  return {
    calendar: { year: input.year, region: input.region, generatedBy: input.generatedBy, days },
    warnings,
  };
}

/**
 * Problems the schema cannot see (docs/content-model.md): the schema itself, dates unique, sorted
 * and inside the year, and each reading's key matching its ref.
 */
export function calendarProblems(calendar: CalendarYear): string[] {
  if (!validateCalendarYear(calendar)) {
    // ajv always sets `errors` when validation fails.
    const errors = validateCalendarYear.errors as NonNullable<typeof validateCalendarYear.errors>;
    return errors.map((e) => `schema: ${e.instancePath || '/'} ${String(e.message)}`);
  }
  const problems: string[] = [];
  const prefix = `${String(calendar.year)}-`;
  calendar.days.forEach((day, index) => {
    const previous = calendar.days[index - 1];
    if (!day.date.startsWith(prefix)) problems.push(`${day.date}: outside ${String(calendar.year)}`);
    if (previous !== undefined && previous.date >= day.date) {
      problems.push(`${day.date}: not after ${previous.date} (dates must be unique and sorted)`);
    }
    for (const mass of day.masses) {
      for (const reading of mass.readings) {
        let key: string;
        try {
          key = refKey(reading.ref);
        } catch (error) {
          key = `(${(error as Error).message})`;
        }
        if (key !== reading.key) {
          problems.push(
            `${day.date} ${mass.id} ${reading.slot}: key ${reading.key} does not match ref "${reading.ref}"`,
          );
        }
      }
    }
  });
  return problems;
}

/** The file text: two-space JSON, LF, final newline. Key order is the order the objects were built in. */
export function serialiseCalendar(calendar: CalendarYear): string {
  return `${JSON.stringify(calendar, null, 2)}\n`;
}

/** `calendar/<year>.json` under the repository root. */
export function calendarPath(repoRoot: string, year: number): string {
  return join(repoRoot, 'calendar', `${String(year)}.json`);
}

export interface BuildOptions {
  readonly repoRoot: string;
  readonly year: number;
  readonly region: string;
  readonly config: Pick<LectioConfig, 'linkout'>;
  /** Defaults to {@link generatedBy} of this package's version. */
  readonly generatedBy?: string;
}

/**
 * Builds one year from the repository: `calendar/overrides/<region>.json`, `calendar/lectionary/`
 * and the config's link-out provider. Throws when the lectionary data or the result is invalid.
 */
export async function buildYear(options: BuildOptions): Promise<BuildResult> {
  const { repoRoot, year, region } = options;
  const overrides = await loadOverrides(overridesPath(repoRoot, region));
  const loaded = await loadLectionary(join(repoRoot, 'calendar', 'lectionary'));
  if (loaded.problems.length > 0) {
    throw new Error(
      `calendar/lectionary has problems (run npm run lectionary:check):\n  ${loaded.problems.join('\n  ')}`,
    );
  }
  const { days } = await generateRegionalDays(year, overrides);
  const result = assembleYear({
    year,
    region,
    generatedBy: options.generatedBy ?? generatedBy(packageVersion()),
    days,
    lectionary: new Lectionary(loaded.files),
    linkout: configLinkout(options.config),
  });
  const problems = calendarProblems(result.calendar);
  if (problems.length > 0) throw new Error(`calendar ${String(year)} is invalid:\n  ${problems.join('\n  ')}`);
  return result;
}
