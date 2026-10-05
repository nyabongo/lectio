/**
 * Pure mapping from romcal's output to Lectio's calendar types. Kept free of romcal imports
 * so every branch can be tested with small hand-made inputs; `generate.ts` feeds it real data.
 */
import type { CalendarDay, Celebration } from '@lectio/schema/calendar';
import type { LiturgicalColour } from '@lectio/schema/common';

import { toLectioId } from './ids.ts';

export type Season = CalendarDay['season'];
export type CelebrationRank = Celebration['rank'];
export type SundayCycle = CalendarDay['sundayCycle'];
export type WeekdayCycle = CalendarDay['weekdayCycle'];
export type ProperCycle = 'proper-of-time' | 'proper-of-saints';

/** The subset of a romcal `LiturgicalDay` that Lectio reads. romcal's class is assignable to it. */
export interface RomcalDayInput {
  readonly id: string;
  readonly date: string;
  readonly name: string;
  readonly rank: string;
  readonly precedence: string;
  readonly colors: readonly string[];
  readonly seasons: readonly string[];
  readonly isOptional: boolean;
  readonly isHolyDayOfObligation: boolean;
  readonly calendar: { readonly weekOfSeason: number };
  readonly cycles: { readonly properCycle: string; readonly sundayCycle: string; readonly weekdayCycle: string };
  /** For a celebration that replaces or sits on a weekday: that weekday. */
  readonly weekday?: { readonly id: string; readonly colors: readonly string[] } | undefined;
}

/** A celebration with everything the overrides (L-015) and the lectionary resolver (L-016) need. */
export interface CelebrationDetail extends Celebration {
  /** romcal's liturgical-day id (`matthew_apostle`). */
  readonly romcalId: string;
  /** Every permitted colour, the preferred first (`colour` is `colours[0]`). */
  readonly colours: readonly LiturgicalColour[];
  /**
   * romcal precedence from the Table of Liturgical Days (UNLY 59), e.g. `GENERAL_FEAST_7`;
   * compare with `precedenceLevel`.
   */
  readonly precedence: string;
  /** An option the celebrant may choose instead of the first celebration (optional memorials). */
  readonly optional: boolean;
  readonly holyDayOfObligation: boolean;
  readonly properCycle: ProperCycle;
  /** Lectio id of the weekday under a feast, memorial or commemoration; its readings may apply. */
  readonly weekdayId?: string;
}

/** A calendar day with detailed celebrations; `toCalendarDay` turns it into the schema shape. */
export interface DetailedDay extends Omit<CalendarDay, 'celebrations'> {
  readonly celebrations: readonly CelebrationDetail[];
}

const COLOURS: Readonly<Record<string, LiturgicalColour>> = {
  WHITE: 'white',
  RED: 'red',
  GREEN: 'green',
  PURPLE: 'violet',
  ROSE: 'rose',
  BLACK: 'black',
  GOLD: 'gold',
};

const SEASONS: Readonly<Record<string, Season>> = {
  ADVENT: 'advent',
  CHRISTMAS_TIME: 'christmas',
  ORDINARY_TIME: 'ordinary-time',
  LENT: 'lent',
  PASCHAL_TRIDUUM: 'paschal-triduum',
  EASTER_TIME: 'easter',
};

/** Colour of a day without a colour of its own (Holy Saturday): the season's. */
const SEASON_COLOURS: Readonly<Record<Season, LiturgicalColour>> = {
  advent: 'violet',
  christmas: 'white',
  'ordinary-time': 'green',
  lent: 'violet',
  // Holy Saturday has no Mass of the day; the evening Mass is the Easter Vigil.
  'paschal-triduum': 'white',
  easter: 'white',
};

const RANKS: Readonly<Record<string, CelebrationRank>> = {
  SOLEMNITY: 'solemnity',
  SUNDAY: 'sunday',
  FEAST: 'feast',
  MEMORIAL: 'memorial',
  OPTIONAL_MEMORIAL: 'optional-memorial',
  WEEKDAY: 'weekday',
};

const SUNDAY_CYCLES: Readonly<Record<string, SundayCycle>> = { YEAR_A: 'A', YEAR_B: 'B', YEAR_C: 'C' };
const WEEKDAY_CYCLES: Readonly<Record<string, WeekdayCycle>> = { YEAR_1: 'I', YEAR_2: 'II' };
const PROPER_CYCLES: Readonly<Record<string, ProperCycle>> = {
  PROPER_OF_TIME: 'proper-of-time',
  PROPER_OF_SAINTS: 'proper-of-saints',
};

function lookup<T>(table: Readonly<Record<string, T>>, value: string, what: string): T {
  if (!Object.hasOwn(table, value)) throw new Error(`Unknown romcal ${what}: ${JSON.stringify(value)}`);
  return table[value] as T;
}

export const mapColour = (value: string): LiturgicalColour => lookup(COLOURS, value, 'colour');
export const mapSeason = (value: string): Season => lookup(SEASONS, value, 'season');
export const mapRank = (value: string): CelebrationRank => lookup(RANKS, value, 'rank');
export const mapSundayCycle = (value: string): SundayCycle => lookup(SUNDAY_CYCLES, value, 'Sunday cycle');
export const mapWeekdayCycle = (value: string): WeekdayCycle => lookup(WEEKDAY_CYCLES, value, 'weekday cycle');
export const mapProperCycle = (value: string): ProperCycle => lookup(PROPER_CYCLES, value, 'proper cycle');

/**
 * Level in the Table of Liturgical Days (1 = Paschal Triduum … 13 = weekdays), read from the
 * romcal precedence suffix (`PROPER_FEAST_8F` → 8). Lower wins.
 */
export function precedenceLevel(precedence: string): number {
  const match = /_(\d{1,2})[A-F]?$/.exec(precedence);
  if (!match) throw new Error(`Unknown romcal precedence: ${JSON.stringify(precedence)}`);
  return Number(match[1]);
}

/** A day spanning two seasons (Easter Sunday: Triduum, then Easter Time) is filed under the later one. */
function daySeason(day: RomcalDayInput): Season {
  const last = day.seasons.at(-1);
  if (last === undefined) throw new Error(`romcal day ${day.id} on ${day.date} has no season`);
  return mapSeason(last);
}

function capitalise(name: string): string {
  const trimmed = name.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * One romcal celebration. romcal leaves memorials impeded by a privileged season (Lent, the
 * last days of Advent, the Christmas octave) without a colour: those are commemorations
 * (GIRM 355) and take the weekday's colour.
 */
export function mapCelebration(day: RomcalDayInput, season: Season): CelebrationDetail {
  let colours = day.colors.map(mapColour);
  let rank = mapRank(day.rank);
  if (colours.length === 0) {
    if (day.weekday) {
      rank = 'commemoration';
      colours = day.weekday.colors.map(mapColour);
    }
    if (colours.length === 0) colours = [SEASON_COLOURS[season]];
  }
  return {
    id: toLectioId(day.id),
    name: capitalise(day.name),
    rank,
    colour: colours[0] as LiturgicalColour,
    romcalId: day.id,
    colours,
    precedence: day.precedence,
    optional: day.isOptional,
    holyDayOfObligation: day.isHolyDayOfObligation,
    properCycle: mapProperCycle(day.cycles.properCycle),
    ...(day.weekday ? { weekdayId: toLectioId(day.weekday.id) } : {}),
  };
}

/**
 * One date from romcal's list for it. The first non-optional entry is the celebration of the
 * day and decides season, week and cycles; optional memorials follow it as options.
 */
export function mapDay(date: string, romcalDays: readonly RomcalDayInput[]): DetailedDay {
  const ordered = [...romcalDays.filter((d) => !d.isOptional), ...romcalDays.filter((d) => d.isOptional)];
  const primary = ordered[0];
  if (primary === undefined) throw new Error(`romcal returned no celebration for ${date}`);
  const season = daySeason(primary);
  return {
    date,
    season,
    // The Triduum is three days, not a week; the schema keeps 0 for days outside a numbered week.
    seasonWeek: season === 'paschal-triduum' ? 0 : primary.calendar.weekOfSeason,
    sundayCycle: mapSundayCycle(primary.cycles.sundayCycle),
    weekdayCycle: mapWeekdayCycle(primary.cycles.weekdayCycle),
    celebrations: ordered.map((d) => mapCelebration(d, season)),
    masses: [],
    lectionaryMissing: true,
  };
}

/** Every date of a romcal calendar (keyed `YYYY-MM-DD`), sorted by date. */
export function mapCalendar(calendar: Readonly<Record<string, readonly RomcalDayInput[]>>): DetailedDay[] {
  return Object.keys(calendar)
    .sort()
    .map((date) => mapDay(date, calendar[date] as readonly RomcalDayInput[]));
}

/** Strip the detail fields so the day matches the calendar schema exactly. */
export function toCalendarDay(day: DetailedDay): CalendarDay {
  return {
    date: day.date,
    season: day.season,
    seasonWeek: day.seasonWeek,
    sundayCycle: day.sundayCycle,
    weekdayCycle: day.weekdayCycle,
    celebrations: day.celebrations.map(({ id, name, rank, colour }) => ({ id, name, rank, colour })),
    masses: day.masses.map((mass) => ({ ...mass, readings: mass.readings.map((reading) => ({ ...reading })) })),
    lectionaryMissing: day.lectionaryMissing,
  };
}
