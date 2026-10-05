/**
 * The logic behind `npm run calendar:report` (cli.ts only wires in process state): the completeness
 * report of the committed calendar files (./report.ts).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { findRepoRoot } from '@lectio/config';
import { Lectionary, loadLectionary } from '@lectio/lectionary';
import type { CalendarYear } from '@lectio/schema/calendar';

import { calendarPath, calendarProblems, epiphanyDate } from '../cli/build-year.ts';
import { committedYears, parseArgs } from '../cli/run.ts';
import type { CliIo } from '../cli/run.ts';
import { generateRegionalDays, loadOverrides, overridesPath } from '../overrides/region.ts';
import { KNOWN_GAPS } from './gaps.ts';
import type { KnownGap } from './gaps.ts';
import { countStatuses, formatTotals, formatYear, resolveOptions, unexpected, yearReport } from './report.ts';
import type { ReadingStats, YearReport } from './report.ts';

export interface StatsOptions {
  readonly repoRoot: string;
  readonly year: number;
  readonly region: string;
}

export interface ReportContext {
  readonly repoRoot: string;
  /** The statuses of a year's readings: {@link resolvedStats}, or a fake in tests. */
  readonly stats: (options: StatsOptions) => Promise<ReadingStats>;
  /** Defaults to {@link KNOWN_GAPS}. */
  readonly gaps?: readonly KnownGap[];
}

/**
 * Resolves every day of `year` in `region` again (romcal, the region's overrides, the lectionary
 * data) and counts the statuses of the readings; the calendar files do not record them.
 */
export async function resolvedStats(options: StatsOptions): Promise<ReadingStats> {
  const { repoRoot, year, region } = options;
  const overrides = await loadOverrides(overridesPath(repoRoot, region));
  const loaded = await loadLectionary(join(repoRoot, 'calendar', 'lectionary'));
  if (loaded.problems.length > 0) {
    throw new Error(
      `calendar/lectionary has problems (run npm run lectionary:check):\n  ${loaded.problems.join('\n  ')}`,
    );
  }
  const { days } = await generateRegionalDays(year, overrides);
  return countStatuses(days, new Lectionary(loaded.files), resolveOptions(epiphanyDate(days)));
}

/** The repository above `INIT_CWD` (npm sets it to where the command was typed), else `cwd`. */
export function reportContext(env: NodeJS.ProcessEnv, cwd: string): ReportContext {
  return { repoRoot: findRepoRoot(env['INIT_CWD'] ?? cwd), stats: resolvedStats };
}

const USAGE = 'usage: calendar:report [-- [--year <YYYY>]…]';

/** The committed calendar of `year`, or a message saying why it cannot be read. */
async function readCalendar(repoRoot: string, year: number): Promise<CalendarYear | string> {
  const file = `calendar/${String(year)}.json`;
  let text: string;
  try {
    text = await readFile(calendarPath(repoRoot, year), 'utf8');
  } catch {
    return `${file}: missing; run \`npm run calendar:build -- --year ${String(year)}\``;
  }
  let calendar: CalendarYear;
  try {
    calendar = JSON.parse(text) as CalendarYear;
  } catch (error) {
    return `${file}: not JSON (${(error as Error).message})`;
  }
  const problems = calendarProblems(calendar);
  return problems.length === 0 ? calendar : `${file}: invalid:\n  ${problems.join('\n  ')}`;
}

/**
 * `calendar:report [-- --year <YYYY>…]`: lists the days of each committed calendar year (or the given
 * years) that have `lectionaryMissing`, telling known gaps from unexpected ones, and counts the
 * readings by status. Exit code 0 when no day is missing beyond the known gaps, 1 when one is or a
 * file cannot be read or resolved, 2 on usage errors.
 */
export async function runReport(args: readonly string[], context: ReportContext, io: CliIo): Promise<number> {
  const parsed = parseArgs(args);
  if (typeof parsed === 'string' || parsed.region !== undefined) {
    io.err(`${typeof parsed === 'string' ? parsed : 'calendar:report reads the region from each file'}\n${USAGE}`);
    return 2;
  }
  const years = parsed.years.length > 0 ? parsed.years : await committedYears(context.repoRoot);
  if (years.length === 0) {
    io.err('calendar:report: no calendar/<year>.json files to report on');
    return 1;
  }
  const gaps = context.gaps ?? KNOWN_GAPS;
  const reports: YearReport[] = [];
  let failures = 0;
  for (const year of years) {
    const calendar = await readCalendar(context.repoRoot, year);
    if (typeof calendar === 'string') {
      io.err(calendar);
      failures += 1;
      continue;
    }
    let stats: ReadingStats;
    try {
      stats = await context.stats({ repoRoot: context.repoRoot, year, region: calendar.region });
    } catch (error) {
      io.err(`calendar/${String(year)}.json: could not resolve the readings: ${(error as Error).message}`);
      failures += 1;
      continue;
    }
    const report: YearReport = { ...yearReport(calendar, gaps), stats };
    reports.push(report);
    for (const line of formatYear(report)) io.out(line);
  }
  const bad = reports.reduce((n, report) => n + unexpected(report).length, 0);
  const summary = formatTotals(reports);
  if (bad === 0 && failures === 0) {
    io.out(summary);
    return 0;
  }
  io.err(summary);
  if (failures > 0) io.err(`calendar:report: ${String(failures)} calendar file(s) could not be reported on`);
  if (bad > 0) {
    io.err('Add the missing readings to calendar/lectionary/ and rebuild, or, for a documented gap, add it to');
    io.err('KNOWN_GAPS in packages/calendar/src/report/gaps.ts with its date, celebration and reason.');
  }
  return 1;
}
