/**
 * `lectionary:check`: the semantic rules every data file must follow (011, "L-016 must"):
 *
 * - every `ref` (and alternative) parses (L-005), has no verse letters and is spelled canonically;
 * - every `source` matches the line grammar and its id's locator grammar from sources.json;
 * - every reading has a `status`;
 * - keys fit their kind, cycles fit their key, and nothing is defined twice;
 * - given calendar days: a feast or solemnity on a Sunday has a second reading.
 */
import { tryParseRef } from '@lectio/refs';
import type { IsoDate } from '@lectio/shared';

import { formatCanonical, hasLetters } from './canonical.ts';
import { PROPER_OF_TIME_KEY, SLUG, isSundayKey, weekdayOf } from './keys.ts';
import { Lectionary, epiphanyOf, resolveDay } from './resolve.ts';
import type { LectionaryDay } from './resolve.ts';
import { checkSource } from './sources.ts';
import { SUNDAY_CYCLES, WEEKDAY_CYCLES } from './types.ts';
import type { Cycle, EntryKind, EntryStatus, LoadedFile, Reading, SourceRegistry } from './types.ts';

export interface CheckStats {
  readonly files: number;
  readonly entries: number;
  readonly readings: number;
  readonly byStatus: Readonly<Record<EntryStatus, number>>;
  /** OLM 1981 citations whose page is not recorded yet (`p?`). */
  readonly unknownPages: number;
}

export interface CheckOptions {
  /** Calendar days (`calendar/<year>.json`) to check the Sunday rule against. */
  readonly days?: readonly LectionaryDay[];
}

export interface CheckResult {
  readonly problems: readonly string[];
  readonly stats: CheckStats;
}

/** Problems with one `ref` string; `what` names it in messages. */
export function checkRefString(ref: string, what: string): string[] {
  const parsed = tryParseRef(ref);
  if (!parsed.ok) return [`${what} "${ref}" does not parse: ${parsed.error.message}`];
  if (hasLetters(parsed.value)) return [`${what} "${ref}" has verse letters; keep them in "printed" only`];
  const canonical = formatCanonical(parsed.value);
  return canonical === ref ? [] : [`${what} "${ref}" is not spelled canonically; write "${canonical}"`];
}

/**
 * A Sunday takes only Sunday cycles. A weekday takes its own cycles (I/II) and Sunday cycles: a weekday
 * reading for a Sunday cycle is the substitute the OLM gives for that year (resolve.ts, types.ts).
 */
function cycleProblem(key: string, kind: EntryKind, cycle: Cycle | undefined): string | undefined {
  if (cycle === undefined || kind !== 'proper-of-time') return undefined;
  const allowed: readonly Cycle[] = isSundayKey(key) ? SUNDAY_CYCLES : [...WEEKDAY_CYCLES, ...SUNDAY_CYCLES];
  return allowed.includes(cycle) ? undefined : `cycle ${cycle} does not apply to ${key}; use ${allowed.join('/')}`;
}

function checkReading(reading: Reading, key: string, kind: EntryKind, registry: SourceRegistry): string[] {
  const problems = checkRefString(reading.ref, 'ref');
  reading.alternatives?.forEach((alt, i) => problems.push(...checkRefString(alt.ref, `alternatives[${i}].ref`)));
  problems.push(...checkSource(reading.source, registry));
  const cycle = cycleProblem(key, kind, reading.cycle);
  if (cycle !== undefined) problems.push(cycle);
  return problems;
}

/**
 * The Epiphany of `date`'s year as the days keep it (a calendar file always has it); 6 January when
 * they do not include it. A Sunday's readings do not depend on it, but the resolver requires it.
 */
function epiphanyAmong(days: readonly LectionaryDay[], date: string): IsoDate {
  const year = date.slice(0, 4);
  const kept = days.find((d) => d.date.startsWith(year) && d.celebrations.some((c) => c.id === 'epiphany-of-the-lord'));
  return kept?.date ?? epiphanyOf(Number(year), false);
}

/**
 * A solemnity, or a feast that falls on a Sunday (a feast of the Lord in Ordinary Time), takes the
 * Sunday's place and has a second reading, as a Sunday does. Reports every such day whose resolved Mass lacks one.
 * Days without data for the celebration are left to the calendar build.
 */
export function checkSundaySecondReadings(days: readonly LectionaryDay[], lectionary: Lectionary): string[] {
  const problems: string[] = [];
  for (const day of days) {
    if (weekdayOf(day.date) !== 'sun') continue;
    const principal = day.celebrations.find((c) => c.rank !== 'optional-memorial' && c.rank !== 'commemoration');
    if (principal?.rank !== 'solemnity' && principal?.rank !== 'feast') continue;
    for (const mass of resolveDay(day, lectionary, { epiphany: epiphanyAmong(days, day.date) }).masses) {
      if (!mass.missingSlots.includes('second-reading')) continue;
      problems.push(
        `${day.date} ${principal.id} ${mass.id}: a ${principal.rank} on a Sunday needs a second reading ` +
          `(from ${mass.from.join(', ')})`,
      );
    }
  }
  return problems;
}

/** Runs every rule over shape-valid files. */
export function checkLectionary(
  files: readonly LoadedFile[],
  registry: SourceRegistry,
  options: CheckOptions = {},
): CheckResult {
  const problems: string[] = [];
  const byStatus: Record<EntryStatus, number> = { provisional: 0, verified: 0, disputed: 0 };
  const seen = new Map<string, string>();
  const commons = new Set(
    files.filter((f) => f.data.kind === 'commons').flatMap((f) => f.data.entries.map((e) => e.key)),
  );
  let entries = 0;
  let readings = 0;
  let unknownPages = 0;

  for (const { path, data } of files) {
    const { kind } = data;
    data.entries.forEach((entry, e) => {
      entries += 1;
      const at = `${path} ${entry.key}`;
      const keyOk = kind === 'proper-of-time' ? PROPER_OF_TIME_KEY.test(entry.key) : SLUG.test(entry.key);
      if (!keyOk) problems.push(`${path} entries[${e}]: key "${entry.key}" is not a valid ${kind} key`);
      const id = `${kind}:${entry.key}`;
      const first = seen.get(id);
      if (first !== undefined) problems.push(`${at}: already defined in ${first}`);
      else seen.set(id, path);
      if (entry.common !== undefined) {
        if (kind !== 'celebrations') problems.push(`${at}: only celebrations may name a common`);
        else if (!commons.has(entry.common)) problems.push(`${at}: common "${entry.common}" is not defined`);
      }
      if (entry.masses.length === 0 && entry.common === undefined) problems.push(`${at}: has no masses and no common`);
      const massIds = new Set<string>();
      for (const mass of entry.masses) {
        if (!SLUG.test(mass.id)) problems.push(`${at}: mass id "${mass.id}" must be kebab-case`);
        if (massIds.has(mass.id)) problems.push(`${at}: mass "${mass.id}" is defined twice`);
        massIds.add(mass.id);
        const slots = new Set<string>();
        for (const reading of mass.readings) {
          readings += 1;
          byStatus[reading.status] += 1;
          if (/^olm-1981 p\?#/.test(reading.source)) unknownPages += 1;
          const where = `${at} ${mass.id} ${reading.slot}${reading.cycle === undefined ? '' : ` (${reading.cycle})`}`;
          const slot = `${reading.slot}/${reading.cycle ?? '*'}`;
          if (slots.has(slot)) problems.push(`${where}: defined twice`);
          slots.add(slot);
          for (const problem of checkReading(reading, entry.key, kind, registry)) problems.push(`${where}: ${problem}`);
        }
      }
    });
  }
  if (options.days !== undefined) problems.push(...checkSundaySecondReadings(options.days, new Lectionary(files)));
  return { problems, stats: { files: files.length, entries, readings, byStatus, unknownPages } };
}
