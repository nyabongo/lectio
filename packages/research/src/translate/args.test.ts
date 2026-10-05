import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';

import { UsageError } from '../plan/args.ts';
import { TRANSLATE_USAGE, parseTranslateArgs } from './args.ts';

const options = { config: DEFAULT_CONFIG, now: new Date('2026-10-05T07:50:00Z') };

describe('parseTranslateArgs', () => {
  it('reads the locale and the window, with research defaults', () => {
    expect(parseTranslateArgs(['--locale', 'sw'], options)).toEqual({
      locale: 'sw',
      includePending: false,
      from: '2026-10-05',
      days: DEFAULT_CONFIG.research.defaultDays,
    });
  });

  it('reads every flag', () => {
    const argv = ['--locale=sw', '--from', '2026-09-20', '--days', '7', '--only', 'MT.20.1-16', '--max', '2'];
    expect(parseTranslateArgs([...argv, '--include-pending'], options)).toEqual({
      locale: 'sw',
      includePending: true,
      from: '2026-09-20',
      days: 7,
      only: 'MT.20.1-16',
      max: 2,
    });
  });

  it.each([
    [[], '--locale is required'],
    [['--locale', 'Swahili'], '--locale must be a language tag such as sw, got "Swahili"'],
    [['--locale', 'en'], '--locale must not be English'],
    [['--locale', 'en-KE'], '--locale must not be English'],
    [['--locale', 'sw', '--days', '0'], '--days must be a positive integer, got "0"'],
    [['--locale', 'sw', '--from', 'tomorrow'], '--from must be a date'],
    [['--locale', 'sw', '--nope'], "Unknown option '--nope'"],
    [['--locale', 'sw', 'extra'], 'Unexpected argument'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseTranslateArgs(argv, options)).toThrow(UsageError);
    expect(() => parseTranslateArgs(argv, options)).toThrow(message);
  });

  it('prints the usage with flag errors', () => {
    expect(() => parseTranslateArgs(['--nope'], options)).toThrow(TRANSLATE_USAGE);
  });
});
