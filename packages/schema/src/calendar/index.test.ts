import { describe, expect, expectTypeOf, it } from 'vitest';

import { loadFixture, loadFixtures } from '../../fixtures/load.ts';
import { formatErrors } from '../common/index.ts';
import type { ReadingSlot } from '../common/index.ts';
import { validateCalendarYear } from './index.ts';
import type { CalendarYear, Reading } from './index.ts';

const EXPECTED_FAILURES: Record<string, [instancePath: string, keyword: string]> = {
  'bad-passage-key': ['/days/1/masses/0/readings/3/key', 'pattern'],
  'bad-weekday-cycle': ['/days/1/weekdayCycle', 'enum'],
  'fractional-year': ['/year', 'type'],
  'impossible-date': ['/days/1/date', 'format'],
  'linkout-not-http': ['/days/1/masses/0/readings/3/linkout', 'pattern'],
  'names-without-sw': ['/days/1/celebrations/0/names', 'required'],
  'no-celebrations': ['/days/1/celebrations', 'minItems'],
  'no-masses-without-missing-flag': ['/days/2/masses', 'minItems'],
  'reading-with-text': ['/days/1/masses/0/readings/3', 'additionalProperties'],
  'unknown-name-status': ['/days/1/celebrations/0/names/swStatus', 'enum'],
  'unknown-colour': ['/days/1/celebrations/0/colour', 'enum'],
  'unknown-slot': ['/days/1/masses/0/readings/0/slot', 'enum'],
};

describe('calendar-year fixtures', () => {
  const valid = loadFixtures('calendar', 'valid');
  const invalid = loadFixtures('calendar', 'invalid');

  it.each([...valid])('valid/%s passes', (_name, data) => {
    const ok = validateCalendarYear(data);
    expect(formatErrors(ok ? [] : validateCalendarYear.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it.each([...invalid])('invalid/%s fails for the expected reason', (name, data) => {
    expect(validateCalendarYear(data)).toBe(false);
    const errors = (validateCalendarYear.errors ?? []).map((error) => [error.instancePath, error.keyword]);
    expect(errors).toContainEqual(EXPECTED_FAILURES[name]);
  });

  it('has an expectation for every invalid fixture and a fixture for every expectation', () => {
    expect([...invalid.keys()].sort()).toEqual(Object.keys(EXPECTED_FAILURES).sort());
  });
});

describe('calendar-year rules', () => {
  const year = loadFixture('calendar', 'valid', 'year-2026') as CalendarYear;

  it('allows a day without Masses when the lectionary data is missing', () => {
    const missing = year.days.find((day) => day.lectionaryMissing);
    expect(missing?.masses).toEqual([]);
    expect(validateCalendarYear(year)).toBe(true);
  });

  describe('a day without any Mass (noMass)', () => {
    const base = year.days.find((day) => !day.lectionaryMissing) as CalendarYear['days'][number];
    const withDay = (day: object): CalendarYear => ({ ...year, days: [{ ...base, ...day }] });
    const errors = (): [string, string][] =>
      (validateCalendarYear.errors ?? []).map((error) => [error.instancePath, error.keyword]);

    it('accepts an empty masses list when the data is not missing', () => {
      expect(validateCalendarYear(withDay({ masses: [], lectionaryMissing: false, noMass: true }))).toBe(true);
    });

    it('still needs a Mass when noMass is false or absent', () => {
      expect(validateCalendarYear(withDay({ masses: [], lectionaryMissing: false, noMass: false }))).toBe(false);
      expect(errors()).toContainEqual(['/days/0/masses', 'minItems']);
      expect(validateCalendarYear(withDay({ masses: [], lectionaryMissing: false }))).toBe(false);
    });

    it('rejects Masses on a day without any Mass', () => {
      expect(validateCalendarYear(withDay({ noMass: true }))).toBe(false);
      expect(errors()).toContainEqual(['/days/0/masses', 'maxItems']);
    });

    it('rejects lectionaryMissing on a day without any Mass', () => {
      expect(validateCalendarYear(withDay({ masses: [], lectionaryMissing: true, noMass: true }))).toBe(false);
      expect(errors()).toContainEqual(['/days/0/lectionaryMissing', 'const']);
    });

    it('rejects a noMass that is not a boolean', () => {
      expect(validateCalendarYear(withDay({ noMass: 'yes' }))).toBe(false);
      expect(errors()).toContainEqual(['/days/0/noMass', 'type']);
    });
  });

  it('uses the Easter Vigil numbered slots', () => {
    const slots = year.days[0]?.masses[0]?.readings.map((reading) => reading.slot);
    expect(slots).toEqual(['reading-1', 'psalm-1', 'epistle', 'gospel']);
  });

  it('rejects unknown top-level fields', () => {
    expect(validateCalendarYear({ ...year, readings: [] })).toBe(false);
  });

  it('derives types from the schema', () => {
    expectTypeOf<Reading['slot']>().toEqualTypeOf<ReadingSlot>();
    expectTypeOf<CalendarYear['days'][number]['sundayCycle']>().toEqualTypeOf<'A' | 'B' | 'C'>();
  });
});
