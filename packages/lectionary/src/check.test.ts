import { describe, expect, it } from 'vitest';

import { checkLectionary, checkRefString } from './check.ts';
import { LITCAL, REGISTRY, entry, file, reading } from './fixtures/data.ts';
import type { LectionaryDay } from './resolve.ts';

describe('checkRefString', () => {
  it('accepts canonical letter-free refs', () => {
    expect(checkRefString('Phil 1:20-24, 27', 'ref')).toEqual([]);
  });

  it('rejects unparsable, lettered and non-canonical refs', () => {
    expect(checkRefString('Nowhere 1:1', 'ref')[0]).toMatch(/^ref "Nowhere 1:1" does not parse: Unknown book/);
    expect(checkRefString('Is 55:6-9 or Is 55:1', 'ref')[0]).toMatch(/does not parse/);
    expect(checkRefString('Phil 1:20c-24, 27a', 'ref')).toEqual([
      'ref "Phil 1:20c-24, 27a" has verse letters; keep them in "printed" only',
    ]);
    expect(checkRefString('Philippians 1:20-24, 27', 'ref')).toEqual([
      'ref "Philippians 1:20-24, 27" is not spelled canonically; write "Phil 1:20-24, 27"',
    ]);
    expect(checkRefString('Is 55:6–9', 'x')).toEqual(['x "Is 55:6–9" is not spelled canonically; write "Is 55:6-9"']);
  });
});

describe('checkLectionary', () => {
  it('passes clean data and counts statuses', () => {
    const files = [
      file('proper-of-time', [
        entry('ot-sunday-25', [
          reading('gospel', 'Mt 20:1-16', { cycle: 'A', printed: 'Matthew 20:1-16a', source: LITCAL }),
        ]),
        entry('ot-weekday-25-tue', [
          reading('first-reading', 'Prv 21:1-6, 10-13', { cycle: 'II', source: 'olm-1981 p?#450' }),
          reading('gospel', 'Lk 8:19-21', { status: 'verified' }),
        ]),
      ]),
      file('celebrations', [
        entry('matthew-apostle', [reading('gospel', 'Mt 9:9-13', { status: 'disputed' })]),
        { key: 'barnabas-apostle', common: 'apostles', masses: [] },
      ]),
      file('commons', [
        entry('apostles', [reading('gospel', 'Mt 10:7-13', { alternatives: [{ ref: 'Jn 15:9-17' }] })]),
      ]),
    ];
    expect(checkLectionary(files, REGISTRY)).toEqual({
      problems: [],
      stats: {
        files: 3,
        entries: 5,
        readings: 5,
        byStatus: { provisional: 3, verified: 1, disputed: 1 },
        unknownPages: 1,
      },
    });
  });

  it('reports every rule', () => {
    const files = [
      file('proper-of-time', [
        entry('ot-sunday-25', [
          reading('gospel', 'Mt 20:1-16a', { cycle: 'II' }),
          reading('gospel', 'Mt 20:1-16', { cycle: 'II', source: 'usccb x' }),
          reading('psalm', 'Ps 145:2-3', { alternatives: [{ ref: 'Psalm 145:2' }] }),
        ]),
        entry('ot-weekday-25-tue', [reading('gospel', 'Lk 8:19-21', { cycle: 'A' })], { common: 'apostles' }),
        entry('Sunday 25', [reading('gospel', 'Mt 1:1')]),
        {
          key: 'ot-sunday-26',
          masses: [
            { id: 'Day', readings: [] },
            { id: 'Day', readings: [] },
          ],
        },
        { key: 'ot-sunday-27', masses: [] },
      ]),
      file(
        'proper-of-time',
        [entry('ot-sunday-25', [reading('gospel', 'Mt 20:1-16', { cycle: 'A' })])],
        'other/b.json',
      ),
      file('celebrations', [
        { key: 'barnabas-apostle', common: 'missing', masses: [] },
        entry('ot-sunday-25', [reading('gospel', 'Mt 20:1-16', { cycle: 'I' })]),
      ]),
    ];
    expect(checkLectionary(files, REGISTRY).problems).toEqual([
      'test/proper-of-time.json ot-sunday-25 day gospel (II): ref "Mt 20:1-16a" has verse letters; keep them in "printed" only',
      'test/proper-of-time.json ot-sunday-25 day gospel (II): cycle II does not apply to ot-sunday-25; use A/B/C',
      'test/proper-of-time.json ot-sunday-25 day gospel (II): defined twice',
      'test/proper-of-time.json ot-sunday-25 day gospel (II): source id "usccb" is not in sources.json',
      'test/proper-of-time.json ot-sunday-25 day gospel (II): cycle II does not apply to ot-sunday-25; use A/B/C',
      'test/proper-of-time.json ot-sunday-25 day psalm: alternatives[0].ref "Psalm 145:2" is not spelled canonically; write "Ps 145:2"',
      'test/proper-of-time.json ot-weekday-25-tue: only celebrations may name a common',
      'test/proper-of-time.json ot-weekday-25-tue day gospel (A): cycle A does not apply to ot-weekday-25-tue; use I/II',
      'test/proper-of-time.json entries[2]: key "Sunday 25" is not a valid proper-of-time key',
      'test/proper-of-time.json ot-sunday-26: mass id "Day" must be kebab-case',
      'test/proper-of-time.json ot-sunday-26: mass id "Day" must be kebab-case',
      'test/proper-of-time.json ot-sunday-26: mass "Day" is defined twice',
      'test/proper-of-time.json ot-sunday-27: has no masses and no common',
      'other/b.json ot-sunday-25: already defined in test/proper-of-time.json',
      'test/celebrations.json barnabas-apostle: common "missing" is not defined',
    ]);
  });

  describe('a feast or solemnity on a Sunday', () => {
    const files = [
      file('celebrations', [
        entry('transfiguration', [
          reading('first-reading', 'Dn 7:9-10, 13-14'),
          reading('psalm', 'Ps 97:1-2, 5-6, 9'),
          reading('gospel', 'Mt 17:1-9', { cycle: 'A' }),
        ]),
        entry('assumption', [
          reading('first-reading', 'Rv 11:19; 12:1-6, 10'),
          reading('psalm', 'Ps 45:10-12, 16'),
          reading('second-reading', '1 Cor 15:20-27'),
          reading('gospel', 'Lk 1:39-56'),
        ]),
      ]),
    ];
    const day = (date: string, celebrations: LectionaryDay['celebrations']): LectionaryDay => ({
      date,
      season: 'ordinary-time',
      seasonWeek: 18,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations,
    });

    it('must have a second reading', () => {
      const days = [
        day('2026-08-09', [
          { id: 'someone', rank: 'optional-memorial' },
          { id: 'transfiguration', rank: 'feast' },
        ]),
        day('2026-08-06', [{ id: 'transfiguration', rank: 'feast' }]),
        day('2026-08-16', [{ id: 'assumption', rank: 'solemnity' }]),
        day('2026-08-23', [{ id: 'unknown-feast', rank: 'feast' }]),
        day('2026-08-30', [{ id: 'transfiguration', rank: 'sunday' }]),
        day('2026-09-06', [{ id: 'transfiguration', rank: 'solemnity' }]),
        day('2026-09-13', []),
      ];
      expect(checkLectionary(files, REGISTRY, { days }).problems).toEqual([
        '2026-08-09 transfiguration day: a feast on a Sunday needs a second reading (from celebrations:transfiguration)',
        '2026-09-06 transfiguration day: a solemnity on a Sunday needs a second reading (from celebrations:transfiguration)',
      ]);
      expect(checkLectionary(files, REGISTRY).problems).toEqual([]);
    });
  });
});
