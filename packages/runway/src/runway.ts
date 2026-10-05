/**
 * The content runway: which upcoming days still lack approved notes.
 *
 * Pages work without notes (they show references and link-outs), so a gap is not an outage,
 * but the research job can stall and the owner needs to know early.
 */
import type { ContentRepo } from '@lectio/content';
import { addDays, dateRange, isIsoDate } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

/**
 * Why a day counts as missing:
 * - `notes`: at least one reading (in any Mass) has no passage file, or one that is not approved;
 * - `no-calendar`: the calendar has no entry for the date (for example the year is not built yet).
 */
export type MissingReason = 'notes' | 'no-calendar';

export interface MissingDay {
  readonly date: IsoDate;
  readonly reason: MissingReason;
  /** Passage keys of the readings without an approved note, sorted and unique (empty for `no-calendar`). */
  readonly missing: readonly string[];
}

export interface RunwayInput {
  /** First day of the window (usually today in the site's time zone). */
  readonly from: IsoDate;
  /** Number of days checked, `from` included. */
  readonly windowDays: number;
  readonly repo: ContentRepo;
}

export interface RunwayReport {
  readonly from: IsoDate;
  /** Last day of the window (inclusive). */
  readonly to: IsoDate;
  readonly windowDays: number;
  /** Days in the window that lack an approved note, in date order. */
  readonly days: readonly MissingDay[];
}

/**
 * Checks every date from `from` for `windowDays` days and returns those where any reading lacks
 * an approved note, with the missing passage keys. Days whose calendar entry has no readings (a
 * day the lectionary does not cover yet) have nothing to research and are not reported.
 */
export function computeRunway({ from, windowDays, repo }: RunwayInput): RunwayReport {
  if (!isIsoDate(from)) throw new RangeError(`from must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(from)}`);
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(`windowDays must be a positive integer, got ${String(windowDays)}`);
  }
  const to = addDays(from, windowDays - 1);
  const resolved = new Map(repo.listDays(from, to).map((day) => [day.date, day]));
  const days: MissingDay[] = [];
  for (const date of dateRange(from, to)) {
    const day = resolved.get(date);
    if (day === undefined) {
      days.push({ date, reason: 'no-calendar', missing: [] });
      continue;
    }
    const missing = new Set<string>();
    for (const mass of day.masses) {
      for (const reading of mass.readings) if (!reading.approved) missing.add(reading.key);
    }
    if (missing.size > 0) days.push({ date, reason: 'notes', missing: [...missing].sort() });
  }
  return { from, to, windowDays, days };
}

/** The alarm condition: more missing days than `maxMissingDays` allows. */
export function isExceeded(report: RunwayReport, maxMissingDays: number): boolean {
  return report.days.length > maxMissingDays;
}

/** Every passage key missing somewhere in the window, sorted and unique. */
export function missingPassages(report: RunwayReport): string[] {
  return [...new Set(report.days.flatMap((day) => day.missing))].sort();
}
