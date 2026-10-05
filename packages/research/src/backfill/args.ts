/**
 * Back-fill flags (the words after `backfill`, common flags already removed):
 *
 *     research backfill [--from-year YYYY] [--to-year YYYY] [--per-passage <usd>] [--max n] [--execute]
 *
 * Without `--execute` the command only prints the estimate: no provider is built and nothing is
 * called. The calendar years default to 2026–2028, the three years that cover Sunday cycles A, B
 * and C and weekday cycles I and II.
 */
import { parseArgs } from 'node:util';

import { UsageError } from '../plan/args.ts';

export const BACKFILL_USAGE =
  'research backfill [--from-year YYYY] [--to-year YYYY] [--per-passage <usd>] [--max n] [--execute]';

/** The calendar years back-fill covers by default. */
export const DEFAULT_FROM_YEAR = 2026;
export const DEFAULT_TO_YEAR = 2028;

export interface BackfillArgs {
  readonly fromYear: number;
  readonly toYear: number;
  /** A measured average cost per passage (L-041's first-run report); default `research.budget.perPassageUsd`. */
  readonly perPassageUsd?: number;
  /** At most this many passages in the batch. */
  readonly max?: number;
  /** Research a batch; without it the command only prints the estimate. */
  readonly execute: boolean;
}

function year(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]{4}$/.test(value)) throw new UsageError(`--${flag} must be a year such as 2026, got "${value}"`);
  return Number(value);
}

/** Parses the back-fill flags; throws `UsageError` with what to fix. */
export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        'from-year': { type: 'string' },
        'to-year': { type: 'string' },
        'per-passage': { type: 'string' },
        max: { type: 'string' },
        execute: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nusage: ${BACKFILL_USAGE}`);
  }
  const fromYear = year('from-year', values['from-year'] as string | undefined, DEFAULT_FROM_YEAR);
  const toYear = year('to-year', values['to-year'] as string | undefined, DEFAULT_TO_YEAR);
  if (toYear < fromYear) throw new UsageError(`--to-year ${String(toYear)} is before --from-year ${String(fromYear)}`);
  const perPassage = values['per-passage'] as string | undefined;
  if (perPassage !== undefined && !/^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/.test(perPassage)) {
    throw new UsageError(`--per-passage must be an amount in USD such as 1.25, got "${perPassage}"`);
  }
  const max = values['max'] as string | undefined;
  if (max !== undefined && !/^[1-9][0-9]*$/.test(max)) {
    throw new UsageError(`--max must be a positive integer, got "${max}"`);
  }
  return {
    fromYear,
    toYear,
    ...(perPassage === undefined ? {} : { perPassageUsd: Number(perPassage) }),
    ...(max === undefined ? {} : { max: Number(max) }),
    execute: values['execute'] === true,
  };
}
