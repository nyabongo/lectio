/**
 * A region's calendar: romcal with the region's transfer flags, then its overrides
 * (`calendar/overrides/<region>.json`) applied by the engine.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { GeneralRoman_En } from '@romcal/calendar.general-roman';
import { Romcal } from 'romcal';
import type { RomcalConfigInput } from 'romcal';

import { MAX_YEAR, MIN_YEAR } from '../generate.ts';
import type { GenerateOptions } from '../generate.ts';
import { toLectioId } from '../ids.ts';
import { mapCalendar, mapCelebration } from '../map.ts';
import type { CelebrationDetail, DetailedDay, RomcalDayInput } from '../map.ts';
import { applyOverrides } from './apply.ts';
import type { ApplyResult, DatedCelebration } from './apply.ts';
import { TRANSFER_FLAGS, parseOverrides } from './schema.ts';
import type { RegionalOverrides } from './schema.ts';

/** `calendar/overrides/<region>.json` under the repository root. */
export function overridesPath(repoRoot: string, region: string): string {
  return join(repoRoot, 'calendar', 'overrides', `${region}.json`);
}

function romcal(options: GenerateOptions = {}): Romcal {
  const config: { -readonly [K in keyof RomcalConfigInput]: RomcalConfigInput[K] } = {
    localizedCalendar: GeneralRoman_En,
    scope: 'gregorian',
    ...options,
  };
  return new Romcal(config);
}

/** romcal's definitions, keyed by Lectio id: the romcal id and the fixed date (`MM-DD`) if it has one. */
async function romcalDefinitions(): Promise<Map<string, { romcalId: string; monthDay?: string }>> {
  const definitions = await romcal().getAllDefinitions();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return new Map(
    Object.entries(definitions).map(([romcalId, definition]) => {
      const { month, date } = definition.dateDef as { month?: number; date?: number };
      const fixed = month !== undefined && date !== undefined && definition.cycles.properCycle === 'PROPER_OF_SAINTS';
      return [toLectioId(romcalId), fixed ? { romcalId, monthDay: `${pad(month)}-${pad(date)}` } : { romcalId }];
    }),
  );
}

/** Lectio ids of every celebration romcal defines, for `parseOverrides`' id checks. */
export async function romcalLectioIds(): Promise<Set<string>> {
  return new Set((await romcalDefinitions()).keys());
}

/** Read and validate an overrides file, ids included; throws `OverridesError` when it is invalid. */
export async function loadOverrides(path: string): Promise<RegionalOverrides> {
  const json = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return parseOverrides(json, { knownIds: await romcalLectioIds() });
}

/** romcal's transfer options from the region's flags; flags left out keep the general rule. */
export function transferOptions(overrides: RegionalOverrides): GenerateOptions {
  const options: { -readonly [K in keyof GenerateOptions]: GenerateOptions[K] } = {};
  for (const flag of TRANSFER_FLAGS) {
    const setting = overrides.transfers[flag];
    if (setting !== undefined) options[flag] = setting.value;
  }
  return options;
}

/**
 * The Proper of Time day of each date (the weekday, or the Sunday), from romcal's raw output:
 * the weekday or Sunday entry itself, or else the `weekday` romcal attaches to a celebration.
 */
export function baseDays(
  calendar: Readonly<Record<string, readonly RomcalDayInput[]>>,
  days: readonly DetailedDay[],
): Map<string, CelebrationDetail> {
  const result = new Map<string, CelebrationDetail>();
  for (const day of days) {
    const entries = calendar[day.date] ?? [];
    const own = entries.find((e) => e.rank === 'WEEKDAY' || e.rank === 'SUNDAY');
    const base = own ?? entries.find((e) => e.weekday)?.weekday;
    if (base) result.set(day.date, mapCelebration(base, day.season));
  }
  return result;
}

/**
 * A romcal celebration on its own date in `year`, even when romcal impeded it there. romcal's
 * `isOptional` is not reliable outside a generated calendar, so it follows the rank.
 */
export function datedCelebration(
  day: RomcalDayInput | null | undefined,
  days: ReadonlyMap<string, DetailedDay>,
): DatedCelebration | undefined {
  const season = day ? days.get(day.date)?.season : undefined;
  if (!day || !season) return undefined;
  // romcal days are class instances with getters: copy the fields `mapCelebration` reads.
  const plain: RomcalDayInput = {
    id: day.id,
    date: day.date,
    name: day.name,
    rank: day.rank,
    precedence: day.precedence,
    colors: day.colors,
    seasons: day.seasons,
    isOptional: day.rank === 'OPTIONAL_MEMORIAL',
    isHolyDayOfObligation: day.isHolyDayOfObligation,
    calendar: day.calendar,
    cycles: day.cycles,
  };
  return { celebration: mapCelebration(plain, season), date: day.date };
}

/**
 * Every day of the civil year `year` in the region: romcal's General Roman Calendar with the
 * region's transfer flags, then its overrides. `events` says what each override did that year.
 */
export async function generateRegionalDays(year: number, overrides: RegionalOverrides): Promise<ApplyResult> {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `year must be an integer from ${String(MIN_YEAR)} to ${String(MAX_YEAR)}, got ${String(year)}`,
    );
  }
  const engine = romcal(transferOptions(overrides));
  const calendar = await engine.generateCalendar(year);
  const days = mapCalendar(calendar);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const bases = baseDays(calendar, days);
  const present = new Map(days.flatMap((day) => day.celebrations.map((c) => [c.id, day] as const)));
  const definitions = await romcalDefinitions();
  const lookUp = async (id: string): Promise<DatedCelebration[]> => {
    const definition = definitions.get(id);
    const day = definition ? await engine.getOneLiturgicalDay(definition.romcalId, { year }) : undefined;
    return [datedCelebration(day, byDate)].filter((found): found is DatedCelebration => found !== undefined);
  };

  // romcal's definitions of the targets it left out of the year.
  const missing = new Map<string, DatedCelebration>();
  // Fixed-date celebrations romcal left out of a target's date (suppressed by what it celebrates).
  const suppressed = new Map<string, CelebrationDetail[]>();
  for (const entry of overrides.entries) {
    if (entry.action === 'add') continue;
    const day = present.get(entry.id);
    if (!day) {
      for (const found of await lookUp(entry.id)) missing.set(entry.id, found);
      continue;
    }
    const monthDay = day.date.slice(5);
    const sameDay = [...definitions].filter(([id, d]) => d.monthDay === monthDay && !present.has(id));
    const under = (await Promise.all(sameDay.map(([id]) => lookUp(id)))).flat();
    suppressed.set(
      day.date,
      under.map((found) => found.celebration),
    );
  }

  return applyOverrides(days, overrides, {
    baseDay: (date) => bases.get(date),
    definition: (id) => missing.get(id),
    // The engine asks only about dates of targets it took off, all of them set above.
    suppressed: (date) => suppressed.get(date) as CelebrationDetail[],
  });
}
