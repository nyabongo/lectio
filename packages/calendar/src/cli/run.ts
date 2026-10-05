/**
 * The logic behind `npm run calendar:build` and `npm run calendar:check` (build.ts, check.ts only
 * wire in process state).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';

import { MAX_YEAR, MIN_YEAR } from '../generate.ts';
import { buildYear, calendarPath, serialiseCalendar } from './build-year.ts';
import type { BuildOptions, BuildResult } from './build-year.ts';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CliContext {
  readonly repoRoot: string;
  readonly config: Pick<LectioConfig, 'linkout' | 'site'>;
  /** Builds one year: {@link buildYear}, or a fake in tests. */
  readonly build: (options: BuildOptions) => Promise<BuildResult>;
}

export interface CliArgs {
  readonly years: readonly number[];
  readonly region?: string;
}

/**
 * The context of a CLI run: the repository root above `INIT_CWD` (npm sets it to where the command
 * was typed), else `cwd`, and the config `loadConfig` finds from there.
 */
export function processContext(env: NodeJS.ProcessEnv, cwd: string): CliContext {
  const start = env['INIT_CWD'] ?? cwd;
  return { repoRoot: findRepoRoot(start), config: loadConfig(undefined, { env, cwd: start }), build: buildYear };
}

const REGION = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parses `[--year <YYYY>]… [--region <slug>]`; returns a usage message on bad input. */
export function parseArgs(args: readonly string[]): CliArgs | string {
  const years: number[] = [];
  let region: string | undefined;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '--year' && value !== undefined && /^\d{4}$/.test(value)) {
      const year = Number(value);
      if (year < MIN_YEAR || year > MAX_YEAR) return `--year must be from ${String(MIN_YEAR)} to ${String(MAX_YEAR)}`;
      if (!years.includes(year)) years.push(year);
    } else if (flag === '--region' && value !== undefined && REGION.test(value) && region === undefined) {
      region = value;
    } else {
      return `unexpected argument ${JSON.stringify(flag)}${value === undefined ? '' : ` ${JSON.stringify(value)}`}`;
    }
  }
  return region === undefined ? { years } : { years, region };
}

const BUILD_USAGE = 'usage: calendar:build -- --year <YYYY> [--year <YYYY>]… [--region <slug>]';
const CHECK_USAGE = 'usage: calendar:check [-- [--year <YYYY>]… [--region <slug>]]';

function warn(result: BuildResult, io: CliIo): void {
  for (const warning of result.warnings) io.err(`  warning: ${warning}`);
}

function summary(result: BuildResult): string {
  const { days } = result.calendar;
  const missing = days.filter((day) => day.lectionaryMissing).length;
  const readings = days.reduce((n, day) => n + day.masses.reduce((m, mass) => m + mass.readings.length, 0), 0);
  return `${String(days.length)} days, ${String(readings)} readings, ${String(missing)} lectionaryMissing`;
}

/**
 * `calendar:build -- --year <YYYY>… [--region <slug>]`: writes `calendar/<year>.json` for each year.
 * The region defaults to `site.region` in the config. Exit code 0 on success, 1 on build errors,
 * 2 on usage errors.
 */
export async function runBuild(args: readonly string[], context: CliContext, io: CliIo): Promise<number> {
  const parsed = parseArgs(args);
  if (typeof parsed === 'string' || parsed.years.length === 0) {
    io.err(typeof parsed === 'string' ? `${parsed}\n${BUILD_USAGE}` : BUILD_USAGE);
    return 2;
  }
  const region = parsed.region ?? context.config.site.region;
  const { build } = context;
  for (const year of parsed.years) {
    let result: BuildResult;
    try {
      result = await build({ repoRoot: context.repoRoot, year, region, config: context.config });
    } catch (error) {
      io.err(`calendar:build ${String(year)}: ${(error as Error).message}`);
      return 1;
    }
    await writeFile(calendarPath(context.repoRoot, year), serialiseCalendar(result.calendar));
    warn(result, io);
    io.out(`calendar:build ${String(year)} (${region}): ${summary(result)} → calendar/${String(year)}.json`);
  }
  return 0;
}

/** Years of the committed `calendar/<year>.json` files, ascending. */
export async function committedYears(repoRoot: string): Promise<number[]> {
  const names = await readdir(join(repoRoot, 'calendar'));
  return names
    .map((name) => /^(\d{4})\.json$/.exec(name)?.[1])
    .filter((year): year is string => year !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The first line where two texts differ (1-based), with both versions, or undefined when equal. */
export function firstDifference(
  expected: string,
  actual: string,
): { line: number; expected: string; actual: string } | undefined {
  if (expected === actual) return undefined;
  const a = expected.split('\n');
  const b = actual.split('\n');
  let i = 0;
  while (a[i] === b[i]) i += 1;
  return { line: i + 1, expected: a[i] ?? '(end of file)', actual: b[i] ?? '(end of file)' };
}

/** The region a committed file was built for, when it can be read. */
function regionOf(text: string): string | undefined {
  try {
    const region = (JSON.parse(text) as { region?: unknown }).region;
    return typeof region === 'string' && REGION.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `calendar:check [-- --year <YYYY>… --region <slug>]`: rebuilds each committed calendar year (or the
 * given years) in memory and compares it with the file. A year is rebuilt for `--region`, else the
 * region the file names, else `site.region`. Exit code 0 when every file is current, 1 when one is
 * stale, missing or fails to build, 2 on usage errors.
 */
export async function runCheck(args: readonly string[], context: CliContext, io: CliIo): Promise<number> {
  const parsed = parseArgs(args);
  if (typeof parsed === 'string') {
    io.err(`${parsed}\n${CHECK_USAGE}`);
    return 2;
  }
  const years = parsed.years.length > 0 ? parsed.years : await committedYears(context.repoRoot);
  if (years.length === 0) {
    io.err('calendar:check: no calendar/<year>.json files to check');
    return 1;
  }
  const { build } = context;
  let stale = 0;
  for (const year of years) {
    const file = `calendar/${String(year)}.json`;
    let committed: string | undefined;
    try {
      committed = await readFile(calendarPath(context.repoRoot, year), 'utf8');
    } catch {
      committed = undefined;
    }
    const region =
      parsed.region ?? (committed === undefined ? undefined : regionOf(committed)) ?? context.config.site.region;
    const rebuild = `npm run calendar:build -- --year ${String(year)} --region ${region}`;
    let result: BuildResult;
    try {
      result = await build({ repoRoot: context.repoRoot, year, region, config: context.config });
    } catch (error) {
      io.err(`${file}: build failed: ${(error as Error).message}`);
      stale += 1;
      continue;
    }
    const fresh = serialiseCalendar(result.calendar);
    if (committed === undefined) {
      io.err(`${file}: missing; run \`${rebuild}\``);
      stale += 1;
      continue;
    }
    const difference = firstDifference(fresh, committed);
    if (difference === undefined) {
      io.out(`${file}: up to date (${summary(result)})`);
      continue;
    }
    stale += 1;
    io.err(`${file}: stale; run \`${rebuild}\` and commit the result`);
    io.err(`  first difference at line ${String(difference.line)}:`);
    io.err(`    expected: ${difference.expected.trim()}`);
    io.err(`    committed: ${difference.actual.trim()}`);
  }
  if (stale === 0) return 0;
  io.err(`calendar:check: ${String(stale)} of ${String(years.length)} calendar file(s) need rebuilding`);
  return 1;
}
