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
import { mapCalendar, mapCelebration } from '../map.ts';
import type { CelebrationDetail, DetailedDay, RomcalDayInput } from '../map.ts';
import { applyOverrides } from './apply.ts';
import type { ApplyResult } from './apply.ts';
import { TRANSFER_FLAGS, parseOverrides } from './schema.ts';
import type { RegionalOverrides } from './schema.ts';

/** `calendar/overrides/<region>.json` under the repository root. */
export function overridesPath(repoRoot: string, region: string): string {
  return join(repoRoot, 'calendar', 'overrides', `${region}.json`);
}

/** Read and validate an overrides file; throws `OverridesError` when it is invalid. */
export async function loadOverrides(path: string): Promise<RegionalOverrides> {
  return parseOverrides(JSON.parse(await readFile(path, 'utf8')) as unknown);
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
 * Every day of the civil year `year` in the region: romcal's General Roman Calendar with the
 * region's transfer flags, then its overrides. `events` says what each override did that year.
 */
export async function generateRegionalDays(year: number, overrides: RegionalOverrides): Promise<ApplyResult> {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `year must be an integer from ${String(MIN_YEAR)} to ${String(MAX_YEAR)}, got ${String(year)}`,
    );
  }
  const config: { -readonly [K in keyof RomcalConfigInput]: RomcalConfigInput[K] } = {
    localizedCalendar: GeneralRoman_En,
    scope: 'gregorian',
    ...transferOptions(overrides),
  };
  const calendar = await new Romcal(config).generateCalendar(year);
  const days = mapCalendar(calendar);
  const bases = baseDays(calendar, days);
  return applyOverrides(days, overrides, (date) => bases.get(date));
}
