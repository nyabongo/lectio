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

  it('gives a Year I weekday its own first reading and psalm and the shared gospel', () => {
    const resolution = resolveDay(
      { ...day('2027-09-20', 25, [{ id: 'ordinary-time-25-monday', rank: 'weekday' }]), weekdayCycle: 'I' },
      seed,
    );
    expect(brief(resolution.masses)).toEqual([
      {
        id: 'day',
        refs: ['first-reading Ezr 1:1-6', 'psalm Ps 126:1-2, 2-3, 4-5, 6', 'gospel Lk 8:16-18'],
        missing: [],
      },
    ]);
  });

  it('gives Sundays 25 and 26 their readings in Years B and C', () => {
    const sunday = (date: string, week: number, cycle: 'B' | 'C') =>
      resolveDay({ ...day(date, week, [{ id: 's', rank: 'sunday' }]), sundayCycle: cycle }, seed).masses[0];
    expect(sunday('2027-09-19', 25, 'B')?.readings.map((r) => r.ref)).toEqual([
      'Wis 2:12, 17-20',
      'Ps 54:3-4, 5, 6, 8',
      'Jas 3:16-4:3',
      'Mk 9:30-37',
    ]);
    const c = sunday('2025-09-21', 25, 'C');
    expect(c?.missingSlots).toEqual([]);
    expect(c?.readings[3]?.alternatives?.map((a) => a.ref)).toEqual(['Lk 16:10-13']);
    expect(sunday('2027-09-26', 26, 'B')?.readings[3]?.ref).toBe('Mk 9:38-43, 45, 47-48');
    expect(sunday('2025-09-28', 26, 'C')?.readings[0]?.ref).toBe('Am 6:1, 4-7');
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

  it('asks a feast on a Sunday for a second reading', () => {
    const sunday = { ...tuesday([{ id: 'feast-with-common', rank: 'feast' }]), date: '2026-02-01' };
    expect(resolveDay(sunday, lectionary).masses[0]?.missingSlots).toEqual(['psalm', 'second-reading']);
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

describe('resolveDay: dated weekdays, the Epiphany, cycles and the Triduum', () => {
  const gospelOnly = (key: string, ref: string) => entry(key, [reading('gospel', ref)]);
  const weekdayOf3 = (key: string, gospel: string) =>
    entry(key, [
      reading('first-reading', '1 Jn 2:22-28'),
      reading('psalm', 'Ps 98:1, 2-3, 3-4'),
      reading('gospel', gospel),
    ]);
  const lectionary = new Lectionary([
    file('proper-of-time', [
      entry('ot-weekday-1-mon', [
        reading('first-reading', 'Heb 1:1-6'),
        reading('first-reading', '1 Sm 1:1-8', { cycle: 'II' }),
        reading('first-reading', 'Is 4:2-6', { cycle: 'A' }),
        reading('psalm', 'Ps 97:1-2'),
        reading('gospel', 'Mk 1:14-20'),
      ]),
    ]),
    file('celebrations', [
      weekdayOf3('christmas-time-january-2', 'Jn 1:19-28'),
      weekdayOf3('christmas-octave-day-5', 'Lk 2:22-35'),
      weekdayOf3('advent-december-21', 'Lk 1:39-45'),
      entry('gregory-with-gospel', [reading('gospel', 'Mt 23:8-12')]),
      entry('raymond-with-reading', [reading('first-reading', '2 Cor 5:14-20')]),
      gospelOnly('christmas-time-january-7', 'Jn 2:1-11'),
      gospelOnly('monday-after-epiphany', 'Mt 4:12-17, 23-25'),
      gospelOnly('tuesday-after-epiphany', 'Mk 6:34-44'),
      gospelOnly('wednesday-after-epiphany', 'Mk 6:45-52'),
      gospelOnly('thursday-after-epiphany', 'Lk 4:14-22'),
      gospelOnly('friday-after-epiphany', 'Lk 5:12-16'),
      gospelOnly('saturday-after-epiphany', 'Jn 3:22-30'),
      entry('easter-monday', [
        reading('first-reading', 'Acts 2:14, 22-33'),
        reading('psalm', 'Ps 16:1-2, 5, 7-8, 9-10, 11'),
        reading('gospel', 'Mt 28:8-15'),
      ]),
      {
        key: 'palm-sunday',
        masses: [
          { id: 'procession', readings: [reading('gospel', 'Mt 21:1-11', { cycle: 'A' })] },
          {
            id: 'day',
            readings: [
              reading('first-reading', 'Is 50:4-7'),
              reading('psalm', 'Ps 22:8-9, 17-18, 19-20, 23-24'),
              reading('second-reading', 'Phil 2:6-11'),
              reading('gospel', 'Mt 26:14-27:66', { cycle: 'A' }),
            ],
          },
        ],
      },
      {
        key: 'easter-sunday',
        masses: [
          {
            id: 'easter-vigil',
            readings: [
              reading('gospel', 'Mt 28:1-10', { cycle: 'A' }),
              reading('reading-1', 'Gn 1:1-2:2'),
              reading('reading-2', 'Gn 22:1-18'),
              reading('psalm-1', 'Ps 104:1-2, 5-6, 10, 12, 13-14, 24, 35'),
              reading('psalm-2', 'Ps 16:5, 8, 9-10, 11'),
              reading('psalm-3', 'Ps 118:1-2, 16-17, 22-23'),
              reading('epistle', 'Rom 6:3-11'),
            ],
          },
          { id: 'day', readings: [reading('gospel', 'Jn 20:1-9')] },
        ],
      },
    ]),
  ]);
  const christmas = (date: string, celebrations: LectionaryDay['celebrations']): LectionaryDay => ({
    date,
    season: 'christmas',
    seasonWeek: 0,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations,
  });
  const gospels = (d: LectionaryDay, options = {}) =>
    resolveDay(d, lectionary, options).masses.map((m) => `${m.id} ${String(m.readings.at(-1)?.ref)}`);

  it('keeps the dated weekday readings of 2 January under an obligatory memorial without propers', () => {
    const basil = { id: 'basil-and-gregory', rank: 'memorial' as const, name: 'Sts Basil and Gregory' };
    for (const celebration of [{ ...basil, weekdayId: 'christmas-time-january-2' }, basil]) {
      const { masses } = resolveDay(christmas('2026-01-02', [celebration]), lectionary);
      expect(brief(masses)).toEqual([
        {
          id: 'day',
          refs: ['first-reading 1 Jn 2:22-28', 'psalm Ps 98:1, 2-3, 3-4', 'gospel Jn 1:19-28'],
          missing: [],
        },
      ]);
      expect(masses[0]?.from).toEqual(['celebrations:christmas-time-january-2']);
    }
    // Before the Epiphany (on Sunday 4 January 2026) the date gives the weekday too.
    expect(gospels(christmas('2026-01-02', [basil]), { epiphany: '2026-01-04' })).toEqual(['day Jn 1:19-28']);
  });

  it('lays an obligatory memorial’s propers over the dated weekday', () => {
    const { masses } = resolveDay(
      christmas('2026-01-02', [{ id: 'gregory-with-gospel', rank: 'memorial', weekdayId: 'christmas-time-january-2' }]),
      lectionary,
    );
    expect(brief(masses)).toEqual([
      { id: 'day', refs: ['first-reading 1 Jn 2:22-28', 'psalm Ps 98:1, 2-3, 3-4', 'gospel Mt 23:8-12'], missing: [] },
    ]);
    expect(masses[0]?.from).toEqual(['celebrations:christmas-time-january-2', 'celebrations:gregory-with-gospel']);
  });

  it('finds the dated weekday of 17-24 December and the Christmas octave from the date, but not on a Sunday', () => {
    const memorial = [{ id: 'memorial', rank: 'memorial' as const }];
    expect(gospels(christmas('2026-12-29', memorial))).toEqual(['day Lk 2:22-35']);
    expect(gospels({ ...christmas('2026-12-21', memorial), season: 'advent', seasonWeek: 4 })).toEqual([
      'day Lk 1:39-45',
    ]);
    expect(gospels({ ...christmas('2025-12-21', memorial), season: 'advent', seasonWeek: 4 })).toEqual([]);
    // After the Epiphany (Sunday 4 January 2026), 5 January is not a dated weekday.
    expect(gospels(christmas('2026-01-05', memorial), { epiphany: '2026-01-04' })).toEqual([]);
    expect(gospels(christmas('2026-01-08', memorial))).toEqual([]);
  });

  it('offers an optional memorial over the dated weekday it falls on', () => {
    const days = [
      { id: 'advent-december-21', rank: 'weekday' as const },
      { id: 'gregory-with-gospel', rank: 'commemoration' as const, weekdayId: 'advent-december-21' },
    ];
    expect(gospels({ ...christmas('2026-12-21', days), season: 'advent', seasonWeek: 4 })).toEqual([
      'day Lk 1:39-45',
      'gregory-with-gospel Mt 23:8-12',
    ]);
  });

  describe('7-12 January', () => {
    const afterEpiphany = (date: string, weekday: string): LectionaryDay =>
      christmas(date, [{ id: `${weekday}-after-epiphany`, rank: 'weekday' }]);

    it('with the Epiphany on 6 January, reads the weekday readings in date order (7 January = Monday)', () => {
      const options = { epiphany: '2026-01-06' };
      // 2026: Epiphany on Tuesday 6 January; Wednesday 7 to Saturday 10, then the Baptism on Sunday 11.
      expect(gospels(afterEpiphany('2026-01-07', 'wednesday'), options)).toEqual(['day Mt 4:12-17, 23-25']);
      expect(gospels(afterEpiphany('2026-01-08', 'thursday'), options)).toEqual(['day Mk 6:34-44']);
      expect(gospels(afterEpiphany('2026-01-09', 'friday'), options)).toEqual(['day Mk 6:45-52']);
      expect(gospels(afterEpiphany('2026-01-10', 'saturday'), options)).toEqual(['day Lk 4:14-22']);
      // 2027: Epiphany on Wednesday 6 January; Thursday 7 reads Monday's, Saturday 9 Wednesday's.
      const options2027 = { epiphany: '2027-01-06' };
      expect(gospels(afterEpiphany('2027-01-07', 'thursday'), options2027)).toEqual(['day Mt 4:12-17, 23-25']);
      expect(gospels(afterEpiphany('2027-01-09', 'saturday'), options2027)).toEqual(['day Mk 6:45-52']);
      // 2031: Epiphany on Monday 6 January; Saturday 11, the last day before the Baptism, reads Friday's.
      expect(gospels(afterEpiphany('2031-01-11', 'saturday'), { epiphany: '2031-01-06' })).toEqual(['day Lk 5:12-16']);
    });

    it('applies the date order to an optional memorial’s weekday too', () => {
      const days = [
        { id: 'wednesday-after-epiphany', rank: 'weekday' as const },
        { id: 'raymond-with-reading', rank: 'optional-memorial' as const, weekdayId: 'wednesday-after-epiphany' },
      ];
      expect(gospels(christmas('2026-01-07', days), { epiphany: '2026-01-06' })).toEqual([
        'day Mt 4:12-17, 23-25',
        'raymond-with-reading Mt 4:12-17, 23-25',
      ]);
    });

    it('with the Epiphany on a Sunday, reads the dated readings before it and the named weekday after it', () => {
      // 2026 in Kenya: Epiphany on Sunday 4 January; Wednesday 7 January reads Wednesday's readings.
      expect(gospels(afterEpiphany('2026-01-07', 'wednesday'), { epiphany: '2026-01-04' })).toEqual(['day Mk 6:45-52']);
      // 2023: Epiphany on Sunday 8 January; Saturday 7 January reads the readings dated 7 January.
      expect(
        gospels(christmas('2023-01-07', [{ id: 'christmas-time-january-7', rank: 'weekday' }]), {
          epiphany: '2023-01-08',
        }),
      ).toEqual(['day Jn 2:1-11']);
      // Without the Epiphany's date the calendar's names are used as they are.
      expect(gospels(afterEpiphany('2026-01-07', 'wednesday'))).toEqual(['day Mk 6:45-52']);
      // Outside 7-12 January, or in another year, nothing is remapped.
      expect(gospels(afterEpiphany('2026-01-13', 'tuesday'), { epiphany: '2026-01-06' })).toEqual(['day Mk 6:34-44']);
      expect(gospels(afterEpiphany('2027-01-07', 'thursday'), { epiphany: '2026-01-06' })).toEqual(['day Lk 4:14-22']);
    });
  });

  it('prefers a Sunday-cycle substitute over a weekday-cycle reading over a shared one', () => {
    const monday = (sundayCycle: 'A' | 'B', weekdayCycle: 'I' | 'II'): LectionaryDay => ({
      date: '2026-01-12',
      season: 'ordinary-time',
      seasonWeek: 1,
      sundayCycle,
      weekdayCycle,
      celebrations: [{ id: 'ordinary-time-1-monday', rank: 'weekday' }],
    });
    const first = (d: LectionaryDay) => resolveDay(d, lectionary).masses[0]?.readings[0]?.ref;
    expect(first(monday('A', 'II'))).toBe('Is 4:2-6');
    expect(first(monday('B', 'II'))).toBe('1 Sm 1:1-8');
    expect(first(monday('B', 'I'))).toBe('Heb 1:1-6');
  });

  it('reads an Easter-octave weekday without a second reading, though it ranks as a solemnity', () => {
    const day: LectionaryDay = {
      date: '2026-04-06',
      season: 'easter',
      seasonWeek: 1,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [{ id: 'easter-monday', rank: 'solemnity' }],
    };
    expect(resolveDay(day, lectionary).masses[0]?.missingSlots).toEqual([]);
  });

  it('asks the Palm Sunday procession only for its gospel', () => {
    const day: LectionaryDay = {
      date: '2026-03-29',
      season: 'lent',
      seasonWeek: 6,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [{ id: 'palm-sunday', rank: 'sunday' }],
    };
    expect(brief(resolveDay(day, lectionary).masses).map((m) => [m.id, m.missing])).toEqual([
      ['procession', []],
      ['day', []],
    ]);
  });

  it('lists the Easter Vigil on Holy Saturday, in proclamation order', () => {
    const day: LectionaryDay = {
      date: '2026-04-04',
      season: 'paschal-triduum',
      seasonWeek: 0,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [{ id: 'holy-saturday', rank: 'weekday' }],
    };
    const { masses } = resolveDay(day, lectionary);
    expect(masses.map((m) => [m.id, m.label, m.from, m.missingSlots])).toEqual([
      ['easter-vigil', 'Easter Vigil in the Holy Night', ['celebrations:easter-sunday'], []],
    ]);
    expect(masses[0]?.readings.map((r) => r.slot)).toEqual([
      'reading-1',
      'psalm-1',
      'reading-2',
      'psalm-2',
      'epistle',
      'psalm-3',
      'gospel',
    ]);
    expect(resolveDay(day, new Lectionary([])).masses).toEqual([]);
  });
});
