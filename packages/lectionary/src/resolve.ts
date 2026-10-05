/**
 * The resolver: a calendar day → its Masses with readings.
 *
 * Precedence (General Norms for the Liturgical Year and the Lectionary's introduction, nos. 70–83):
 *
 * - The principal celebration is the first one in the day's list (ranked by the calendar, L-014)
 *   that is not an optional memorial or commemoration.
 * - Solemnities and feasts (and any principal celebration with its own entry) use their proper
 *   readings; a feast without its own readings uses its common. Solemnities, and feasts that fall
 *   on a Sunday, have a second reading, except the weekdays of the Easter octave (ranked as
 *   solemnities, read as weekdays).
 * - Sundays and weekdays use the proper of time for the day's season, week and cycle.
 * - Obligatory memorials keep the weekday readings, except the slots the memorial has proper
 *   readings for.
 * - Optional memorials keep the weekday readings. One with proper readings adds a second Mass
 *   (id = the celebration id) that may be chosen instead.
 *
 * "The weekday readings" are those of the weekday under the day's celebrations: a weekday that has
 * its own entry by celebration id (the dated weekdays of 17–24 December, the Christmas octave and
 * 2 January to the Baptism, the Easter octave), else the proper of time. The weekday is found from
 * the day's `weekday` celebration, a celebration's `weekdayId` (calendar build), or the date.
 *
 * Christmas season (OLM, nos. 205–217): where the Epiphany is kept on 6 January, 7–12 January read
 * the readings printed for Monday…Saturday after the Epiphany in date order (7 January = Monday's),
 * whatever the weekday the calendar names. Where it is kept on the Sunday between 2 and 8 January,
 * the days before it read the dated readings (`christmas-time-january-<n>`) and the days after it
 * the weekday ones, as named. The Epiphany's date is a required option ({@link ResolveOptions},
 * {@link epiphanyOf}), so a caller cannot get the wrong rule by leaving it out.
 *
 * Cycles (types.ts, `Reading.cycle`): a reading without a cycle serves every year; one with the day's
 * weekday cycle (I/II) replaces it; one with the day's Sunday cycle (A/B/C) replaces both. On a
 * weekday, a Sunday-cycle reading is the OLM's substitute for the year whose Sunday has just read
 * the weekday's own passage (e.g. Monday of Advent week 1 reads Is 4:2-6 in Year A).
 *
 * Days without a Mass: Holy Saturday has no Mass of the day ({@link Resolution.noMass}); the Easter
 * Vigil, celebrated after nightfall, belongs to Easter Sunday. Palm Sunday's procession Mass needs
 * only its gospel.
 */
import type { CalendarDay, Celebration } from '@lectio/schema/calendar';
import type { ReadingSlot } from '@lectio/schema/common';
import type { IsoDate } from '@lectio/shared';

import { refKey } from './canonical.ts';
import { isSundayKey, properOfTimeKey, weekdayOf } from './keys.ts';
import { sortBySlot } from './slots.ts';
import { SUNDAY_CYCLES } from './types.ts';
import type { Cycle, Entry, EntryKind, EntryStatus, LoadedFile, MassEntry, Reading } from './types.ts';

/** A celebration rank of the calendar schema (`CELEBRATION_RANKS`). */
export type CelebrationRank = Celebration['rank'];

/** One celebration of a day, as far as the resolver reads it. */
export type LectionaryCelebration = Readonly<Pick<Celebration, 'id' | 'rank'>> & {
  readonly name?: string;
  /** The weekday under a feast, memorial or commemoration (the calendar build's `weekdayId`). */
  readonly weekdayId?: string;
};

/** The parts of a calendar day (`@lectio/schema/calendar` `CalendarDay`) the resolver reads. */
export type LectionaryDay = Readonly<Pick<CalendarDay, 'season' | 'seasonWeek' | 'sundayCycle' | 'weekdayCycle'>> & {
  readonly date: IsoDate;
  readonly celebrations: readonly LectionaryCelebration[];
};

export interface ResolveOptions {
  /**
   * The date of the Epiphany in the day's year ({@link epiphanyOf} from the region's
   * `epiphanyOnSunday` setting). With 6 January, 7–12 January take the readings of Monday…Saturday
   * after the Epiphany in date order; with a Sunday, the days before it read the dated readings and
   * the days after it the calendar's weekday names. Required: there is no safe default.
   */
  readonly epiphany: IsoDate;
}

/**
 * The date of the Epiphany in `year`: 6 January, or, where it is kept on a Sunday
 * (`epiphanyOnSunday`, the region's transfer setting), the Sunday between 2 and 8 January.
 */
export function epiphanyOf(year: number, onSunday: boolean): IsoDate {
  if (!onSunday) return `${String(year)}-01-06` as IsoDate;
  const weekday = new Date(Date.UTC(year, 0, 2)).getUTCDay();
  const day = 2 + ((7 - weekday) % 7);
  return `${String(year)}-01-0${String(day)}` as IsoDate;
}

export interface ResolvedAlternative {
  readonly ref: string;
  readonly key: string;
  readonly printed?: string;
}

export interface ResolvedReading {
  readonly slot: ReadingSlot;
  readonly ref: string;
  /** Canonical passage key (ADR 0004). */
  readonly key: string;
  readonly printed?: string;
  readonly alternatives?: readonly ResolvedAlternative[];
  readonly source: string;
  readonly status: EntryStatus;
}

export interface ResolvedMass {
  readonly id: string;
  readonly label: string;
  readonly readings: readonly ResolvedReading[];
  /** The entries the readings came from, as `<kind>:<key>`, in order of use. */
  readonly from: readonly string[];
  /** Slots a complete Mass of this kind needs but the data does not have (L-070 reports them). */
  readonly missingSlots: readonly ReadingSlot[];
}

export interface Resolution {
  readonly date: IsoDate;
  /** The proper-of-time key of the date, whether or not it was used. */
  readonly properOfTimeKey: string;
  /** Empty when the lectionary has no data for the day, or when the day has no Mass. */
  readonly masses: readonly ResolvedMass[];
  /** The day has no Mass at all (Holy Saturday), so its empty `masses` is not missing data. */
  readonly noMass: boolean;
}

const MASS_LABELS: Readonly<Record<string, string>> = {
  day: 'Mass of the day',
  vigil: 'Vigil Mass',
  night: 'Mass during the Night',
  dawn: 'Mass at Dawn',
  'easter-vigil': 'Easter Vigil in the Holy Night',
};

/** Masses that need fewer slots than a Mass of their day: Palm Sunday's procession reads only a gospel. */
const MASS_SLOTS: Readonly<Record<string, readonly ReadingSlot[]>> = { procession: ['gospel'] };

/**
 * Days without any Mass. Holy Saturday has no Mass of the day; the Easter Vigil held that night
 * belongs to Easter Sunday and is listed there only.
 */
export const NO_MASS_DAYS: ReadonlySet<string> = new Set(['holy-saturday']);

const OPTIONAL: readonly CelebrationRank[] = ['optional-memorial', 'commemoration'];

const AFTER_EPIPHANY = /^(?:monday|tuesday|wednesday|thursday|friday|saturday)-after-epiphany$/;
const AFTER_EPIPHANY_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Entries of every loaded file, indexed by kind and key. Later files never override earlier ones. */
export class Lectionary {
  private readonly entries = new Map<string, Entry>();

  constructor(files: readonly LoadedFile[]) {
    for (const { data } of files) {
      for (const entry of data.entries) {
        const id = `${data.kind}:${entry.key}`;
        if (!this.entries.has(id)) this.entries.set(id, entry);
      }
    }
  }

  get(kind: EntryKind, key: string): Entry | undefined {
    return this.entries.get(`${kind}:${key}`);
  }
}

function resolveReading(reading: Reading): ResolvedReading {
  const { slot, ref, printed, alternatives, source, status } = reading;
  return {
    slot,
    ref,
    key: refKey(ref),
    ...(printed === undefined ? {} : { printed }),
    ...(alternatives === undefined || alternatives.length === 0
      ? {}
      : {
          alternatives: alternatives.map((alt) => ({
            ref: alt.ref,
            key: refKey(alt.ref),
            ...(alt.printed === undefined ? {} : { printed: alt.printed }),
          })),
        }),
    source,
    status,
  };
}

/** 0 for a reading of every year, 1 for a weekday cycle (I/II), 2 for a Sunday cycle (A/B/C). */
function specificity(reading: Reading): number {
  if (reading.cycle === undefined) return 0;
  return (SUNDAY_CYCLES as readonly string[]).includes(reading.cycle) ? 2 : 1;
}

/** The readings of a Mass for the day's cycles, one per slot; the most specific reading of a slot wins. */
function readingsFor(mass: MassEntry, cycles: readonly Cycle[]): Map<ReadingSlot, ResolvedReading> {
  const bySlot = new Map<ReadingSlot, ResolvedReading>();
  const ordered = [...mass.readings].sort((a, b) => specificity(a) - specificity(b));
  for (const reading of ordered) {
    if (reading.cycle === undefined || cycles.includes(reading.cycle))
      bySlot.set(reading.slot, resolveReading(reading));
  }
  return bySlot;
}

function required(id: string, full: boolean, slots: Iterable<ReadingSlot>): readonly ReadingSlot[] {
  const own = MASS_SLOTS[id];
  if (own !== undefined) return own;
  if ([...slots].some((slot) => /^(reading|psalm)-\d$/.test(slot))) return [];
  return full ? ['first-reading', 'psalm', 'second-reading', 'gospel'] : ['first-reading', 'psalm', 'gospel'];
}

function build(
  id: string,
  label: string,
  bySlot: Map<ReadingSlot, ResolvedReading>,
  from: string[],
  full: boolean,
): ResolvedMass {
  const readings = sortBySlot([...bySlot.values()]);
  const missingSlots = required(id, full, bySlot.keys()).filter((slot) => !bySlot.has(slot));
  return { id, label, readings, from, missingSlots };
}

function dateParts(date: IsoDate): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

/**
 * The entry id of a celebration on `date`: with the Epiphany on 6 January, `<weekday>-after-epiphany`
 * on 7–12 January becomes the one for its date (7 January → Monday's readings).
 */
function entryId(id: string, date: IsoDate, epiphany: IsoDate): string {
  if (!AFTER_EPIPHANY.test(id)) return id;
  const [year, month, day] = dateParts(date);
  if (epiphany !== `${String(year)}-01-06` || month !== 1 || day < 7 || day > 12) return id;
  return `${AFTER_EPIPHANY_DAYS[day - 7] as string}-after-epiphany`;
}

/** The dated weekday of a date that is not a Sunday (17–24 December, 29–31 December, 2–7 January before the Epiphany). */
function datedWeekdayId(day: LectionaryDay, epiphany: IsoDate): string | undefined {
  if (weekdayOf(day.date) === 'sun') return undefined;
  const [, month, date] = dateParts(day.date);
  if (day.season === 'advent' && month === 12 && date >= 17 && date <= 24) return `advent-december-${String(date)}`;
  if (day.season !== 'christmas') return undefined;
  if (month === 12 && date >= 29) return `christmas-octave-day-${String(date - 24)}`;
  if (month === 1 && date >= 2 && date <= 7 && day.date < epiphany) return `christmas-time-january-${String(date)}`;
  return undefined;
}

/**
 * Resolves the Masses of a day. Throws a `RefError` only when the data holds a ref that does not
 * parse, which `lectionary:check` rejects.
 */
export function resolveDay(day: LectionaryDay, lectionary: Lectionary, options: ResolveOptions): Resolution {
  const { epiphany } = options;
  const ptKey = properOfTimeKey(day.date, day.season, day.seasonWeek);
  const cycles: Cycle[] = [day.sundayCycle, day.weekdayCycle];
  const principal = day.celebrations.find((c) => !OPTIONAL.includes(c.rank));
  if (principal !== undefined && NO_MASS_DAYS.has(principal.id)) {
    return { date: day.date, properOfTimeKey: ptKey, masses: [], noMass: true };
  }
  const idOf = (c: LectionaryCelebration): string => entryId(c.id, day.date, epiphany);
  const proper = principal === undefined ? undefined : lectionary.get('celebrations', idOf(principal));
  const sunday = isSundayKey(ptKey);
  const easterOctave = day.season === 'easter' && day.seasonWeek === 1 && !sunday;

  /** The weekday (or Sunday) under the day's celebrations: a dated weekday entry, else the proper of time. */
  const base = ((): { entry: Entry; from: string } | undefined => {
    const candidates = [
      ...day.celebrations.filter((c) => c.rank === 'weekday').map(idOf),
      ...day.celebrations.flatMap((c) => (c.weekdayId === undefined ? [] : [entryId(c.weekdayId, day.date, epiphany)])),
      datedWeekdayId(day, epiphany),
    ];
    for (const id of candidates) {
      const entry = id === undefined ? undefined : lectionary.get('celebrations', id);
      if (entry !== undefined) return { entry, from: `celebrations:${id as string}` };
    }
    const entry = lectionary.get('proper-of-time', ptKey);
    return entry === undefined ? undefined : { entry, from: `proper-of-time:${ptKey}` };
  })();

  const fromEntry = (entry: Entry, from: string, full: boolean, name?: string): ResolvedMass[] =>
    entry.masses
      .map((mass) =>
        build(
          mass.id,
          mass.label ?? (mass.id === 'day' && name !== undefined ? name : (MASS_LABELS[mass.id] ?? mass.id)),
          readingsFor(mass, cycles),
          [from],
          full,
        ),
      )
      .filter((mass) => mass.readings.length > 0);

  /** The weekday (or Sunday) Mass with `overlay`'s proper slots laid over it. */
  const overlaid = (overlay: Entry, id: string, label: string): ResolvedMass | undefined => {
    const extra = overlay.masses[0];
    if (extra === undefined) return undefined;
    const weekday = base?.entry.masses[0];
    const bySlot = weekday === undefined ? new Map<ReadingSlot, ResolvedReading>() : readingsFor(weekday, cycles);
    for (const [slot, reading] of readingsFor(extra, cycles)) bySlot.set(slot, reading);
    const from = weekday === undefined ? [] : [(base as { from: string }).from];
    return build(id, label, bySlot, [...from, `celebrations:${overlay.key}`], sunday);
  };

  const weekdayMasses = (): ResolvedMass[] => (base === undefined ? [] : fromEntry(base.entry, base.from, sunday));

  let masses: ResolvedMass[];
  const rank = principal?.rank;
  if (principal !== undefined && rank === 'memorial') {
    const memorial = proper === undefined ? undefined : overlaid(proper, 'day', principal.name ?? principal.id);
    masses = memorial === undefined ? weekdayMasses() : [memorial];
  } else if (principal !== undefined && proper !== undefined) {
    const full = (rank === 'solemnity' && !easterOctave) || rank === 'sunday' || sunday;
    const common =
      proper.masses.length === 0 && proper.common !== undefined ? lectionary.get('commons', proper.common) : undefined;
    masses =
      common === undefined
        ? fromEntry(proper, `celebrations:${proper.key}`, full, principal.name)
        : fromEntry(common, `commons:${common.key}`, full, principal.name);
  } else if (rank === 'solemnity' || rank === 'feast') {
    masses = [];
  } else {
    masses = weekdayMasses();
  }

  if (rank !== 'solemnity' && rank !== 'feast' && rank !== 'sunday') {
    for (const option of day.celebrations.filter((c) => OPTIONAL.includes(c.rank))) {
      const entry = lectionary.get('celebrations', option.id);
      const mass = entry === undefined ? undefined : overlaid(entry, option.id, option.name ?? option.id);
      if (mass !== undefined) masses.push(mass);
    }
  }
  return { date: day.date, properOfTimeKey: ptKey, masses, noMass: false };
}
