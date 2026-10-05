import { describe, expect, it } from 'vitest';

import { PROPER_OF_TIME_KEY, SLUG, compareKeys, isSundayKey, properOfTimeKey, weekdayOf } from './keys.ts';

describe('proper-of-time keys', () => {
  it('names Sundays and weekdays by season, week and day', () => {
    expect(properOfTimeKey('2026-09-20', 'ordinary-time', 25)).toBe('ot-sunday-25');
    expect(properOfTimeKey('2026-09-22', 'ordinary-time', 25)).toBe('ot-weekday-25-tue');
    expect(properOfTimeKey('2026-02-18', 'lent', 0)).toBe('lent-weekday-0-wed');
    expect(properOfTimeKey('2026-04-03', 'paschal-triduum', 0)).toBe('triduum-weekday-0-fri');
  });

  it('gives the weekday of a date and rejects invalid dates', () => {
    expect(weekdayOf('2026-09-19')).toBe('sat');
    expect(() => weekdayOf('2026-02-30')).toThrow(RangeError);
  });

  it('validates keys', () => {
    for (const key of ['ot-sunday-25', 'ot-weekday-25-tue', 'advent-weekday-0-sat', 'easter-sunday-7']) {
      expect(PROPER_OF_TIME_KEY.test(key)).toBe(true);
    }
    for (const key of ['ot-sunday-025', 'ot-weekday-25-sun', 'xmas-sunday-1', 'ot-25', 'ot-weekday-25']) {
      expect(PROPER_OF_TIME_KEY.test(key)).toBe(false);
    }
    expect(SLUG.test('matthew-apostle')).toBe(true);
    expect(SLUG.test('Matthew')).toBe(false);
    expect(isSundayKey('ot-sunday-25')).toBe(true);
    expect(isSundayKey('ot-weekday-25-mon')).toBe(false);
  });

  it('orders keys liturgically, other keys after them', () => {
    const keys = [
      'matthew-apostle',
      'ot-weekday-25-mon',
      'ot-sunday-25',
      'ot-weekday-24-sat',
      'advent-sunday-1',
      'ot-weekday-24-fri',
      'apostles',
      'ot-weekday-3-mon',
      'ot-sunday-25',
    ];
    expect([...keys].sort(compareKeys)).toEqual([
      'advent-sunday-1',
      'ot-weekday-3-mon',
      'ot-weekday-24-fri',
      'ot-weekday-24-sat',
      'ot-sunday-25',
      'ot-sunday-25',
      'ot-weekday-25-mon',
      'apostles',
      'matthew-apostle',
    ]);
  });
});
