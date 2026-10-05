import { describe, expect, it } from 'vitest';

import { UsageError } from '../plan/args.ts';
import { BACKFILL_USAGE, DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, parseBackfillArgs, resolveYears } from './args.ts';

describe('parseBackfillArgs', () => {
  it('defaults to an estimate of 2026–2028', () => {
    expect(parseBackfillArgs([])).toEqual({ execute: false });
    expect([DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR]).toEqual([2026, 2028]);
    expect(BACKFILL_USAGE.startsWith('research backfill')).toBe(true);
  });

  it('reads every flag', () => {
    expect(
      parseBackfillArgs([
        '--from-year',
        '2027',
        '--to-year',
        '2027',
        '--per-passage',
        '1.2345',
        '--max',
        '3',
        '--execute',
      ]),
    ).toEqual({ fromYear: 2027, toYear: 2027, perPassageUsd: 1.2345, max: 3, execute: true });
    expect(parseBackfillArgs(['--per-passage', '0'])).toMatchObject({ perPassageUsd: 0 });
  });

  it.each([
    [['--from-year', '26'], '--from-year must be a year'],
    [['--to-year', 'next'], '--to-year must be a year'],
    [['--per-passage=-1'], '--per-passage must be an amount'],
    [['--per-passage', '1.23456'], '--per-passage must be an amount'],
    [['--max', '0'], '--max must be a positive integer'],
    [['--bogus'], "Unknown option '--bogus'"],
    [['extra'], 'research backfill'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseBackfillArgs(argv)).toThrow(UsageError);
    expect(() => parseBackfillArgs(argv)).toThrow(message);
  });
});

describe('resolveYears', () => {
  const committed = [2026, 2027, 2028];

  it('keeps the defaults, and takes years within the committed calendars', () => {
    expect(resolveYears({}, committed)).toEqual({ fromYear: DEFAULT_FROM_YEAR, toYear: DEFAULT_TO_YEAR });
    expect(resolveYears({}, [2026])).toEqual({ fromYear: 2026, toYear: 2028 });
    expect(resolveYears({ fromYear: 2027 }, committed)).toEqual({ fromYear: 2027, toYear: 2028 });
    expect(resolveYears({ fromYear: 2026, toYear: 2026 }, committed)).toEqual({ fromYear: 2026, toYear: 2026 });
  });

  it.each([
    [{ toYear: 9999 }, committed, '--to-year 9999 has no calendar (committed calendar years: 2026–2028)'],
    [{ fromYear: 2025 }, committed, '--from-year 2025 has no calendar'],
    [{ fromYear: 2026 }, [], '--from-year 2026 has no calendar (committed calendar years: none)'],
    [{ fromYear: 2028, toYear: 2026 }, committed, '--to-year 2026 is before --from-year 2028'],
  ])('rejects %j with calendars %j', (args, years, message) => {
    expect(() => resolveYears(args, years)).toThrow(UsageError);
    expect(() => resolveYears(args, years)).toThrow(message);
  });
});
