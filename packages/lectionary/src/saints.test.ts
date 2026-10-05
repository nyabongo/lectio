/**
 * The committed saints block (L-069): every solemnity and feast of the Proper of Saints and every memorial or optional
 * memorial with readings of its own has a complete Mass; every rule holds; every reading is compared with a second
 * source or listed as single-source with what was consulted, and disputes/saints.md is what
 * `lectionary:crosscheck -- --block saints` writes.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { checkLectionary } from './check.ts';
import { blockRows, crosscheckBlock, parseCrosscheckFile, renderDisputes } from './crosscheck.ts';
import type { CrosscheckResult } from './crosscheck.ts';
import { DATA_ROOT } from './fixtures/data.ts';
import { loadLectionary } from './load.ts';
import type { LoadResult } from './load.ts';
import { Lectionary, resolveDay } from './resolve.ts';
import type { LectionaryDay } from './resolve.ts';
import { splitSource } from './sources.ts';
import type { Entry, LoadedFile } from './types.ts';

const CYCLES = ['A', 'B', 'C'] as const;
/** A solemnity, or a feast of the Lord that may replace a Sunday: two readings before the gospel. */
const FULL = ['first-reading', 'psalm', 'second-reading', 'gospel'];
const THREE = ['first-reading', 'psalm', 'gospel'];

type Masses = Readonly<Record<string, readonly string[]>>;

/** The solemnities of the General Roman Calendar's Proper of Saints (romcal ranks). */
const SOLEMNITIES: Readonly<Record<string, Masses>> = {
  'joseph-spouse-of-mary': { day: FULL },
  'annunciation-of-the-lord': { day: FULL },
  'nativity-of-john-the-baptist': { vigil: FULL, day: FULL },
  'peter-and-paul-apostles': { vigil: FULL, day: FULL },
  'assumption-of-the-blessed-virgin-mary': { vigil: FULL, day: FULL },
  'all-saints': { day: FULL },
  'commemoration-of-all-the-faithful-departed': { day: FULL },
  'immaculate-conception-of-the-blessed-virgin-mary': { day: FULL },
};

/** The feasts of the Proper of Saints. St Matthew (21 September) is in the seed block. */
const FEASTS: Readonly<Record<string, Masses>> = {
  'conversion-of-saint-paul-the-apostle': { day: THREE },
  'presentation-of-the-lord': { day: FULL },
  'chair-of-saint-peter-the-apostle': { day: THREE },
  'mark-evangelist': { day: THREE },
  'philip-and-james-apostles': { day: THREE },
  'matthias-apostle': { day: THREE },
  'visitation-of-mary': { day: THREE },
  'thomas-apostle': { day: THREE },
  'mary-magdalene': { day: THREE },
  'james-apostle': { day: THREE },
  'transfiguration-of-the-lord': { day: FULL },
  'lawrence-of-rome-deacon': { day: THREE },
  'bartholomew-apostle': { day: THREE },
  'nativity-of-the-blessed-virgin-mary': { day: THREE },
  'exaltation-of-the-holy-cross': { day: FULL },
  'michael-gabriel-and-raphael-archangels': { day: THREE },
  'luke-evangelist': { day: THREE },
  'simon-and-jude-apostles': { day: THREE },
  'dedication-of-the-lateran-basilica': { day: FULL },
  'andrew-apostle': { day: THREE },
  'stephen-the-first-martyr': { day: THREE },
  'john-apostle': { day: THREE },
  'holy-innocents-martyrs': { day: THREE },
};
const IN_SEED = ['matthew-apostle'];

/**
 * Memorials and optional memorials with readings of their own: readings that tell of the saint or mystery, or that a
 * decree assigned to a celebration added after 1981. Every other memorial takes its readings from a Common, has no
 * entry, and keeps the weekday readings (Lectionary Introduction 83).
 */
const MEMORIALS: Readonly<Record<string, Masses>> = {
  'timothy-of-ephesus-and-titus-of-crete-bishops': { day: THREE },
  'barnabas-apostle': { day: THREE },
  'immaculate-heart-of-mary': { day: THREE },
  'martha-of-bethany-mary-of-bethany-and-lazarus-of-bethany': { day: THREE },
  'passion-of-saint-john-the-baptist': { day: THREE },
  'our-lady-of-sorrows': { day: THREE },
  'holy-guardian-angels': { day: THREE },
  'mary-mother-of-the-church': { day: THREE },
};
const OPTIONAL_MEMORIALS: Readonly<Record<string, Masses>> = {
  'most-holy-name-of-jesus': { day: THREE },
  'joseph-the-worker': { day: THREE },
  'dedication-of-the-basilicas-of-saints-peter-and-paul-apostles': { day: THREE },
  'faustina-kowalska-virgin': { day: THREE },
  'gregory-of-narek-abbot': { day: THREE },
  'hildegard-of-bingen-abbess': { day: THREE },
  'john-of-avila-priest': { day: THREE },
  'john-paul-ii-pope': { day: THREE },
  'john-xxiii-pope': { day: THREE },
  'our-lady-of-loreto': { day: THREE },
  'paul-vi-pope': { day: THREE },
  'teresa-of-calcutta-virgin': { day: THREE },
};

const CELEBRATIONS: Readonly<Record<string, Masses>> = {
  ...SOLEMNITIES,
  ...FEASTS,
  ...MEMORIALS,
  ...OPTIONAL_MEMORIALS,
};

/**
 * Known gap: the Kenya-proper celebrations (calendar/overrides/kenya.json, L-015) have no entry, because no open
 * source covers them; their readings need the Kenyan Daily Missal (011 Q5, `ke-dm-2018`). Until then the feast falls
 * back to nothing (L-070 reports it) and the memorials keep the weekday readings.
 */
const KENYA_FEASTS_WITHOUT_READINGS = ['our-lady-mother-of-africa'];

/** Slots of a Mass that have a reading for `cycle` (its own, or one shared by every cycle). */
function slotsFor(entry: Entry, mass: string, cycle: string): string[] {
  const readings = entry.masses.find((m) => m.id === mass)?.readings ?? [];
  return readings.filter((r) => r.cycle === undefined || r.cycle === cycle).map((r) => r.slot);
}

function entries(files: readonly LoadedFile[]): Map<string, Entry> {
  return new Map(
    files.filter((f) => f.data.kind === 'celebrations').flatMap((f) => f.data.entries.map((e) => [e.key, e])),
  );
}

async function readJson(...path: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(DATA_ROOT, ...path), 'utf8'));
}

function day(
  date: string,
  seasonWeek: number,
  sundayCycle: 'A' | 'B' | 'C',
  weekdayCycle: 'I' | 'II',
  celebrations: LectionaryDay['celebrations'],
): LectionaryDay {
  return { date, season: 'ordinary-time', seasonWeek, sundayCycle, weekdayCycle, celebrations };
}

describe('saints block', () => {
  let loaded: LoadResult;
  let all: LoadResult;
  let result: CrosscheckResult;
  beforeAll(async () => {
    loaded = await loadLectionary(DATA_ROOT, ['saints']);
    all = await loadLectionary(DATA_ROOT);
    const { data } = parseCrosscheckFile(await readJson('crosscheck', 'saints.json'), 'crosscheck/saints.json');
    result = crosscheckBlock('saints', loaded.files, data as never, loaded.registry);
  });

  it('passes lectionary:check on its own and together with every other block', () => {
    expect(loaded.problems).toEqual([]);
    expect(checkLectionary(loaded.files, loaded.registry).problems).toEqual([]);
    expect(all.problems).toEqual([]);
    expect(checkLectionary(all.files, all.registry).problems).toEqual([]);
  });

  it('has a provisional reading with a LitCal or OLM 1981 source everywhere', () => {
    const rows = blockRows(loaded.files);
    expect(rows.length).toBeGreaterThan(150);
    expect(rows.every((row) => row.reading.status === 'provisional')).toBe(true);
    expect(new Set(rows.map((row) => splitSource(row.reading.source)?.id))).toEqual(new Set(['litcal', 'olm-1981']));
  });

  it('has every listed celebration and nothing else, with every Mass complete in each Sunday cycle', () => {
    const celebrations = entries(loaded.files);
    expect([...celebrations.keys()].sort()).toEqual(Object.keys(CELEBRATIONS).sort());
    for (const [key, masses] of Object.entries(CELEBRATIONS)) {
      const entry = celebrations.get(key) as Entry;
      expect({ key, masses: entry.masses.map((m) => m.id) }).toEqual({ key, masses: Object.keys(masses) });
      for (const [mass, slots] of Object.entries(masses)) {
        for (const cycle of CYCLES) {
          expect({ key, mass, cycle, slots: slotsFor(entry, mass, cycle) }).toEqual({ key, mass, cycle, slots });
        }
      }
    }
  });

  it('covers every solemnity and feast of the sanctoral, here or in the seed block, keyed by Lectio id', async () => {
    const everywhere = entries(all.files);
    for (const key of [...Object.keys(SOLEMNITIES), ...Object.keys(FEASTS), ...IN_SEED]) {
      expect({ key, defined: everywhere.has(key) }).toEqual({ key, defined: true });
    }
    // Lectio ids are romcal ids in kebab-case (packages/calendar/src/fixtures/romcal-ids.json).
    const ids = (await readJson('..', '..', 'packages', 'calendar', 'src', 'fixtures', 'romcal-ids.json')) as Record<
      string,
      string
    >;
    const known = new Set(Object.values(ids));
    expect(Object.keys(CELEBRATIONS).filter((key) => !known.has(key))).toEqual([]);
  });

  // Known gap: when a source for the Kenya propers is registered (011 Q5), add their entries and empty this list.
  it('has no entry yet for the Kenya-proper celebrations, whose only feast is a known gap', async () => {
    const kenya = (await readJson('..', 'overrides', 'kenya.json')) as {
      entries: { action: string; id: string; rank?: string }[];
    };
    const added = kenya.entries.filter((e) => e.action === 'add');
    expect(added.length).toBeGreaterThan(0);
    const everywhere = entries(all.files);
    expect(added.filter((e) => everywhere.has(e.id)).map((e) => e.id)).toEqual([]);
    expect(added.filter((e) => e.rank === 'feast' || e.rank === 'solemnity').map((e) => e.id)).toEqual(
      KENYA_FEASTS_WITHOUT_READINGS,
    );
  });

  it('compares or lists every reading, and every disagreement is a real difference', () => {
    const rows = blockRows(loaded.files);
    expect(result.compared).toBeGreaterThan(60);
    expect(result.agreements + result.disagreements.length).toBe(result.compared);
    expect(result.singleSource).toHaveLength(rows.length - result.compared);
    // A single-source reading always says which second source was consulted, and why it gave nothing.
    expect(result.singleSource.filter((single) => single.consulted.length === 0).map((s) => s.id)).toEqual([]);
    expect(
      result.disagreements.filter((d) => !/^(passage|alternatives) differ/.test(d.reason)).map((d) => d.id),
    ).toEqual([]);
    // Same verses, cited differently; left for the owner.
    expect(result.disagreements.map((d) => d.id)).toEqual([
      'celebrations:holy-innocents-martyrs day first-reading',
      'celebrations:visitation-of-mary day psalm',
    ]);
  });

  it('keeps disputes/saints.md in step with the data and the cross-check file', async () => {
    const committed = await readFile(join(DATA_ROOT, 'disputes', 'saints.md'), 'utf8');
    expect(committed).toBe(renderDisputes(result));
  });

  it('resolves solemnities, feasts, memorials and optional memorials from the block', () => {
    const lectionary = new Lectionary(all.files);
    const gospels = (d: LectionaryDay) =>
      resolveDay(d, lectionary).masses.map((m) => [m.id, m.readings.find((r) => r.slot === 'gospel')?.key]);

    // The Assumption on a Saturday (2026-08-15): the Vigil and the Mass of the day, each with a second reading.
    const assumption = resolveDay(
      day('2026-08-15', 19, 'A', 'II', [{ id: 'assumption-of-the-blessed-virgin-mary', rank: 'solemnity' }]),
      lectionary,
    );
    expect(assumption.masses.map((m) => [m.id, m.missingSlots, m.readings.length])).toEqual([
      ['vigil', [], 4],
      ['day', [], 4],
    ]);
    // The Transfiguration takes the gospel of the year's Sunday cycle.
    expect(gospels(day('2026-08-06', 18, 'A', 'II', [{ id: 'transfiguration-of-the-lord', rank: 'feast' }]))).toEqual([
      ['day', 'MT.17.1-9'],
    ]);
    // Our Lady of Sorrows (memorial): its own readings replace the weekday's.
    const sorrows = resolveDay(
      day('2026-09-15', 24, 'A', 'II', [{ id: 'our-lady-of-sorrows', rank: 'memorial' }]),
      lectionary,
    ).masses;
    expect(sorrows.map((m) => [m.from, m.readings.map((r) => r.key)])).toEqual([
      [
        ['proper-of-time:ot-weekday-24-tue', 'celebrations:our-lady-of-sorrows'],
        ['HEB.5.7-9', 'PS.31.2-3_31.3-4_31.5-6_31.15-16_31.20', 'JN.19.25-27'],
      ],
    ]);
    // St Agnes (memorial from the Common of Virgins): the weekday readings.
    expect(
      resolveDay(
        day('2027-01-21', 2, 'B', 'I', [{ id: 'agnes-of-rome-virgin', rank: 'memorial' }]),
        lectionary,
      ).masses.map((m) => m.from),
    ).toEqual([['proper-of-time:ot-weekday-2-thu']]);
    // St John Paul II (optional memorial): the weekday, and his Mass as an option.
    expect(
      gospels(
        day('2026-10-22', 29, 'A', 'II', [
          { id: 'ordinary-time-29-thursday', rank: 'weekday' },
          { id: 'john-paul-ii-pope', rank: 'optional-memorial' },
        ]),
      ),
    ).toEqual([
      ['day', 'LK.12.49-53'],
      ['john-paul-ii-pope', 'JN.21.15-17'],
    ]);
  });
});
