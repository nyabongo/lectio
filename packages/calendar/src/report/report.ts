/**
 * The completeness report (L-070): which days of a calendar year have `lectionaryMissing`, which of
 * those are known, documented gaps ({@link KNOWN_GAPS}), and how many of the year's readings are
 * still `provisional` (011, decision 4: every entry is provisional until a person checks it against
 * the Kenyan book). Pure: the CLI (./run.ts) does the I/O.
 */
import { resolveDay, STATUSES } from '@lectio/lectionary';
import type { EntryStatus, Lectionary, LectionaryDay, ResolveOptions } from '@lectio/lectionary';
import type { CalendarDay, CalendarYear } from '@lectio/schema/calendar';

import { KNOWN_GAPS } from './gaps.ts';
import type { KnownGap } from './gaps.ts';

export type StatusCounts = Readonly<Record<EntryStatus, number>>;

export interface ReadingStats {
  /** Readings the resolver gives the year's days (every Mass, every slot), by status. */
  readonly readings: StatusCounts;
  /** Distinct passages (keys) among them, by status. */
  readonly passages: StatusCounts;
}

export interface MissingDay {
  readonly date: string;
  readonly celebrations: readonly { readonly id: string; readonly name: string }[];
  /** The known gap that allows the day, if any. */
  readonly gap?: KnownGap;
}

export interface YearReport {
  readonly year: number;
  readonly region: string;
  readonly days: number;
  /** Readings in the calendar file. */
  readonly readings: number;
  /** Every day with `lectionaryMissing`, in date order. */
  readonly missing: readonly MissingDay[];
  /** Days a known gap names that now have their readings: the gap should be removed. */
  readonly filled: readonly { readonly date: string; readonly gap: KnownGap }[];
  readonly stats?: ReadingStats;
}

function zero(): Record<EntryStatus, number> {
  return { provisional: 0, verified: 0, disputed: 0 };
}

/** The statuses of the readings the resolver gives `days` (the calendar build's input). */
export function countStatuses(
  days: readonly LectionaryDay[],
  lectionary: Lectionary,
  options: ResolveOptions,
): ReadingStats {
  const readings = zero();
  const keys: Record<EntryStatus, Set<string>> = { provisional: new Set(), verified: new Set(), disputed: new Set() };
  for (const day of days) {
    for (const mass of resolveDay(day, lectionary, options).masses) {
      for (const reading of mass.readings) {
        readings[reading.status] += 1;
        keys[reading.status].add(reading.key);
      }
    }
  }
  const passages = zero();
  for (const status of STATUSES) passages[status] = keys[status].size;
  return { readings, passages };
}

/** The known gap that allows `day`: same month and day, and the gap's celebration is the principal one. */
export function knownGapFor(
  day: Pick<CalendarDay, 'date' | 'celebrations'>,
  gaps: readonly KnownGap[],
): KnownGap | undefined {
  const principal = day.celebrations[0]?.id;
  return gaps.find((gap) => day.date.endsWith(`-${gap.monthDay}`) && gap.celebrationId === principal);
}

/** The report of one calendar year (without reading statuses; add `stats` from {@link countStatuses}). */
export function yearReport(calendar: CalendarYear, gaps: readonly KnownGap[] = KNOWN_GAPS): YearReport {
  const missing: MissingDay[] = [];
  const filled: { date: string; gap: KnownGap }[] = [];
  let readings = 0;
  for (const day of calendar.days) {
    readings += day.masses.reduce((n, mass) => n + mass.readings.length, 0);
    const gap = knownGapFor(day, gaps);
    if (day.lectionaryMissing) {
      const celebrations = day.celebrations.map(({ id, name }) => ({ id, name }));
      missing.push(gap === undefined ? { date: day.date, celebrations } : { date: day.date, celebrations, gap });
    } else if (gap !== undefined) {
      filled.push({ date: day.date, gap });
    }
  }
  return { year: calendar.year, region: calendar.region, days: calendar.days.length, readings, missing, filled };
}

/** Missing days no known gap allows. */
export function unexpected(report: YearReport): MissingDay[] {
  return report.missing.filter((day) => day.gap === undefined);
}

function counts(counts: StatusCounts): string {
  return STATUSES.map((status) => `${String(counts[status])} ${status}`).join(', ');
}

function celebrationList(day: MissingDay): string {
  return day.celebrations.map((c) => `${c.id} (${c.name})`).join(', ') || '(no celebration)';
}

/** The report lines of one year. */
export function formatYear(report: YearReport): string[] {
  const bad = unexpected(report);
  const known = report.missing.length - bad.length;
  const lines = [
    `calendar/${String(report.year)}.json (${report.region}): ${String(report.days)} days, ${String(report.readings)} readings; ` +
      `${String(report.missing.length)} lectionaryMissing (${String(known)} known gap(s), ${String(bad.length)} unexpected)`,
  ];
  if (report.stats !== undefined) {
    lines.push(`  readings by status: ${counts(report.stats.readings)}`);
    lines.push(`  distinct passages by status: ${counts(report.stats.passages)}`);
  }
  for (const day of report.missing) {
    lines.push(
      day.gap === undefined
        ? `  MISSING ${day.date}: ${celebrationList(day)}`
        : `  known gap ${day.date}: ${celebrationList(day)}: ${day.gap.reason}`,
    );
  }
  for (const { date, gap } of report.filled) {
    lines.push(
      `  note: ${date} ${gap.celebrationId} now has readings; remove its entry from KNOWN_GAPS (report/gaps.ts)`,
    );
  }
  return lines;
}

/** The closing summary over every year reported. */
export function formatTotals(reports: readonly YearReport[]): string {
  const bad = reports.reduce((n, r) => n + unexpected(r).length, 0);
  const known = reports.reduce((n, r) => n + r.missing.length, 0) - bad;
  const totals = zero();
  for (const report of reports) {
    for (const status of STATUSES) totals[status] += report.stats?.readings[status] ?? 0;
  }
  return (
    `calendar:report: ${String(bad)} unexpected missing day(s) in ${String(reports.length)} year(s); ` +
    `${String(known)} known gap(s) allowed; readings ${counts(totals)}`
  );
}
