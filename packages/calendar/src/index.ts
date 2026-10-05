/**
 * @lectio/calendar: the liturgical calendar. romcal computes the General Roman Calendar
 * (ADR 0007); regional overrides (L-015) and readings (L-016) are layered on top, and the
 * CLIs (L-017) write `calendar/<year>.json`. Celebration, season and colour names in English and
 * Kiswahili come from `./i18n` (L-111).
 */
export const packageName = '@lectio/calendar';

export { MAX_YEAR, MIN_YEAR, generateDays, generateDetailedDays, romcalVersion } from './generate.ts';
export type { GenerateOptions } from './generate.ts';
export * from './i18n/index.ts';
export { ROMCAL_ID_ALIASES, toLectioId } from './ids.ts';
export * from './overrides/index.ts';
export { NAME_CORRECTIONS, mapCalendar, mapDay, precedenceLevel, toCalendarDay } from './map.ts';
export type {
  CelebrationDetail,
  CelebrationRank,
  DetailedDay,
  ProperCycle,
  RomcalDayInput,
  Season,
  SundayCycle,
  WeekdayCycle,
} from './map.ts';
