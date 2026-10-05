/**
 * The resolver: a calendar day → its Masses with readings.
 *
 * Precedence (General Norms for the Liturgical Year and the Lectionary's introduction, nos. 70–83):
 *
 * - The principal celebration is the first one in the day's list (ranked by the calendar, L-014)
 *   that is not an optional memorial or commemoration.
 * - Solemnities and feasts (and any principal celebration with its own entry) use their proper
 *   readings; a feast without its own readings uses its common.
 * - Sundays and weekdays use the proper of time for the day's season, week and cycle.
 * - Obligatory memorials keep the weekday readings, except the slots the memorial has proper
 *   readings for.
 * - Optional memorials keep the weekday readings. One with proper readings adds a second Mass
 *   (id = the celebration id) that may be chosen instead.
 */
import type { ReadingSlot } from '@lectio/schema/common';
import { READING_SLOTS } from '@lectio/schema/common';
import type { IsoDate } from '@lectio/shared';

import { refKey } from './canonical.ts';
import { isSundayKey, properOfTimeKey } from './keys.ts';
import type { Season } from './keys.ts';
import type { Cycle, Entry, EntryKind, EntryStatus, LoadedFile, MassEntry, Reading } from './types.ts';

export type CelebrationRank =
  'solemnity' | 'sunday' | 'feast' | 'memorial' | 'optional-memorial' | 'commemoration' | 'weekday';

/** The parts of a calendar day (`@lectio/schema/calendar` `CalendarDay`) the resolver reads. */
export interface LectionaryDay {
  readonly date: IsoDate;
  readonly season: Season;
  readonly seasonWeek: number;
  readonly sundayCycle: 'A' | 'B' | 'C';
  readonly weekdayCycle: 'I' | 'II';
  readonly celebrations: readonly { readonly id: string; readonly rank: CelebrationRank; readonly name?: string }[];
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
  /** Empty when the lectionary has no data for the day. */
  readonly masses: readonly ResolvedMass[];
}

const MASS_LABELS: Readonly<Record<string, string>> = {
  day: 'Mass of the day',
  vigil: 'Vigil Mass',
  night: 'Mass during the Night',
  dawn: 'Mass at Dawn',
};

const OPTIONAL: readonly CelebrationRank[] = ['optional-memorial', 'commemoration'];

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

function slotOrder(slot: ReadingSlot): number {
  return READING_SLOTS.indexOf(slot);
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

/** The readings of a Mass for the day's cycles, one per slot, in slot order. */
function readingsFor(mass: MassEntry, cycles: readonly Cycle[]): Map<ReadingSlot, ResolvedReading> {
  const bySlot = new Map<ReadingSlot, ResolvedReading>();
  // A reading for the day's cycle wins over one shared by every cycle.
  const ordered = [...mass.readings].sort((a, b) => Number(a.cycle !== undefined) - Number(b.cycle !== undefined));
  for (const reading of ordered) {
    if (reading.cycle === undefined || cycles.includes(reading.cycle))
      bySlot.set(reading.slot, resolveReading(reading));
  }
  return bySlot;
}

function required(full: boolean, slots: Iterable<ReadingSlot>): ReadingSlot[] {
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
  const readings = [...bySlot.values()].sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot));
  const missingSlots = required(full, bySlot.keys()).filter((slot) => !bySlot.has(slot));
  return { id, label, readings, from, missingSlots };
}

/**
 * Resolves the Masses of a day. Throws a `RefError` only when the data holds a ref that does not
 * parse, which `lectionary:check` rejects.
 */
export function resolveDay(day: LectionaryDay, lectionary: Lectionary): Resolution {
  const ptKey = properOfTimeKey(day.date, day.season, day.seasonWeek);
  const cycles: Cycle[] = [day.sundayCycle, day.weekdayCycle];
  const principal = day.celebrations.find((c) => !OPTIONAL.includes(c.rank));
  const proper = principal === undefined ? undefined : lectionary.get('celebrations', principal.id);
  const timeEntry = lectionary.get('proper-of-time', ptKey);
  const timeFrom = `proper-of-time:${ptKey}`;
  const sunday = isSundayKey(ptKey);

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
    const base = timeEntry?.masses[0];
    const bySlot = base === undefined ? new Map<ReadingSlot, ResolvedReading>() : readingsFor(base, cycles);
    const extra = overlay.masses[0];
    if (extra === undefined) return undefined;
    for (const [slot, reading] of readingsFor(extra, cycles)) bySlot.set(slot, reading);
    const from = base === undefined ? [] : [timeFrom];
    return build(id, label, bySlot, [...from, `celebrations:${overlay.key}`], sunday);
  };

  let masses: ResolvedMass[];
  const rank = principal?.rank;
  if (principal !== undefined && rank === 'memorial') {
    const memorial = proper === undefined ? undefined : overlaid(proper, 'day', principal.name ?? principal.id);
    masses =
      memorial === undefined ? (timeEntry === undefined ? [] : fromEntry(timeEntry, timeFrom, sunday)) : [memorial];
  } else if (principal !== undefined && proper !== undefined) {
    const full = rank === 'solemnity' || rank === 'sunday';
    const common =
      proper.masses.length === 0 && proper.common !== undefined ? lectionary.get('commons', proper.common) : undefined;
    masses =
      common === undefined
        ? fromEntry(proper, `celebrations:${proper.key}`, full, principal.name)
        : fromEntry(common, `commons:${common.key}`, full, principal.name);
  } else if (rank === 'solemnity' || rank === 'feast') {
    masses = [];
  } else {
    masses = timeEntry === undefined ? [] : fromEntry(timeEntry, timeFrom, sunday);
  }

  if (rank !== 'solemnity' && rank !== 'feast' && rank !== 'sunday') {
    for (const option of day.celebrations.filter((c) => OPTIONAL.includes(c.rank))) {
      const entry = lectionary.get('celebrations', option.id);
      const mass = entry === undefined ? undefined : overlaid(entry, option.id, option.name ?? option.id);
      if (mass !== undefined) masses.push(mass);
    }
  }
  return { date: day.date, properOfTimeKey: ptKey, masses };
}
