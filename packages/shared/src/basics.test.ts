import { describe, expect, it } from 'vitest';

import {
  addDays,
  assertNever,
  dateRange,
  err,
  isErr,
  isIsoDate,
  isOk,
  mapResult,
  ok,
  packageName,
  toIsoDateInZone,
  unwrap,
} from './index.ts';
import type { Result } from './index.ts';

describe('@lectio/shared', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/shared');
  });
});

describe('assertNever', () => {
  type Shape = { kind: 'circle' } | { kind: 'square' };
  const area = (shape: Shape): string => {
    switch (shape.kind) {
      case 'circle':
        return 'round';
      case 'square':
        return 'square';
      default:
        return assertNever(shape);
    }
  };

  it('is unreachable for handled cases', () => {
    expect(area({ kind: 'circle' })).toBe('round');
    expect(area({ kind: 'square' })).toBe('square');
  });

  it('throws on a value that slipped through', () => {
    expect(() => area({ kind: 'hexagon' } as unknown as Shape)).toThrow('Unexpected value: {"kind":"hexagon"}');
  });

  it('accepts a custom message', () => {
    expect(() => assertNever('x' as never, 'no such slot')).toThrow('no such slot');
  });
});

describe('Result', () => {
  const good = ok(2) as Result<number, string>;
  const bad = err('nope') as Result<number, string>;

  it('narrows with isOk / isErr', () => {
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it('unwraps values and throws errors', () => {
    expect(unwrap(good)).toBe(2);
    expect(() => unwrap(bad)).toThrow('nope');
    const failure = new TypeError('typed');
    expect(() => unwrap(err(failure))).toThrow(failure);
  });

  it('maps only Ok values', () => {
    expect(mapResult(good, (n) => n * 10)).toEqual({ ok: true, value: 20 });
    expect(mapResult(bad, (n) => n * 10)).toBe(bad);
  });
});

describe('ISO dates', () => {
  it.each([
    ['2026-09-20', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-09-31', false],
    ['2026-9-20', false],
    ['20260920', false],
    ['2026-09-20T00:00:00Z', false],
    [20260920, false],
    [null, false],
  ])('isIsoDate(%j) is %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-09-20', 1)).toBe('2026-09-21');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-20', 0)).toBe('2026-09-20');
  });

  it('rejects invalid input', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2026-09-20', 1.5)).toThrow('days must be an integer');
  });

  it('lists an inclusive range', () => {
    expect(dateRange('2026-09-19', '2026-09-21')).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
    expect(dateRange('2026-09-20', '2026-09-20')).toEqual(['2026-09-20']);
    expect(dateRange('2026-09-21', '2026-09-20')).toEqual([]);
    expect(dateRange('2026-12-30', '2027-01-02')).toHaveLength(4);
    expect(() => dateRange('2026-09-20', 'tomorrow')).toThrow(RangeError);
  });

  it('converts an instant to the calendar date in a timezone', () => {
    // 22:30 UTC on 19 Sep is already 20 Sep in Nairobi (UTC+3).
    const instant = new Date('2026-09-19T22:30:00Z');
    expect(toIsoDateInZone(instant, 'Africa/Nairobi')).toBe('2026-09-20');
    expect(toIsoDateInZone(instant, 'UTC')).toBe('2026-09-19');
    expect(toIsoDateInZone(instant, 'America/Los_Angeles')).toBe('2026-09-19');
  });

  it('rejects invalid instants and zones', () => {
    expect(() => toIsoDateInZone(new Date('nope'), 'UTC')).toThrow('Invalid Date');
    expect(() => toIsoDateInZone(new Date(), 'Mars/Olympus')).toThrow(RangeError);
  });
});
