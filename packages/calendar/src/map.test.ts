import { describe, expect, it } from 'vitest';

import {
  mapCalendar,
  mapCelebration,
  mapColour,
  mapDay,
  mapProperCycle,
  mapRank,
  mapSeason,
  mapSundayCycle,
  mapWeekdayCycle,
  precedenceLevel,
  toCalendarDay,
} from './map.ts';
import type { DetailedDay, RomcalDayInput } from './map.ts';

function romcalDay(overrides: Partial<RomcalDayInput> = {}): RomcalDayInput {
  return {
    id: 'ordinary_time_25_monday',
    date: '2026-09-21',
    name: 'Monday of the twenty-fifth week of Ordinary Time',
    rank: 'WEEKDAY',
    precedence: 'WEEKDAY_13',
    colors: ['GREEN'],
    seasons: ['ORDINARY_TIME'],
    isOptional: false,
    isHolyDayOfObligation: false,
    calendar: { weekOfSeason: 25 },
    cycles: { properCycle: 'PROPER_OF_TIME', sundayCycle: 'YEAR_A', weekdayCycle: 'YEAR_2' },
    ...overrides,
  };
}

describe('enum mapping', () => {
  it('maps every romcal value Lectio knows', () => {
    expect(['WHITE', 'RED', 'GREEN', 'PURPLE', 'ROSE', 'BLACK', 'GOLD'].map(mapColour)).toEqual([
      'white',
      'red',
      'green',
      'violet',
      'rose',
      'black',
      'gold',
    ]);
    expect(
      ['ADVENT', 'CHRISTMAS_TIME', 'ORDINARY_TIME', 'LENT', 'PASCHAL_TRIDUUM', 'EASTER_TIME'].map(mapSeason),
    ).toEqual(['advent', 'christmas', 'ordinary-time', 'lent', 'paschal-triduum', 'easter']);
    expect(['SOLEMNITY', 'SUNDAY', 'FEAST', 'MEMORIAL', 'OPTIONAL_MEMORIAL', 'WEEKDAY'].map(mapRank)).toEqual([
      'solemnity',
      'sunday',
      'feast',
      'memorial',
      'optional-memorial',
      'weekday',
    ]);
    expect(['YEAR_A', 'YEAR_B', 'YEAR_C'].map(mapSundayCycle)).toEqual(['A', 'B', 'C']);
    expect(['YEAR_1', 'YEAR_2'].map(mapWeekdayCycle)).toEqual(['I', 'II']);
    expect(['PROPER_OF_TIME', 'PROPER_OF_SAINTS'].map(mapProperCycle)).toEqual(['proper-of-time', 'proper-of-saints']);
  });

  it('throws on values a future romcal might add', () => {
    expect(() => mapColour('BLUE')).toThrow('Unknown romcal colour: "BLUE"');
    expect(() => mapSeason('SEPTUAGESIMA')).toThrow(/season/);
    expect(() => mapRank('TRIDUUM')).toThrow(/rank/);
    expect(() => mapSundayCycle('YEAR_D')).toThrow(/Sunday cycle/);
    expect(() => mapWeekdayCycle('YEAR_3')).toThrow(/weekday cycle/);
    expect(() => mapProperCycle('toString')).toThrow(/proper cycle/);
  });
});

describe('precedenceLevel', () => {
  it('reads the level from the precedence suffix', () => {
    expect(precedenceLevel('TRIDUUM_1')).toBe(1);
    expect(precedenceLevel('PROPER_SOLEMNITY__PRINCIPAL_PATRON_4A')).toBe(4);
    expect(precedenceLevel('PROPER_FEAST_8F')).toBe(8);
    expect(precedenceLevel('WEEKDAY_13')).toBe(13);
    expect(precedenceLevel('UNPRIVILEGED_SUNDAY_6')).toBeLessThan(precedenceLevel('GENERAL_FEAST_7'));
  });

  it('throws on a precedence without a level', () => {
    expect(() => precedenceLevel('SOMETHING')).toThrow(/precedence/);
  });
});

describe('mapCelebration', () => {
  it('keeps a feast with its weekday, all colours and flags', () => {
    const celebration = mapCelebration(
      romcalDay({
        id: 'matthew_apostle',
        name: 'Saint Matthew, Apostle and Evangelist',
        rank: 'FEAST',
        precedence: 'GENERAL_FEAST_7',
        colors: ['RED'],
        cycles: { properCycle: 'PROPER_OF_SAINTS', sundayCycle: 'YEAR_A', weekdayCycle: 'YEAR_2' },
        weekday: { id: 'ordinary_time_25_monday', colors: ['GREEN'] },
      }),
      'ordinary-time',
    );
    expect(celebration).toEqual({
      id: 'matthew-apostle',
      name: 'Saint Matthew, Apostle and Evangelist',
      rank: 'feast',
      colour: 'red',
      romcalId: 'matthew_apostle',
      colours: ['red'],
      precedence: 'GENERAL_FEAST_7',
      optional: false,
      holyDayOfObligation: false,
      properCycle: 'proper-of-saints',
      weekdayId: 'ordinary-time-25-monday',
    });
  });

  it('capitalises and trims names, keeps every colour', () => {
    const celebration = mapCelebration(
      romcalDay({ name: ' fourth Sunday of Lent ', rank: 'SUNDAY', colors: ['ROSE', 'PURPLE'] }),
      'lent',
    );
    expect(celebration.name).toBe('Fourth Sunday of Lent');
    expect(celebration.colour).toBe('rose');
    expect(celebration.colours).toEqual(['rose', 'violet']);
    expect(celebration).not.toHaveProperty('weekdayId');
  });

  it('turns an impeded memorial without colour into a commemoration in the weekday colour', () => {
    const celebration = mapCelebration(
      romcalDay({
        id: 'casimir_of_poland',
        name: 'Saint Casimir',
        rank: 'OPTIONAL_MEMORIAL',
        colors: [],
        isOptional: true,
        weekday: { id: 'lent_2_wednesday', colors: ['PURPLE'] },
      }),
      'lent',
    );
    expect(celebration).toMatchObject({ rank: 'commemoration', colour: 'violet', optional: true });
  });

  it('falls back to the season colour when neither the day nor its weekday has one', () => {
    expect(mapCelebration(romcalDay({ colors: [] }), 'paschal-triduum')).toMatchObject({
      rank: 'weekday',
      colour: 'white',
    });
    expect(
      mapCelebration(romcalDay({ colors: [], weekday: { id: 'advent_4_monday', colors: [] } }), 'advent'),
    ).toMatchObject({ rank: 'commemoration', colour: 'violet' });
    for (const [season, colour] of [
      ['christmas', 'white'],
      ['ordinary-time', 'green'],
      ['lent', 'violet'],
      ['easter', 'white'],
    ] as const) {
      expect(mapCelebration(romcalDay({ colors: [] }), season).colour).toBe(colour);
    }
  });
});

describe('mapDay', () => {
  it('puts optional memorials after the celebration of the day', () => {
    const optional = romcalDay({
      id: 'januarius_bishop',
      rank: 'OPTIONAL_MEMORIAL',
      colors: ['RED'],
      isOptional: true,
    });
    const day = mapDay('2026-09-21', [optional, romcalDay()]);
    expect(day.celebrations.map((c) => c.id)).toEqual(['ordinary-time-25-monday', 'januarius-bishop']);
    expect(day).toMatchObject({
      date: '2026-09-21',
      season: 'ordinary-time',
      seasonWeek: 25,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      masses: [],
      lectionaryMissing: true,
    });
  });

  it('files a day spanning two seasons under the later one', () => {
    const easter = romcalDay({ seasons: ['PASCHAL_TRIDUUM', 'EASTER_TIME'], calendar: { weekOfSeason: 1 } });
    expect(mapDay('2026-04-05', [easter])).toMatchObject({ season: 'easter', seasonWeek: 1 });
  });

  it('gives the Triduum week 0', () => {
    const friday = romcalDay({ seasons: ['PASCHAL_TRIDUUM'], calendar: { weekOfSeason: 1 } });
    expect(mapDay('2026-04-03', [friday])).toMatchObject({ season: 'paschal-triduum', seasonWeek: 0 });
  });

  it('throws on an empty day or a day without season', () => {
    expect(() => mapDay('2026-01-01', [])).toThrow('romcal returned no celebration for 2026-01-01');
    expect(() => mapDay('2026-01-01', [romcalDay({ seasons: [] })])).toThrow(/has no season/);
  });
});

describe('mapCalendar', () => {
  it('sorts by date', () => {
    const days = mapCalendar({ '2026-09-22': [romcalDay()], '2026-09-21': [romcalDay()] });
    expect(days.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-22']);
  });
});

describe('toCalendarDay', () => {
  it('drops detail fields and copies masses', () => {
    const detailed: DetailedDay = {
      ...mapDay('2026-09-21', [romcalDay()]),
      masses: [
        {
          id: 'day',
          label: 'Mass of the day',
          readings: [{ slot: 'gospel', ref: 'Mt 9:9-13', key: 'MT.9.9-13', linkout: 'https://example.org/mt9' }],
        },
      ],
      lectionaryMissing: false,
    };
    const day = toCalendarDay(detailed);
    expect(day.celebrations).toEqual([
      { id: 'ordinary-time-25-monday', name: detailed.celebrations[0]?.name, rank: 'weekday', colour: 'green' },
    ]);
    expect(day.masses).toEqual(detailed.masses);
    expect(day.masses).not.toBe(detailed.masses);
    expect(day.lectionaryMissing).toBe(false);
  });
});
