import { Lectionary } from '@lectio/lectionary';
import type { LectionaryDay, LoadedFile } from '@lectio/lectionary';
import type { CalendarDay, CalendarYear } from '@lectio/schema/calendar';
import { describe, expect, it } from 'vitest';

import { KNOWN_GAPS } from './gaps.ts';
import type { KnownGap } from './gaps.ts';
import {
  countStatuses,
  formatTotals,
  formatYear,
  knownGapFor,
  resolveOptions,
  unexpected,
  yearReport,
} from './report.ts';
import type { YearReport } from './report.ts';

const SOURCE = 'olm-1981 n. 1';

const file: LoadedFile = {
  block: 'test',
  path: 'test.json',
  data: {
    kind: 'celebrations',
    entries: [
      {
        key: 'test-feast',
        masses: [
          {
            id: 'day',
            readings: [
              { slot: 'first-reading', ref: 'Is 55:6-9', source: SOURCE, status: 'provisional' },
              { slot: 'psalm', ref: 'Ps 145:2-3', source: SOURCE, status: 'verified' },
              { slot: 'second-reading', ref: 'Phil 1:20-24', source: SOURCE, status: 'disputed' },
              { slot: 'gospel', ref: 'Mt 20:1-16', source: SOURCE, status: 'provisional' },
            ],
          },
        ],
      },
    ],
  },
};

function lectionaryDay(date: string, id: string): LectionaryDay {
  return {
    date,
    season: 'ordinary-time',
    seasonWeek: 20,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations: [{ id, rank: 'solemnity' }],
  };
}

describe('resolveOptions', () => {
  it('passes the Epiphany on when known', () => {
    expect(resolveOptions('2026-01-06')).toEqual({ epiphany: '2026-01-06' });
    expect(resolveOptions(undefined)).toEqual({});
  });
});

describe('countStatuses', () => {
  it('counts readings by status, and distinct passages by status', () => {
    const lectionary = new Lectionary([file]);
    const days = [
      lectionaryDay('2026-08-13', 'test-feast'),
      lectionaryDay('2026-08-14', 'test-feast'),
      lectionaryDay('2026-08-15', 'no-such-feast'),
    ];
    expect(countStatuses(days, lectionary)).toEqual({
      readings: { provisional: 4, verified: 2, disputed: 2 },
      passages: { provisional: 2, verified: 1, disputed: 1 },
    });
    expect(countStatuses([], lectionary, { epiphany: '2026-01-06' })).toEqual({
      readings: { provisional: 0, verified: 0, disputed: 0 },
      passages: { provisional: 0, verified: 0, disputed: 0 },
    });
  });
});

function day(date: string, celebrations: [string, string][], missing: boolean): CalendarDay {
  return {
    date,
    season: 'easter',
    seasonWeek: 4,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations: celebrations.map(([id, name]) => ({ id, name, rank: 'feast', colour: 'white' })),
    masses: missing
      ? []
      : [
          {
            id: 'day',
            label: 'Mass of the day',
            readings: [{ slot: 'gospel', ref: 'Jn 21:1-19', key: 'JN.21.1-19', linkout: 'https://example.org' }],
          },
        ],
    lectionaryMissing: missing,
  };
}

const MOTHER_OF_AFRICA: [string, string] = ['our-lady-mother-of-africa', 'Our Lady Mother of Africa'];

function calendar(days: CalendarDay[]): CalendarYear {
  return { year: 2026, region: 'kenya', generatedBy: 'test', days };
}

describe('KNOWN_GAPS', () => {
  it('allows only Our Lady Mother of Africa on 30 April, each gap with a reason', () => {
    expect(KNOWN_GAPS.map((gap) => [gap.monthDay, gap.celebrationId])).toEqual([
      ['04-30', 'our-lady-mother-of-africa'],
    ]);
    for (const gap of KNOWN_GAPS) {
      expect(gap.monthDay).toMatch(/^\d{2}-\d{2}$/);
      expect(gap.reason).toMatch(/Q5/);
    }
  });
});

describe('knownGapFor', () => {
  it('matches the date and the principal celebration, nothing else', () => {
    const gap = KNOWN_GAPS[0];
    expect(knownGapFor(day('2026-04-30', [MOTHER_OF_AFRICA], true), KNOWN_GAPS)).toBe(gap);
    expect(knownGapFor(day('2031-04-30', [MOTHER_OF_AFRICA], true), KNOWN_GAPS)).toBe(gap);
    expect(knownGapFor(day('2026-04-29', [MOTHER_OF_AFRICA], true), KNOWN_GAPS)).toBeUndefined();
    expect(knownGapFor(day('2026-04-30', [['other', 'Other']], true), KNOWN_GAPS)).toBeUndefined();
    expect(
      knownGapFor(day('2026-04-30', [['easter-time-4-sunday', 'Sunday'], MOTHER_OF_AFRICA], true), KNOWN_GAPS),
    ).toBeUndefined();
    expect(knownGapFor(day('2026-04-30', [], true), KNOWN_GAPS)).toBeUndefined();
  });
});

describe('yearReport', () => {
  const gaps: KnownGap[] = [
    { monthDay: '04-30', celebrationId: 'our-lady-mother-of-africa', reason: 'needs the Daily Missal' },
    { monthDay: '05-01', celebrationId: 'filled-feast', reason: 'was missing' },
  ];

  it('lists missing days, tells known gaps from unexpected ones, and notes filled gaps', () => {
    const report = yearReport(
      calendar([
        day('2026-04-29', [['some-feast', 'Some Feast']], true),
        day('2026-04-30', [MOTHER_OF_AFRICA], true),
        day('2026-05-01', [['filled-feast', 'Filled Feast']], false),
        day('2026-05-02', [], true),
      ]),
      gaps,
    );
    expect(report).toMatchObject({ year: 2026, region: 'kenya', days: 4, readings: 1 });
    expect(report.missing.map((d) => [d.date, d.gap?.celebrationId])).toEqual([
      ['2026-04-29', undefined],
      ['2026-04-30', 'our-lady-mother-of-africa'],
      ['2026-05-02', undefined],
    ]);
    expect(report.filled).toEqual([{ date: '2026-05-01', gap: gaps[1] }]);
    expect(unexpected(report).map((d) => d.date)).toEqual(['2026-04-29', '2026-05-02']);

    const lines = formatYear({
      ...report,
      stats: {
        readings: { provisional: 3, verified: 1, disputed: 0 },
        passages: { provisional: 2, verified: 1, disputed: 0 },
      },
    });
    expect(lines).toEqual([
      'calendar/2026.json (kenya): 4 days, 1 readings; 3 lectionaryMissing (1 known gap(s), 2 unexpected)',
      '  readings by status: 3 provisional, 1 verified, 0 disputed',
      '  distinct passages by status: 2 provisional, 1 verified, 0 disputed',
      '  MISSING 2026-04-29: some-feast (Some Feast)',
      '  known gap 2026-04-30: our-lady-mother-of-africa (Our Lady Mother of Africa): needs the Daily Missal',
      '  MISSING 2026-05-02: (no celebration)',
      '  note: 2026-05-01 filled-feast now has readings; remove its entry from KNOWN_GAPS (report/gaps.ts)',
    ]);
  });

  it('uses KNOWN_GAPS by default, and prints no status lines without stats', () => {
    const report = yearReport(calendar([day('2026-04-30', [MOTHER_OF_AFRICA], true)]));
    expect(unexpected(report)).toEqual([]);
    expect(formatYear(report)).toHaveLength(2);
  });
});

describe('formatTotals', () => {
  it('sums unexpected days, known gaps and reading statuses over the years', () => {
    const base: YearReport = yearReport(
      calendar([day('2026-04-29', [['x', 'X']], true), day('2026-04-30', [MOTHER_OF_AFRICA], true)]),
    );
    const withStats: YearReport = {
      ...base,
      stats: {
        readings: { provisional: 5, verified: 2, disputed: 1 },
        passages: { provisional: 1, verified: 1, disputed: 1 },
      },
    };
    expect(formatTotals([withStats, base])).toBe(
      'calendar:report: 2 unexpected missing day(s) in 2 year(s); 2 known gap(s) allowed; ' +
        'readings 5 provisional, 2 verified, 1 disputed',
    );
    expect(formatTotals([])).toBe(
      'calendar:report: 0 unexpected missing day(s) in 0 year(s); 0 known gap(s) allowed; ' +
        'readings 0 provisional, 0 verified, 0 disputed',
    );
  });
});
