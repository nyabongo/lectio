import { beforeAll, describe, expect, it } from 'vitest';

import { DATA_ROOT, entry, file, reading } from './fixtures/data.ts';
import { loadLectionary } from './load.ts';
import { Lectionary, resolveDay } from './resolve.ts';
import type { LectionaryDay } from './resolve.ts';

/** A day in Ordinary Time 2026 (Year A, weekday Year II). */
function day(date: string, week: number, celebrations: LectionaryDay['celebrations']): LectionaryDay {
  return { date, season: 'ordinary-time', seasonWeek: week, sundayCycle: 'A', weekdayCycle: 'II', celebrations };
}

const brief = (masses: ReturnType<typeof resolveDay>['masses']) =>
  masses.map((m) => ({ id: m.id, refs: m.readings.map((r) => `${r.slot} ${r.ref}`), missing: m.missingSlots }));

describe('resolveDay on the seed block', () => {
  let seed: Lectionary;
  beforeAll(async () => {
    const { files, problems } = await loadLectionary(DATA_ROOT, ['seed']);
    expect(problems).toEqual([]);
    seed = new Lectionary(files);
  });

  it('2026-09-20 resolves to the 25th Sunday, Year A (L-016 acceptance)', () => {
    const resolution = resolveDay(day('2026-09-20', 25, [{ id: 'ordinary-time-25-sunday', rank: 'sunday' }]), seed);
    expect(resolution.properOfTimeKey).toBe('ot-sunday-25');
    expect(resolution.masses).toHaveLength(1);
    const [mass] = resolution.masses;
    expect(mass?.id).toBe('day');
    expect(mass?.label).toBe('Mass of the day');
    expect(mass?.missingSlots).toEqual([]);
    expect(mass?.from).toEqual(['proper-of-time:ot-sunday-25']);
    expect(mass?.readings.map(({ slot, ref, key, printed, status }) => ({ slot, ref, key, printed, status }))).toEqual([
      { slot: 'first-reading', ref: 'Is 55:6-9', key: 'IS.55.6-9', printed: 'Isaiah 55:6-9', status: 'provisional' },
      {
        slot: 'psalm',
        ref: 'Ps 145:2-3, 8-9, 17-18',
        key: 'PS.145.2-3_145.8-9_145.17-18',
        printed: 'Psalm 145:2-3, 8-9, 17-18',
        status: 'provisional',
      },
      {
        slot: 'second-reading',
        ref: 'Phil 1:20-24, 27',
        key: 'PHIL.1.20-24_1.27',
        printed: 'Philippians 1:20c-24, 27a',
        status: 'provisional',
      },
      { slot: 'gospel', ref: 'Mt 20:1-16', key: 'MT.20.1-16', printed: 'Matthew 20:1-16a', status: 'provisional' },
    ]);
  });

  it('2026-09-21 resolves to the St Matthew proper readings, not the weekday (L-016 acceptance)', () => {
    const resolution = resolveDay(
      day('2026-09-21', 25, [{ id: 'matthew-apostle', rank: 'feast', name: 'Saint Matthew, Apostle and Evangelist' }]),
      seed,
    );
    expect(resolution.properOfTimeKey).toBe('ot-weekday-25-mon');
    expect(brief(resolution.masses)).toEqual([
      { id: 'day', refs: ['first-reading Eph 4:1-7, 11-13', 'psalm Ps 19:2-3, 4-5', 'gospel Mt 9:9-13'], missing: [] },
    ]);
    expect(resolution.masses[0]?.label).toBe('Saint Matthew, Apostle and Evangelist');
    expect(resolution.masses[0]?.readings.every((r) => r.status === 'provisional')).toBe(true);
  });

  it('resolves every day from Sat 19 to Sun 27 Sep 2026 to a complete Mass', () => {
    const days: LectionaryDay[] = [
      day('2026-09-19', 24, [
        { id: 'ordinary-time-24-saturday', rank: 'weekday' },
        { id: 'januarius-bishop', rank: 'optional-memorial' },
      ]),
      day('2026-09-20', 25, [{ id: 'ordinary-time-25-sunday', rank: 'sunday' }]),
      day('2026-09-21', 25, [{ id: 'matthew-apostle', rank: 'feast' }]),
      day('2026-09-22', 25, [{ id: 'ordinary-time-25-tuesday', rank: 'weekday' }]),
      day('2026-09-23', 25, [{ id: 'pius-of-pietrelcina-priest', rank: 'memorial' }]),
      day('2026-09-24', 25, [{ id: 'ordinary-time-25-thursday', rank: 'weekday' }]),
      day('2026-09-25', 25, [{ id: 'ordinary-time-25-friday', rank: 'weekday' }]),
      day('2026-09-26', 25, [
        { id: 'ordinary-time-25-saturday', rank: 'weekday' },
        { id: 'cosmas-and-damian-martyrs', rank: 'optional-memorial' },
      ]),
      day('2026-09-27', 26, [{ id: 'ordinary-time-26-sunday', rank: 'sunday' }]),
    ];
    const gospels = days.map((d) => {
      const { masses } = resolveDay(d, seed);
      expect(masses).toHaveLength(1);
      expect(masses[0]?.missingSlots).toEqual([]);
      return masses[0]?.readings.at(-1)?.ref;
    });
    expect(gospels).toEqual([
      'Lk 8:4-15',
      'Mt 20:1-16',
      'Mt 9:9-13',
      'Lk 8:19-21',
      'Lk 9:1-6',
      'Lk 9:7-9',
      'Lk 9:18-22',
      'Lk 9:43-45',
      'Mt 21:28-32',
    ]);
    const sunday26 = resolveDay(days[8] as LectionaryDay, seed).masses[0];
    expect(sunday26?.readings[2]?.alternatives).toEqual([
      { ref: 'Phil 2:1-5', key: 'PHIL.2.1-5', printed: 'Philippians 2:1-5' },
    ]);
  });

  it('gives a Year I weekday only the shared gospel and reports what is missing', () => {
    const resolution = resolveDay(
      { ...day('2025-09-22', 25, [{ id: 'ordinary-time-25-monday', rank: 'weekday' }]), weekdayCycle: 'I' },
      seed,
    );
    expect(brief(resolution.masses)).toEqual([
      { id: 'day', refs: ['gospel Lk 8:16-18'], missing: ['first-reading', 'psalm'] },
    ]);
  });

  it('returns no Masses for a day without data', () => {
    expect(resolveDay(day('2026-06-14', 11, [{ id: 'x', rank: 'sunday' }]), seed).masses).toEqual([]);
  });
});

describe('resolveDay precedence', () => {
  const weekday = entry('ot-weekday-3-tue', [
    reading('first-reading', 'Heb 10:1-10', { cycle: 'I' }),
    reading('first-reading', '2 Sm 6:12-15, 17-19', { cycle: 'II' }),
    reading('psalm', 'Ps 24:7-10', { cycle: 'II' }),
    reading('gospel', 'Mk 3:31-35'),
  ]);
  const lectionary = new Lectionary([
    file('proper-of-time', [weekday]),
    file('proper-of-time', [entry('ot-weekday-3-tue', [reading('gospel', 'Jn 1:1')])], 'later/x.json'),
    file('celebrations', [
      entry('memorial-with-gospel', [reading('gospel', 'Lk 10:1-9', { printed: 'Luke 10:1-9' })]),
      entry('optional-with-gospel', [reading('gospel', 'Jn 15:9-17', { alternatives: [{ ref: 'Jn 15:9-11' }] })]),
      { key: 'feast-with-common', common: 'apostles', masses: [] },
      { key: 'feast-missing-common', common: 'nowhere', masses: [] },
      { key: 'memorial-with-common', common: 'apostles', masses: [] },
      {
        key: 'solemnity-with-vigil',
        masses: [
          { id: 'vigil', readings: [reading('first-reading', 'Jer 1:4-10'), reading('gospel', 'Lk 1:5-17')] },
          { id: 'day', label: 'Mass during the Day', readings: [reading('first-reading', 'Is 49:1-6')] },
          { id: 'extra', readings: [reading('gospel', 'Lk 1:57-66', { cycle: 'B' })] },
          { id: 'odd', readings: [reading('first-reading', 'Is 1:1')] },
        ],
      },
      {
        key: 'vigil-of-readings',
        masses: [{ id: 'vigil', readings: [reading('reading-1', 'Gn 1:1-2:2'), reading('gospel', 'Mt 28:1-10')] }],
      },
    ]),
    file('commons', [entry('apostles', [reading('first-reading', 'Acts 5:12-16'), reading('gospel', 'Mt 10:1-4')])]),
  ]);
  const tuesday = (celebrations: LectionaryDay['celebrations']): LectionaryDay => ({
    date: '2026-01-27',
    season: 'ordinary-time',
    seasonWeek: 3,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations,
  });
  const weekdayRefs = ['first-reading 2 Sm 6:12-15, 17-19', 'psalm Ps 24:7-10', 'gospel Mk 3:31-35'];

  it('uses the weekday cycle and ignores later definitions of the same key', () => {
    expect(brief(resolveDay(tuesday([{ id: 'w', rank: 'weekday' }]), lectionary).masses)).toEqual([
      { id: 'day', refs: weekdayRefs, missing: [] },
    ]);
    expect(brief(resolveDay(tuesday([]), lectionary).masses)).toEqual([{ id: 'day', refs: weekdayRefs, missing: [] }]);
  });

  it('lays an obligatory memorial’s proper slots over the weekday', () => {
    const [mass] = resolveDay(
      tuesday([{ id: 'memorial-with-gospel', rank: 'memorial', name: 'St X' }]),
      lectionary,
    ).masses;
    expect(mass?.label).toBe('St X');
    expect(mass?.readings.map((r) => `${r.slot} ${r.ref}`)).toEqual([...weekdayRefs.slice(0, 2), 'gospel Lk 10:1-9']);
    expect(mass?.from).toEqual(['proper-of-time:ot-weekday-3-tue', 'celebrations:memorial-with-gospel']);
    const unnamed = resolveDay(tuesday([{ id: 'memorial-with-gospel', rank: 'memorial' }]), lectionary).masses[0];
    expect(unnamed?.label).toBe('memorial-with-gospel');
  });

  it('returns no Masses for a memorial without proper readings on a day without data', () => {
    const wednesday = { ...tuesday([{ id: 'memorial-without-entry', rank: 'memorial' }]), date: '2026-01-28' };
    expect(resolveDay(wednesday, lectionary).masses).toEqual([]);
  });

  it('keeps the weekday for a memorial without proper readings', () => {
    for (const id of ['memorial-without-entry', 'memorial-with-common']) {
      expect(brief(resolveDay(tuesday([{ id, rank: 'memorial' }]), lectionary).masses)).toEqual([
        { id: 'day', refs: weekdayRefs, missing: [] },
      ]);
    }
  });

  it('offers an optional memorial with proper readings as a second Mass', () => {
    const masses = resolveDay(
      tuesday([
        { id: 'w', rank: 'weekday' },
        { id: 'optional-with-gospel', rank: 'optional-memorial', name: 'St Y' },
        { id: 'optional-without-entry', rank: 'optional-memorial' },
        { id: 'memorial-with-common', rank: 'commemoration' },
      ]),
      lectionary,
    ).masses;
    expect(brief(masses)).toEqual([
      { id: 'day', refs: weekdayRefs, missing: [] },
      { id: 'optional-with-gospel', refs: [...weekdayRefs.slice(0, 2), 'gospel Jn 15:9-17'], missing: [] },
    ]);
    expect(masses[1]?.label).toBe('St Y');
    expect(masses[1]?.readings[2]?.alternatives).toEqual([{ ref: 'Jn 15:9-11', key: 'JN.15.9-11' }]);
    const unnamed = resolveDay(tuesday([{ id: 'optional-with-gospel', rank: 'optional-memorial' }]), lectionary);
    expect(unnamed.masses[1]?.label).toBe('optional-with-gospel');
  });

  it('builds an optional-memorial Mass from its own readings when the weekday has no data', () => {
    const masses = resolveDay(
      { ...tuesday([{ id: 'optional-with-gospel', rank: 'optional-memorial' }]), date: '2026-01-28' },
      lectionary,
    ).masses;
    expect(brief(masses)).toEqual([
      { id: 'optional-with-gospel', refs: ['gospel Jn 15:9-17'], missing: ['first-reading', 'psalm'] },
    ]);
    expect(masses[0]?.from).toEqual(['celebrations:optional-with-gospel']);
  });

  it('uses the common for a feast without its own readings', () => {
    const masses = resolveDay(tuesday([{ id: 'feast-with-common', rank: 'feast', name: 'St Z' }]), lectionary).masses;
    expect(brief(masses)).toEqual([
      { id: 'day', refs: ['first-reading Acts 5:12-16', 'gospel Mt 10:1-4'], missing: ['psalm'] },
    ]);
    expect(masses[0]?.from).toEqual(['commons:apostles']);
    expect(masses[0]?.label).toBe('St Z');
    expect(resolveDay(tuesday([{ id: 'feast-missing-common', rank: 'feast' }]), lectionary).masses).toEqual([]);
  });

  it('returns no Masses for a feast or solemnity without data, rather than the weekday', () => {
    expect(resolveDay(tuesday([{ id: 'unknown', rank: 'feast' }]), lectionary).masses).toEqual([]);
    expect(resolveDay(tuesday([{ id: 'unknown', rank: 'solemnity' }]), lectionary).masses).toEqual([]);
  });

  it('gives a solemnity each of its Masses and skips Masses with nothing for the cycle', () => {
    const masses = resolveDay(
      tuesday([
        { id: 'solemnity-with-vigil', rank: 'solemnity' },
        { id: 'optional-with-gospel', rank: 'optional-memorial' },
      ]),
      lectionary,
    ).masses;
    expect(masses.map((m) => [m.id, m.label, m.missingSlots])).toEqual([
      ['vigil', 'Vigil Mass', ['psalm', 'second-reading']],
      ['day', 'Mass during the Day', ['psalm', 'second-reading', 'gospel']],
      ['odd', 'odd', ['psalm', 'second-reading', 'gospel']],
    ]);
  });

  it('does not ask a Mass of numbered readings for the usual slots', () => {
    const masses = resolveDay(tuesday([{ id: 'vigil-of-readings', rank: 'solemnity' }]), lectionary).masses;
    expect(masses[0]?.missingSlots).toEqual([]);
  });
});
