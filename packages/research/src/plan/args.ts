/**
 * Planner arguments: `--from <date>`, `--days <n>`, `--only <key>`, `--max <n>`.
 * `--from` defaults to today in `site.timezone`; `--days` to `research.defaultDays`.
 */
import { parseArgs } from 'node:util';

import type { LectioConfig } from '@lectio/config';
import { PASSAGE_KEY_PATTERN } from '@lectio/schema/common';
import { isIsoDate, toIsoDateInZone } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

export interface PlanArgs {
  readonly from: IsoDate;
  readonly days: number;
  readonly only?: string;
  readonly max?: number;
}

/** A bad command line; the message says what to fix. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export const PLAN_USAGE = 'usage: research [--from YYYY-MM-DD] [--days n] [--only <passage key>] [--max n]';

export interface ParsePlanArgsOptions {
  readonly config: Pick<LectioConfig, 'site' | 'research'>;
  /** "Now", for the default `--from`. */
  readonly now: Date;
}

const KEY_SHAPE = new RegExp(PASSAGE_KEY_PATTERN);

function positiveInt(flag: string, value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new UsageError(`--${flag} must be a positive integer, got "${value}"`);
  return Number(value);
}

/** Parses planner flags; throws `UsageError` on an unknown flag, a positional or a bad value. */
export function parsePlanArgs(argv: readonly string[], options: ParsePlanArgsOptions): PlanArgs {
  let values: { from?: string; days?: string; only?: string; max?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        from: { type: 'string' },
        days: { type: 'string' },
        only: { type: 'string' },
        max: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${PLAN_USAGE}`);
  }
  const from = values.from ?? toIsoDateInZone(options.now, options.config.site.timezone);
  if (!isIsoDate(from)) throw new UsageError(`--from must be a date (YYYY-MM-DD), got "${from}"`);
  const days = values.days === undefined ? options.config.research.defaultDays : positiveInt('days', values.days);
  if (values.only !== undefined && !KEY_SHAPE.test(values.only)) {
    throw new UsageError(`--only must be a passage key such as MT.20.1-16, got "${values.only}"`);
  }
  return {
    from,
    days,
    ...(values.only === undefined ? {} : { only: values.only }),
    ...(values.max === undefined ? {} : { max: positiveInt('max', values.max) }),
  };
}
