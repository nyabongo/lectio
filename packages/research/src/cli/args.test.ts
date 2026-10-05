import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { UsageError } from '../plan/args.ts';
import { COMMON_USAGE, FIXUP_USAGE, USAGE, parseCommand } from './args.ts';

const options = { config: DEFAULT_CONFIG, now: new Date('2026-10-05T07:50:00Z') };
const parse = (...argv: string[]): ReturnType<typeof parseCommand> => parseCommand(argv, options);
const live = { provider: 'live', dryRun: false, dryRunForced: false };

describe('parseCommand', () => {
  it('reads help in its three spellings', () => {
    for (const word of ['help', '--help', '-h']) expect(parse(word)).toEqual({ kind: 'help' });
  });

  it('runs by default, live, with the planner defaults', () => {
    expect(parse()).toEqual({ kind: 'run', window: { from: '2026-10-05', days: 14 }, common: live });
    expect(parse('--from', '2026-10-01', '--days', '7', '--only', 'MT.20.1-16', '--max', '3')).toEqual({
      kind: 'run',
      window: { from: '2026-10-01', days: 7, only: 'MT.20.1-16', max: 3 },
      common: live,
    });
  });

  it('reads plan and run explicitly, with the common flags', () => {
    expect(parse('plan', '--budget', '12.50', '--dry-run')).toEqual({
      kind: 'plan',
      window: { from: '2026-10-05', days: 14 },
      common: { provider: 'live', dryRun: true, dryRunForced: false, budgetUsd: 12.5 },
    });
    expect(parse('run', '--provider', 'fake')).toMatchObject({
      kind: 'run',
      common: { provider: 'fake', dryRun: true, dryRunForced: true },
    });
    expect(parse('run', '--provider', 'fake', '--dry-run')).toMatchObject({
      common: { dryRun: true, dryRunForced: false },
    });
  });

  it('reads fixup', () => {
    expect(parse('fixup', '--pr', '42')).toEqual({ kind: 'fixup', pr: 42, force: false, common: live });
    expect(parse('fixup', '--pr', '7', '--force', '--report', 'out/gates.json', '--budget', '3')).toEqual({
      kind: 'fixup',
      pr: 7,
      force: true,
      report: 'out/gates.json',
      common: { ...live, budgetUsd: 3 },
    });
  });

  it('refuses a fixup without a valid --pr', () => {
    expect(() => parse('fixup')).toThrow(`--pr is required\n${FIXUP_USAGE}`);
    expect(() => parse('fixup', '--pr', '0')).toThrow('--pr must be a positive integer, got "0"');
  });

  it('passes translate flags through and keeps the common ones', () => {
    expect(
      parse('translate', '--locale', 'sw', '--provider', 'fake', '--budget=4', '--days', '3', '--include-pending'),
    ).toEqual({
      kind: 'translate',
      argv: ['--locale', 'sw', '--days', '3', '--include-pending'],
      common: { provider: 'fake', dryRun: true, dryRunForced: true, budgetUsd: 4 },
    });
    expect(parse('translate', '--provider=live', '--dry-run', '--locale', 'sw')).toEqual({
      kind: 'translate',
      argv: ['--locale', 'sw'],
      common: { provider: 'live', dryRun: true, dryRunForced: false },
    });
  });

  it('reports a common flag left without its value in a translate command line', () => {
    expect(() => parse('translate', '--locale', 'sw', '--budget')).toThrow(UsageError);
  });

  it('refuses bad values and unknown flags with the usage', () => {
    expect(() => parse('--provider', 'openai')).toThrow('--provider must be live or fake, got "openai"');
    expect(() => parse('--budget=-1')).toThrow('--budget must be an amount in USD');
    expect(() => parse('--budget', '1.234')).toThrow('--budget must be an amount in USD');
    expect(() => parse('--bogus')).toThrow(COMMON_USAGE);
    expect(() => parse('fixup', '--pr', '1', 'extra')).toThrow(FIXUP_USAGE);
    expect(() => parse('--days', 'x')).toThrow('--days must be a positive integer');
  });

  it('lists every subcommand in the usage', () => {
    for (const word of ['research [run]', 'research plan', 'research fixup', 'research translate', '--budget']) {
      expect(USAGE).toContain(word);
    }
  });
});
