/**
 * Calendars for the back-fill tests: a few days per year, references and link-outs only (no
 * reading text), served by an in-memory repository.
 */
import type { ContentRepo } from '@lectio/content';
import type { CalendarDay, CalendarYear } from '@lectio/schema/calendar';

/** A calendar day with one Mass whose readings are `[key, ref]` pairs. */
export function day(
  date: string,
  readings: readonly (readonly [string, string])[],
  lectionaryMissing = false,
): CalendarDay {
  return {
    date,
    season: 'ordinary-time',
    seasonWeek: 1,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations: [{ id: 'ot', name: 'Ordinary Time', rank: 'weekday', colour: 'green' }],
    masses: [
      {
        id: 'day',
        label: 'Mass of the day',
        readings: readings.map(([key, ref]) => ({ slot: 'gospel', ref, key, linkout: 'https://www.drbo.org/' })),
      },
    ],
    lectionaryMissing,
  } as unknown as CalendarDay;
}

export function year(value: number, days: readonly CalendarDay[]): CalendarYear {
  return { year: value, region: 'kenya', generatedBy: 'backfill test', days: [...days] } as unknown as CalendarYear;
}

/** An in-memory repository with these calendars and passage keys. */
export function memoryRepo(
  calendars: readonly CalendarYear[],
  keys: readonly string[] = [],
): Pick<ContentRepo, 'calendarYear' | 'passageKeys'> {
  return {
    calendarYear: (wanted) => calendars.find((calendar) => calendar.year === wanted) ?? null,
    passageKeys: () => [...keys],
  };
}

/**
 * 2026 and 2027 (no 2028): MK.1.1 is past-only, JN.1.1 is next on 2026-10-05 (and again in 2027),
 * LK.1.1 next on 2026-10-06, MT.1.1 is written, and one day has no lectionary data.
 */
export const CALENDARS: readonly CalendarYear[] = [
  year(2026, [
    day('2026-10-06', [
      ['LK.1.1', 'Lk 1:1'],
      ['JN.1.1', 'Jn 1:1'],
    ]),
    day('2026-01-10', [
      ['MK.1.1', 'Mk 1:1'],
      ['JN.1.1', 'John 1:1'],
      ['MK.1.1', 'Mk 1:1'],
    ]),
    day('2026-10-05', [
      ['JN.1.1', 'Jn 1:1 (next)'],
      ['MT.1.1', 'Mt 1:1'],
    ]),
    day('2026-10-07', [['XX.1.1', 'missing']], true),
  ]),
  year(2027, [day('2027-02-01', [['JN.1.1', 'Jn 1:1']])]),
];

/** The repository: the calendars above with MT.1.1 written. */
export const REPO = memoryRepo(CALENDARS, ['MT.1.1']);
