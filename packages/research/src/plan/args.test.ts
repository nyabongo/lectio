import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { PLAN_USAGE, UsageError, parsePlanArgs } from './args.ts';

// 22:30 UTC on 30 September is already 1 October in Nairobi (UTC+3).
const options = {
  config: { ...DEFAULT_CONFIG, site: { ...DEFAULT_CONFIG.site, timezone: 'Africa/Nairobi' } },
  now: new Date('2026-09-30T22:30:00Z'),
};

describe('parsePlanArgs', () => {
  it('defaults --from to today in the site time zone and --days to research.defaultDays', () => {
    expect(parsePlanArgs([], options)).toEqual({ from: '2026-10-01', days: DEFAULT_CONFIG.research.defaultDays });
  });

  it('reads every flag, in both --flag value and --flag=value forms', () => {
    expect(parsePlanArgs(['--from', '2026-11-01', '--days=7', '--only', 'MT.20.1-16', '--max=3'], options)).toEqual({
      from: '2026-11-01',
      days: 7,
      only: 'MT.20.1-16',
      max: 3,
    });
  });

  it.each([
    [['--from', '2026-13-01'], /--from must be a date/],
    [['--days', '0'], /--days must be a positive integer, got "0"/],
    [['--days', '1.5'], /--days must be a positive integer/],
    [['--max', 'two'], /--max must be a positive integer/],
    [['--only', 'Matthew 20'], /--only must be a passage key/],
    [['--unknown'], /Unknown option/],
    [['extra'], /positional/],
    [['--days'], /argument missing/],
  ])('rejects %j', (argv, message) => {
    expect(() => parsePlanArgs(argv, options)).toThrow(message);
    expect(() => parsePlanArgs(argv, options)).toThrow(UsageError);
  });

  it('appends the usage line to parser errors', () => {
    expect(() => parsePlanArgs(['--nope'], options)).toThrow(PLAN_USAGE);
    try {
      parsePlanArgs(['--nope'], options);
    } catch (error) {
      expect((error as Error).name).toBe('UsageError');
    }
  });
});
