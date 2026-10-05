/**
 * The overrides engine: applies a region's entries (schema.ts) to the detailed days romcal
 * produced (`generateDetailedDays`), following the precedence rules of the Universal Norms on
 * the Liturgical Year and the Calendar (UNLY 59–60) and GIRM 355:
 *
 * - A **solemnity** impeded by a day of equal or higher precedence moves to the nearest
 *   following day that is not in levels 1–8 of the Table of Liturgical Days.
 * - A **feast** impeded by a day of equal or higher precedence (a Sunday, a solemnity) is
 *   omitted that year.
 * - A **memorial** or optional memorial is omitted on a day of levels 1–8, becomes a
 *   commemoration (optional, the weekday's colour) on a privileged weekday (level 9: Lent,
 *   17–24 December, the Christmas octave), and an optional memorial yields to an obligatory one.
 * - Two **obligatory memorials** on one day both become optional memorials and the weekday is
 *   the celebration of the day (ADR 0007); removing one of them restores the other.
 * - A celebration that takes the day drops the memorials and options already there.
 *
 * Entries that take a celebration away (remove, move, rank) run first, in file order; then the
 * celebrations to place (added, moved, re-ranked) are placed from the highest precedence down,
 * so a lower-ranked one always meets the final state of the day. Optional memorials that keep
 * a memorial's precedence (the coinciding-memorials rule) are given level 12 at the end.
 */
import type { CelebrationDetail, DetailedDay } from '../map.ts';
import { precedenceLevel } from '../map.ts';
import type { MoveEntry, OverrideEntry, OverrideRank, RankEntry, RegionalOverrides } from './schema.ts';

/** romcal precedence given to a celebration a region adds or re-ranks (UNLY 59: proper celebrations). */
export const PROPER_PRECEDENCE: Readonly<Record<OverrideRank, string>> = Object.freeze({
  solemnity: 'PROPER_SOLEMNITY__PRINCIPAL_PATRON_4A',
  feast: 'PROPER_FEAST_8F',
  memorial: 'PROPER_MEMORIAL_11B',
  'optional-memorial': 'OPTIONAL_MEMORIAL_12',
});

const OPTIONAL_PRECEDENCE = 'OPTIONAL_MEMORIAL_12';

/** Lowest level a feast or solemnity may be transferred onto (UNLY 60: not a day in levels 1–8). */
const LAST_PROTECTED_LEVEL = 8;
const PRIVILEGED_WEEKDAY_LEVEL = 9;
const NO_CELEBRATION_LEVEL = 14;

/**
 * The Proper of Time day (weekday or Sunday) of a date, used when a celebration that sat on it
 * is removed or moved away, and as `weekdayId` of a celebration that takes the day.
 */
export type BaseDayLookup = (date: string) => CelebrationDetail | undefined;

export type OverrideOutcome =
  | 'added'
  | 'transferred'
  | 'impeded'
  | 'commemorated'
  | 'demoted'
  | 'removed'
  | 'displaced'
  | 'restored'
  | 'not-found'
  | 'skipped';

/** What happened to a celebration, for reports (L-070) and tests. */
export interface OverrideEvent {
  readonly id: string;
  readonly outcome: OverrideOutcome;
  readonly date?: string;
}

export interface ApplyResult {
  readonly days: DetailedDay[];
  readonly events: OverrideEvent[];
}

const level = (celebration: CelebrationDetail): number => precedenceLevel(celebration.precedence);

/** An optional memorial that is an obligatory memorial demoted by the coinciding-memorials rule. */
const isDemoted = (c: CelebrationDetail): boolean => c.rank === 'optional-memorial' && level(c) <= 11;
const isObligatoryMemorial = (c: CelebrationDetail): boolean => (c.rank === 'memorial' && !c.optional) || isDemoted(c);
const isProperOfTimeDay = (c: CelebrationDetail): boolean => c.rank === 'weekday' || c.rank === 'sunday';

/** The rank a celebration has before romcal or the coinciding rule reduced it. */
function intrinsicRank(c: CelebrationDetail): OverrideRank {
  if (c.rank === 'commemoration' || isDemoted(c)) return level(c) <= 11 ? 'memorial' : 'optional-memorial';
  return c.rank as OverrideRank;
}

function withoutWeekday(c: CelebrationDetail): CelebrationDetail {
  const { weekdayId: _weekdayId, ...rest } = c;
  return rest;
}

function withRank(
  c: CelebrationDetail,
  rank: OverrideRank,
  precedence: string,
  colours = c.colours,
): CelebrationDetail {
  return {
    ...withoutWeekday(c),
    rank,
    precedence,
    optional: rank === 'optional-memorial',
    colours,
    colour: colours[0] as CelebrationDetail['colour'],
  };
}

/** Non-optional celebrations by precedence (stable), then the options in their order. */
function sortDay(celebrations: readonly CelebrationDetail[]): CelebrationDetail[] {
  const main = celebrations.filter((c) => !c.optional).sort((a, b) => level(a) - level(b));
  return [...main, ...celebrations.filter((c) => c.optional)];
}

/** The celebration a region adds, before it is placed. */
export function addedCelebration(entry: Extract<OverrideEntry, { action: 'add' }>): CelebrationDetail {
  return {
    id: entry.id,
    name: entry.name,
    rank: entry.rank,
    colour: entry.colours[0] as CelebrationDetail['colour'],
    // Not a romcal celebration: there is no romcal id.
    romcalId: '',
    colours: entry.colours,
    precedence: PROPER_PRECEDENCE[entry.rank],
    optional: entry.rank === 'optional-memorial',
    holyDayOfObligation: entry.holyDayOfObligation ?? false,
    properCycle: 'proper-of-saints',
  };
}

interface Pending {
  readonly celebration: CelebrationDetail;
  readonly date: string;
}

/**
 * Apply `overrides.entries` to one civil year of detailed days (sorted by date, as
 * `generateDetailedDays` returns them). Transfer flags are romcal options and are applied by
 * `generateRegionalDays`, not here. Returns new days; the input is not modified.
 */
export function applyOverrides(
  days: readonly DetailedDay[],
  overrides: RegionalOverrides,
  baseDay: BaseDayLookup,
): ApplyResult {
  const events: OverrideEvent[] = [];
  const dates = days.map((day) => day.date);
  const position = new Map(dates.map((date, index) => [date, index]));
  const state = new Map(days.map((day) => [day.date, [...day.celebrations]]));
  const year = dates[0]?.slice(0, 4) ?? '';

  const get = (date: string): CelebrationDetail[] => state.get(date) as CelebrationDetail[];
  const set = (date: string, celebrations: readonly CelebrationDetail[]): void => {
    state.set(date, sortDay(celebrations));
  };
  const requireBase = (date: string, id: string): CelebrationDetail => {
    const base = baseDay(date);
    if (!base) throw new Error(`No Proper of Time day under ${id} on ${date}`);
    return base;
  };
  const topLevel = (date: string): number => {
    const top = get(date).find((c) => !c.optional);
    return top ? level(top) : NO_CELEBRATION_LEVEL;
  };

  /** Take celebration `id` off its day, repairing the day. */
  function extract(id: string): Pending | undefined {
    for (const date of dates) {
      const list = get(date);
      const index = list.findIndex((c) => c.id === id);
      if (index < 0) continue;
      const celebration = list[index] as CelebrationDetail;
      if (isProperOfTimeDay(celebration)) {
        throw new Error(`${id} on ${date} is a day of the Proper of Time; overrides change celebrations only`);
      }
      const wasPrimary = list.findIndex((c) => !c.optional) === index;
      let rest = list.filter((_, i) => i !== index);
      if (wasPrimary && !rest.some((c) => !c.optional)) rest.unshift(requireBase(date, id));
      const demoted = rest.filter(isDemoted);
      const primary = rest.find((c) => !c.optional);
      if (demoted.length === 1 && primary?.rank === 'weekday') {
        const lone = demoted[0] as CelebrationDetail;
        rest = [
          { ...lone, rank: 'memorial', optional: false, weekdayId: primary.id },
          ...rest.filter((c) => c !== lone && c !== primary),
        ];
        events.push({ id: lone.id, outcome: 'restored', date });
      }
      set(date, rest);
      return { celebration: withoutWeekday(celebration), date };
    }
    return undefined;
  }

  /** The nearest following date that is not in levels 1–8 (UNLY 60). */
  function nextFreeDate(date: string): string | undefined {
    return dates.slice((position.get(date) as number) + 1).find((d) => topLevel(d) > LAST_PROTECTED_LEVEL);
  }

  /** Lectio id of the Proper of Time day under whatever is celebrated on `date`. */
  function underlyingId(date: string, top: CelebrationDetail | undefined): string | undefined {
    return top?.rank === 'weekday' ? top.id : (top?.weekdayId ?? baseDay(date)?.id);
  }

  /** `celebration` becomes the celebration of the day; whatever was there is dropped. */
  function takeDay(date: string, celebration: CelebrationDetail): void {
    const list = get(date);
    const top = list.find((c) => !c.optional);
    const weekdayId = underlyingId(date, top);
    for (const c of list) if (!isProperOfTimeDay(c)) events.push({ id: c.id, outcome: 'displaced', date });
    set(date, [{ ...celebration, ...(weekdayId === undefined ? {} : { weekdayId }) }]);
    events.push({ id: celebration.id, outcome: 'added', date });
  }

  function place(date: string, celebration: CelebrationDetail): void {
    const list = get(date);
    const top = list.find((c) => !c.optional);
    const dayLevel = topLevel(date);
    const own = level(celebration);
    const { id } = celebration;

    if (celebration.rank === 'solemnity' || celebration.rank === 'feast') {
      if (dayLevel > own) return takeDay(date, celebration);
      const next = celebration.rank === 'solemnity' ? nextFreeDate(date) : undefined;
      if (next === undefined) {
        events.push({ id, outcome: 'impeded', date });
        return;
      }
      events.push({ id, outcome: 'transferred', date: next });
      return place(next, celebration);
    }

    if (dayLevel <= LAST_PROTECTED_LEVEL) {
      events.push({ id, outcome: 'impeded', date });
      return;
    }
    if (dayLevel === PRIVILEGED_WEEKDAY_LEVEL) {
      const weekday = top as CelebrationDetail;
      set(date, [
        ...list,
        {
          ...celebration,
          rank: 'commemoration',
          optional: true,
          colours: weekday.colours,
          colour: weekday.colour,
          weekdayId: weekday.id,
        },
      ]);
      events.push({ id, outcome: 'commemorated', date });
      return;
    }
    if (celebration.rank === 'optional-memorial') {
      if (top?.rank === 'memorial') {
        events.push({ id, outcome: 'impeded', date });
        return;
      }
      const weekdayId = underlyingId(date, top);
      set(date, [...list, { ...celebration, ...(weekdayId === undefined ? {} : { weekdayId }) }]);
      events.push({ id, outcome: 'added', date });
      return;
    }

    const obligatory = list.filter(isObligatoryMemorial);
    if (obligatory.length === 0) return takeDay(date, celebration);
    const base = top?.rank === 'weekday' ? top : requireBase(date, id);
    const demote = (c: CelebrationDetail): CelebrationDetail => ({
      ...c,
      rank: 'optional-memorial',
      optional: true,
      weekdayId: base.id,
    });
    set(date, [
      base,
      ...obligatory.map(demote),
      demote(celebration),
      ...list.filter((c) => c !== base && !obligatory.includes(c)),
    ]);
    for (const c of [...obligatory, celebration]) events.push({ id: c.id, outcome: 'demoted', date });
  }

  function toPlace(entry: MoveEntry | RankEntry, found: Pending): Pending {
    const { celebration } = found;
    if (entry.action === 'rank') {
      return {
        date: found.date,
        celebration: withRank(celebration, entry.rank, PROPER_PRECEDENCE[entry.rank], entry.colours),
      };
    }
    const rank = intrinsicRank(celebration);
    return {
      date: `${year}-${entry.date}`,
      celebration: withRank(celebration, rank, celebration.precedence, entry.colours),
    };
  }

  const pending: Pending[] = [];
  for (const entry of overrides.entries) {
    if (entry.action === 'add') continue;
    const found = extract(entry.id);
    if (!found) {
      events.push({ id: entry.id, outcome: 'not-found' });
      continue;
    }
    if (entry.action === 'remove') events.push({ id: entry.id, outcome: 'removed', date: found.date });
    else pending.push(toPlace(entry, found));
  }
  for (const entry of overrides.entries) {
    if (entry.action === 'add') pending.push({ date: `${year}-${entry.date}`, celebration: addedCelebration(entry) });
  }

  pending.sort((a, b) => level(a.celebration) - level(b.celebration));
  for (const { date, celebration } of pending) {
    if (!position.has(date)) events.push({ id: celebration.id, outcome: 'skipped', date });
    else place(date, celebration);
  }

  return {
    days: days.map((day) => ({
      ...day,
      celebrations: get(day.date).map((c) => (isDemoted(c) ? { ...c, precedence: OPTIONAL_PRECEDENCE } : c)),
    })),
    events,
  };
}
