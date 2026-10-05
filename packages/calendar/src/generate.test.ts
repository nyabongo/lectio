import { validateCalendarYear } from '@lectio/schema/calendar';
import type { CalendarDay } from '@lectio/schema/calendar';
import { describe, expect, it } from 'vitest';

import { generateDays, generateDetailedDays, romcalVersion } from './generate.ts';
import * as calendar from './index.ts';

const days2026 = await generateDays(2026);
const byDate = new Map(days2026.map((day) => [day.date, day]));

function day(date: string): CalendarDay {
  const found = byDate.get(date);
  if (!found) throw new Error(`no day ${date}`);
  return found;
}

describe('generateDays: acceptance dates (2026, General Roman Calendar)', () => {
  it('2026-09-20 is the 25th Sunday in Ordinary Time, green, Year A', () => {
    expect(day('2026-09-20')).toMatchObject({
      season: 'ordinary-time',
      seasonWeek: 25,
      sundayCycle: 'A',
      celebrations: [
        {
          id: 'ordinary-time-25-sunday',
          name: 'Twenty-fifth Sunday in Ordinary Time',
          rank: 'sunday',
          colour: 'green',
        },
      ],
    });
  });

  it('2026-09-21 is St Matthew, feast, red, weekday cycle II', () => {
    expect(day('2026-09-21')).toMatchObject({
      weekdayCycle: 'II',
      celebrations: [
        { id: 'matthew-apostle', name: 'Saint Matthew, Apostle and Evangelist', rank: 'feast', colour: 'red' },
      ],
    });
  });

  it('2026-04-05 is Easter Sunday', () => {
    expect(day('2026-04-05')).toMatchObject({
      season: 'easter',
      seasonWeek: 1,
      celebrations: [{ id: 'easter-sunday', rank: 'solemnity', colour: 'white' }],
    });
  });

  it('2026-11-29 is the 1st Sunday of Advent, Year B', () => {
    expect(day('2026-11-29')).toMatchObject({
      season: 'advent',
      seasonWeek: 1,
      sundayCycle: 'B',
      weekdayCycle: 'I',
      celebrations: [{ id: 'advent-1-sunday', name: 'First Sunday of Advent', rank: 'sunday', colour: 'violet' }],
    });
  });
});

describe('generateDays: the whole year', () => {
  it('covers 1 January to 31 December, one entry per date', () => {
    expect(days2026).toHaveLength(365);
    expect(days2026[0]?.date).toBe('2026-01-01');
    expect(days2026.at(-1)?.date).toBe('2026-12-31');
    expect(new Set(days2026.map((d) => d.date)).size).toBe(365);
  });

  it('matches the calendar year schema, readings left for L-016', () => {
    const file = {
      year: 2026,
      region: 'general-roman',
      generatedBy: `test (romcal ${romcalVersion()})`,
      days: days2026,
    };
    expect(validateCalendarYear(file), JSON.stringify(validateCalendarYear.errors)).toBe(true);
    expect(days2026.every((d) => d.masses.length === 0 && d.lectionaryMissing)).toBe(true);
  });

  it('keeps optional memorials as options after the weekday', () => {
    expect(day('2026-01-03').celebrations).toEqual([
      expect.objectContaining({ id: 'christmas-time-january-3', rank: 'weekday' }),
      expect.objectContaining({ id: 'most-holy-name-of-jesus', rank: 'optional-memorial' }),
    ]);
  });

  it('marks impeded memorials in Lent as commemorations in violet', () => {
    expect(day('2026-03-07').celebrations[1]).toMatchObject({
      id: 'perpetua-of-carthage-and-felicity-of-carthage-martyrs',
      rank: 'commemoration',
      colour: 'violet',
    });
  });

  it('handles the Triduum and Ash Wednesday', () => {
    expect(day('2026-02-18')).toMatchObject({ season: 'lent', seasonWeek: 0 });
    expect(day('2026-04-03')).toMatchObject({
      season: 'paschal-triduum',
      seasonWeek: 0,
      celebrations: [{ id: 'friday-of-the-passion-of-the-lord', colour: 'red' }],
    });
    expect(day('2026-04-04')).toMatchObject({ celebrations: [{ id: 'holy-saturday', colour: 'white' }] });
  });

  it('includes a leap day in leap years', async () => {
    const days = await generateDays(2028);
    expect(days).toHaveLength(366);
    expect(days.some((d) => d.date === '2028-02-29')).toBe(true);
  });

  it('is deterministic', async () => {
    expect(await generateDays(2026)).toEqual(days2026);
  });

  it.each([1970, 2027, 2038, 9999])('produces a schema-valid year for %i', async (year) => {
    const file = { year, region: 'general-roman', generatedBy: 'test', days: await generateDays(year) };
    expect(validateCalendarYear(file), JSON.stringify(validateCalendarYear.errors)).toBe(true);
  });
});

describe('generateDetailedDays', () => {
  it('keeps romcal ids, precedence, colours and the weekday under a feast', async () => {
    const days = await generateDetailedDays(2026);
    const matthew = days.find((d) => d.date === '2026-09-21')?.celebrations[0];
    expect(matthew).toMatchObject({
      romcalId: 'matthew_apostle',
      precedence: 'GENERAL_FEAST_7',
      properCycle: 'proper-of-saints',
      weekdayId: 'ordinary-time-25-monday',
      optional: false,
    });
    const allSouls = days.find((d) => d.date === '2026-11-02')?.celebrations[0];
    expect(allSouls).toMatchObject({ colour: 'violet', colours: ['violet', 'black'] });
    const assumption = days.find((d) => d.date === '2026-08-15')?.celebrations[0];
    expect(assumption?.holyDayOfObligation).toBe(true);
  });
});

describe('romcal options', () => {
  const dateOf = (days: CalendarDay[], id: string) => days.find((d) => d.celebrations.some((c) => c.id === id))?.date;

  it('defaults to the General Roman Calendar dates', () => {
    expect(dateOf(days2026, 'epiphany-of-the-lord')).toBe('2026-01-06');
    expect(dateOf(days2026, 'ascension-of-the-lord')).toBe('2026-05-14');
    expect(dateOf(days2026, 'most-holy-body-and-blood-of-christ')).toBe('2026-06-04');
  });

  it('moves Epiphany, Ascension and Corpus Christi to Sunday when asked', async () => {
    const days = await generateDays(2026, {
      epiphanyOnSunday: true,
      ascensionOnSunday: true,
      corpusChristiOnSunday: true,
    });
    expect(dateOf(days, 'epiphany-of-the-lord')).toBe('2026-01-04');
    expect(dateOf(days, 'ascension-of-the-lord')).toBe('2026-05-17');
    expect(dateOf(days, 'most-holy-body-and-blood-of-christ')).toBe('2026-06-07');
  });

  it('keeps the weekday dates when options are explicitly false', async () => {
    const days = await generateDays(2026, {
      epiphanyOnSunday: false,
      ascensionOnSunday: false,
      corpusChristiOnSunday: false,
    });
    expect(days).toEqual(days2026);
  });
});

describe('arguments and exports', () => {
  it.each([1969, 10000, 2026.5, Number.NaN])('rejects year %s', async (year) => {
    await expect(generateDays(year)).rejects.toThrow(RangeError);
  });

  it('reports the romcal version', () => {
    expect(romcalVersion()).toBe('3.0.0-dev.140');
  });

  it('exports the public API from the package entry point', () => {
    expect(calendar.packageName).toBe('@lectio/calendar');
    expect(calendar.generateDays).toBe(generateDays);
    expect(calendar.MIN_YEAR).toBe(1970);
    expect(calendar.MAX_YEAR).toBe(9999);
    expect(typeof calendar.toLectioId).toBe('function');
    expect(typeof calendar.precedenceLevel).toBe('function');
  });
});
