/**
 * Arguments of `npm run research -- translate`: `--locale <tag>` (required, never English),
 * `--from <date>`, `--days <n>`, `--only <key>`, `--max <n>` and `--include-pending`. The window
 * flags mean what they mean for research (`parsePlanArgs`): `--from` defaults to today in
 * `site.timezone`, `--days` to `research.defaultDays`.
 */
import { parseArgs } from 'node:util';

import { localeSchema } from '@lectio/schema/common';
import { SOURCE_LOCALE_PATTERN } from '@lectio/schema/translated-passage';

import { UsageError, parsePlanArgs } from '../plan/args.ts';
import type { ParsePlanArgsOptions, PlanArgs } from '../plan/args.ts';

export interface TranslateArgs extends PlanArgs {
  /** Target locale, for example `sw`. */
  readonly locale: string;
  /** Also translate English passages still pending review (default: approved passages only). */
  readonly includePending: boolean;
}

export const TRANSLATE_USAGE =
  'usage: research translate --locale <tag> [--from YYYY-MM-DD] [--days n] [--only <passage key>] [--max n] [--include-pending]';

const LOCALE = new RegExp(localeSchema.pattern);
const SOURCE_LOCALE = new RegExp(SOURCE_LOCALE_PATTERN);
const WINDOW_FLAGS = ['from', 'days', 'only', 'max'] as const;

/** Parses the translate subcommand's flags (the words after `translate`); throws `UsageError`. */
export function parseTranslateArgs(argv: readonly string[], options: ParsePlanArgsOptions): TranslateArgs {
  let values: Partial<Record<(typeof WINDOW_FLAGS)[number] | 'locale', string>> & { 'include-pending'?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        locale: { type: 'string' },
        'include-pending': { type: 'boolean' },
        from: { type: 'string' },
        days: { type: 'string' },
        only: { type: 'string' },
        max: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${TRANSLATE_USAGE}`);
  }
  const { locale } = values;
  if (locale === undefined) throw new UsageError(`--locale is required\n${TRANSLATE_USAGE}`);
  if (!LOCALE.test(locale)) throw new UsageError(`--locale must be a language tag such as sw, got "${locale}"`);
  if (SOURCE_LOCALE.test(locale)) {
    throw new UsageError(`--locale must not be English, the language translations are made from; got "${locale}"`);
  }
  const window = WINDOW_FLAGS.flatMap((flag) => {
    const value = values[flag];
    return value === undefined ? [] : [`--${flag}`, value];
  });
  return { ...parsePlanArgs(window, options), locale, includePending: values['include-pending'] === true };
}
