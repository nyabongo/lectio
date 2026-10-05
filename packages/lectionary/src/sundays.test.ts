/**
 * The committed sundays block (L-065): every Sunday of the proper of time and every solemnity and feast of the Lord
 * in it has a full set of readings for Years A, B and C; every rule holds; the cross-check covers every LitCal reading,
 * and disputes/sundays.md is what `lectionary:crosscheck -- --block sundays` writes.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { checkLectionary } from './check.ts';
import { blockRows, crosscheckBlock, parseCrosscheckFile, renderDisputes } from './crosscheck.ts';
import type { CrosscheckResult } from './crosscheck.ts';
import { DATA_ROOT, GENERAL_ROMAN } from './fixtures/data.ts';
import { loadLectionary } from './load.ts';
import type { LoadResult } from './load.ts';
import { Lectionary, resolveDay } from './resolve.ts';
import type { LectionaryDay } from './resolve.ts';
import { splitSource } from './sources.ts';
import type { Entry, LoadedFile } from './types.ts';

const CYCLES = ['A', 'B', 'C'] as const;
const SUNDAY_SLOTS = ['first-reading', 'psalm', 'second-reading', 'gospel'];
const VIGIL_SLOTS = [
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`reading-${n}`, `psalm-${n}`]),
  'epistle',
  'psalm-8',
  'gospel',
];

const range = (prefix: string, from: number, to: number, skip: number[] = []): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .filter((n) => !skip.includes(n))
    .map((n) => `${prefix}-sunday-${n}`);

/** Sundays 25 and 26 are in the seed block (Years A, B and C; B and C added by #142), and a key may be defined only once. */
const IN_SEED = [25, 26];
const PROPER_OF_TIME = [
  ...range('advent', 1, 4),
  ...range('lent', 1, 5),
  ...range('easter', 2, 7),
  ...range('ot', 2, 33, IN_SEED),
];

/** Celebration id → Mass id → slots each cycle needs. */
const CELEBRATIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'nativity-of-the-lord': {
    vigil: SUNDAY_SLOTS,
    night: SUNDAY_SLOTS,
    dawn: SUNDAY_SLOTS,
    day: SUNDAY_SLOTS,
  },
  'holy-family-of-jesus-mary-and-joseph': { day: SUNDAY_SLOTS },
  'mary-mother-of-god': { day: SUNDAY_SLOTS },
  'second-sunday-after-christmas': { day: SUNDAY_SLOTS },
  'epiphany-of-the-lord': { day: SUNDAY_SLOTS },
  'baptism-of-the-lord': { day: SUNDAY_SLOTS },
  'palm-sunday-of-the-passion-of-the-lord': { procession: ['gospel'], day: SUNDAY_SLOTS },
  'thursday-of-the-lords-supper': { day: SUNDAY_SLOTS },
  'friday-of-the-passion-of-the-lord': { day: SUNDAY_SLOTS },
  'easter-sunday': { 'easter-vigil': VIGIL_SLOTS, day: SUNDAY_SLOTS, evening: SUNDAY_SLOTS },
  'ascension-of-the-lord': { day: SUNDAY_SLOTS },
  'pentecost-sunday': { vigil: SUNDAY_SLOTS, day: SUNDAY_SLOTS },
  'most-holy-trinity': { day: SUNDAY_SLOTS },
  'most-holy-body-and-blood-of-christ': { day: SUNDAY_SLOTS },
  'most-sacred-heart-of-jesus': { day: SUNDAY_SLOTS },
  'our-lord-jesus-christ-king-of-the-universe': { day: SUNDAY_SLOTS },
};

/** Slots of a Mass that have a reading for `cycle` (its own, or one shared by every cycle). */
function slotsFor(entry: Entry, mass: string, cycle: string): string[] {
  const readings = entry.masses.find((m) => m.id === mass)?.readings ?? [];
  return readings.filter((r) => r.cycle === undefined || r.cycle === cycle).map((r) => r.slot);
}

function entries(files: readonly LoadedFile[], kind: string): Map<string, Entry> {
  return new Map(files.filter((f) => f.data.kind === kind).flatMap((f) => f.data.entries.map((e) => [e.key, e])));
}

function day(
  date: string,
  season: LectionaryDay['season'],
  seasonWeek: number,
  sundayCycle: 'A' | 'B' | 'C',
  id: string,
  rank: 'solemnity' | 'sunday' | 'feast' | 'weekday',
): LectionaryDay {
  return { date, season, seasonWeek, sundayCycle, weekdayCycle: 'I', celebrations: [{ id, rank }] };
}

describe('sundays block', () => {
  let loaded: LoadResult;
  let all: LoadResult;
  let result: CrosscheckResult;
  beforeAll(async () => {
    loaded = await loadLectionary(DATA_ROOT, ['sundays']);
    all = await loadLectionary(DATA_ROOT);
    const json: unknown = JSON.parse(await readFile(join(DATA_ROOT, 'crosscheck', 'sundays.json'), 'utf8'));
    const { data } = parseCrosscheckFile(json, 'crosscheck/sundays.json');
    result = crosscheckBlock('sundays', loaded.files, data as never, loaded.registry);
  });

  it('passes lectionary:check on its own and together with every other block', () => {
    expect(loaded.problems).toEqual([]);
    expect(checkLectionary(loaded.files, loaded.registry).problems).toEqual([]);
    expect(all.problems).toEqual([]);
    expect(checkLectionary(all.files, all.registry).problems).toEqual([]);
  });

  it('has a provisional reading with a LitCal or OLM 1981 source everywhere', () => {
    const rows = blockRows(loaded.files);
    expect(rows.length).toBeGreaterThan(700);
    expect(rows.every((row) => row.reading.status === 'provisional')).toBe(true);
    expect(new Set(rows.map((row) => splitSource(row.reading.source)?.id))).toEqual(new Set(['litcal', 'olm-1981']));
  });

  it('has every Sunday of the proper of time, with all four readings in Years A, B and C', () => {
    const pot = entries(loaded.files, 'proper-of-time');
    expect([...pot.keys()].sort()).toEqual([...PROPER_OF_TIME].sort());
    for (const key of PROPER_OF_TIME) {
      for (const cycle of CYCLES) {
        expect({ key, cycle, slots: slotsFor(pot.get(key) as Entry, 'day', cycle) }).toEqual({
          key,
          cycle,
          slots: SUNDAY_SLOTS,
        });
      }
    }
  });

  it('leaves Sundays 25 and 26 to the seed block, which has all three years', () => {
    const pot = entries(all.files, 'proper-of-time');
    for (const week of IN_SEED) {
      const entry = pot.get(`ot-sunday-${week}`) as Entry;
      for (const cycle of ['A', 'B', 'C'] as const) expect(slotsFor(entry, 'day', cycle)).toEqual(SUNDAY_SLOTS);
    }
  });

  it('has every solemnity and feast of the Lord of the proper of time, with every Mass complete in each cycle', async () => {
    const celebrations = entries(loaded.files, 'celebrations');
    expect([...celebrations.keys()].sort()).toEqual(Object.keys(CELEBRATIONS).sort());
    for (const [key, masses] of Object.entries(CELEBRATIONS)) {
      const entry = celebrations.get(key) as Entry;
      expect(entry.masses.map((m) => m.id)).toEqual(Object.keys(masses));
      for (const [mass, slots] of Object.entries(masses)) {
        for (const cycle of CYCLES) {
          expect({ key, mass, cycle, slots: slotsFor(entry, mass, cycle).sort() }).toEqual({
            key,
            mass,
            cycle,
            slots: [...slots].sort(),
          });
        }
      }
    }
    // The keys are Lectio celebration ids (romcal ids in kebab-case, packages/calendar/src/fixtures/romcal-ids.json).
    const ids = JSON.parse(
      await readFile(join(DATA_ROOT, '..', '..', 'packages', 'calendar', 'src', 'fixtures', 'romcal-ids.json'), 'utf8'),
    ) as Record<string, string>;
    const known = new Set(Object.values(ids));
    expect(Object.keys(CELEBRATIONS).filter((key) => !known.has(key))).toEqual([]);
  });

  it('compares every LitCal reading with OLM 1981; the OLM-filled readings are single-source with the LitCal leaf consulted', () => {
    const rows = blockRows(loaded.files);
    const litcal = rows.filter((row) => row.reading.source.startsWith('litcal@'));
    // Known-wrong LitCal refs: the data holds the OLM citation, and LitCal's form is a recorded disagreement,
    // except Christ the King C, whose LitCal stanzas (Ps 122:1-3, 3-4, 4-5) cover the same verses.
    const corrected = [
      'celebrations:easter-sunday easter-vigil reading-6',
      'celebrations:second-sunday-after-christmas day first-reading',
      'celebrations:our-lord-jesus-christ-king-of-the-universe day psalm (C)',
    ];
    for (const id of corrected) {
      expect(rows.find((row) => row.id === id)?.reading.source).toMatch(/^olm-1981 /);
    }
    expect(result.disagreements.map((d) => d.id)).toEqual([
      'proper-of-time:ot-sunday-17 day gospel (A)',
      'celebrations:palm-sunday-of-the-passion-of-the-lord day gospel (A)',
      ...corrected.slice(0, 2),
    ]);
    expect(result.compared).toBe(litcal.length + corrected.length);
    expect(result.agreements + result.disagreements.length).toBe(result.compared);
    expect(result.singleSource).toHaveLength(rows.length - result.compared);
    expect(result.singleSource.every((single) => single.source.startsWith('olm-1981 '))).toBe(true);
    expect(result.singleSource.every((single) => single.consulted.length > 0)).toBe(true);
    // Every disagreement is a real difference of passage or alternatives, never a broken cross-check entry.
    expect(
      result.disagreements.filter((d) => !/^(passage|alternatives) differ/.test(d.reason)).map((d) => d.id),
    ).toEqual([]);
  });

  it('keeps disputes/sundays.md in step with the data and the cross-check file', async () => {
    const committed = await readFile(join(DATA_ROOT, 'disputes', 'sundays.md'), 'utf8');
    expect(committed).toBe(renderDisputes(result));
  });

  it('resolves Sundays and solemnities of each cycle from the block', () => {
    const lectionary = new Lectionary(all.files);
    const keys = (d: LectionaryDay, mass = 'day') =>
      resolveDay(d, lectionary, GENERAL_ROMAN)
        .masses.find((m) => m.id === mass)
        ?.readings.map((r) => r.key);

    // 1st Sunday of Advent, Year B (2026-11-29).
    expect(keys(day('2026-11-29', 'advent', 1, 'B', 'advent-1-sunday', 'sunday'))).toEqual([
      'IS.63.16-17_63.19_64.2-7',
      'PS.80.2-3_80.15-16_80.18-19',
      '1COR.1.3-9',
      'MK.13.33-37',
    ]);
    // 3rd Sunday of Ordinary Time, Year A, kept as the Sunday of the Word of God (2026-01-25).
    expect(keys(day('2026-01-25', 'ordinary-time', 3, 'A', 'sunday-of-the-word-of-god', 'sunday'))?.at(-1)).toBe(
      'MT.4.12-23',
    );
    // Easter Sunday, Year C: the Vigil, the Mass of the day and the evening Mass.
    const easter = resolveDay(
      day('2028-04-16', 'easter', 1, 'C', 'easter-sunday', 'solemnity'),
      lectionary,
      GENERAL_ROMAN,
    );
    expect(easter.masses.map((m) => [m.id, m.missingSlots])).toEqual([
      ['easter-vigil', []],
      ['day', []],
      ['evening', []],
    ]);
    expect(easter.masses[0]?.readings.find((r) => r.slot === 'gospel')?.key).toBe('LK.24.1-12');
    // Christmas: four Masses, the same every year.
    const christmas = resolveDay(
      day('2026-12-25', 'christmas', 0, 'B', 'nativity-of-the-lord', 'solemnity'),
      lectionary,
      GENERAL_ROMAN,
    );
    expect(christmas.masses.map((m) => m.id)).toEqual(['vigil', 'night', 'dawn', 'day']);
    expect(christmas.masses.every((m) => m.missingSlots.length === 0)).toBe(true);
    // Christ the King, Year C, from LitCal.
    expect(
      keys(day('2028-11-26', 'ordinary-time', 34, 'C', 'our-lord-jesus-christ-king-of-the-universe', 'solemnity'))?.at(
        -1,
      ),
    ).toBe('LK.23.35-43');
  });
});
