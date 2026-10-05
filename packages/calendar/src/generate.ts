/**
 * The General Roman Calendar for a civil year, computed by romcal (ADR 0007).
 */
import { GeneralRoman_En } from '@romcal/calendar.general-roman';
import type { CalendarDay } from '@lectio/schema/calendar';
import { Romcal } from 'romcal';
import type { RomcalConfigInput } from 'romcal';

import { mapCalendar, toCalendarDay } from './map.ts';
import type { DetailedDay } from './map.ts';

/**
 * romcal's transfer options. Each one left out keeps the General Roman Calendar's rule
 * (Epiphany on 6 January, Ascension on Thursday, Corpus Christi on Thursday); regional
 * calendars (L-015) set them.
 */
export interface GenerateOptions {
  /** Epiphany on the Sunday between 2 and 8 January. */
  readonly epiphanyOnSunday?: boolean;
  /** Ascension on the Seventh Sunday of Easter. */
  readonly ascensionOnSunday?: boolean;
  /** Corpus Christi on the Sunday after Trinity Sunday. */
  readonly corpusChristiOnSunday?: boolean;
}

/** Years the calendar schema accepts. */
export const MIN_YEAR = 1970;
export const MAX_YEAR = 9999;

function romcalConfig(options: GenerateOptions): RomcalConfigInput {
  // Only pass options that are set: an explicit `undefined` would still override the
  // calendar's own rule in romcal.
  const config: { -readonly [K in keyof RomcalConfigInput]: RomcalConfigInput[K] } = {
    localizedCalendar: GeneralRoman_En,
    scope: 'gregorian',
  };
  if (options.epiphanyOnSunday !== undefined) config.epiphanyOnSunday = options.epiphanyOnSunday;
  if (options.ascensionOnSunday !== undefined) config.ascensionOnSunday = options.ascensionOnSunday;
  if (options.corpusChristiOnSunday !== undefined) config.corpusChristiOnSunday = options.corpusChristiOnSunday;
  return config;
}

/**
 * Every day of the civil year `year` (1 January to 31 December) with its celebrations,
 * romcal ids, precedence and all permitted colours. Regional overrides (L-015) work on this.
 */
export async function generateDetailedDays(year: number, options: GenerateOptions = {}): Promise<DetailedDay[]> {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `year must be an integer from ${String(MIN_YEAR)} to ${String(MAX_YEAR)}, got ${String(year)}`,
    );
  }
  const calendar = await new Romcal(romcalConfig(options)).generateCalendar(year);
  return mapCalendar(calendar);
}

/**
 * Every day of the civil year `year` in the calendar schema's shape, without readings
 * (`masses: []`, `lectionaryMissing: true`; L-016 fills them).
 */
export async function generateDays(year: number, options: GenerateOptions = {}): Promise<CalendarDay[]> {
  return (await generateDetailedDays(year, options)).map(toCalendarDay);
}

/** The romcal version computing the calendar, for `generatedBy` (L-017). */
export function romcalVersion(): string {
  return Romcal.getVersion();
}
