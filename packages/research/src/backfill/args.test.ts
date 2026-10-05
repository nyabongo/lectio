import { describe, expect, it } from 'vitest';

import { UsageError } from '../plan/args.ts';
import { BACKFILL_USAGE, DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, parseBackfillArgs } from './args.ts';

describe('parseBackfillArgs', () => {
  it('defaults to an estimate of 2026–2028', () => {
    expect(parseBackfillArgs([])).toEqual({ fromYear: DEFAULT_FROM_YEAR, toYear: DEFAULT_TO_YEAR, execute: false });
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
    [['--from-year', '2028', '--to-year', '2026'], '--to-year 2026 is before --from-year 2028'],
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
