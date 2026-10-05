/**
 * The command line of `npm run research`:
 *
 *     research [run] [--from YYYY-MM-DD] [--days n] [--only <key>] [--max n] [common flags]
 *     research plan  [--from YYYY-MM-DD] [--days n] [--only <key>] [--max n] [common flags]
 *     research fixup --pr <n> [--force] [--report <gates.json>] [common flags]
 *     research translate --locale <tag> [translate flags] [common flags]
 *
 * Common flags: `--provider live|fake` (default `live`), `--dry-run`, `--budget <usd>`.
 * `--provider fake` always forces `--dry-run`: fake output never reaches GitHub.
 */
import { parseArgs } from 'node:util';

import { PLAN_USAGE, UsageError, parsePlanArgs } from '../plan/args.ts';
import type { ParsePlanArgsOptions, PlanArgs } from '../plan/args.ts';
import { TRANSLATE_USAGE } from '../translate/args.ts';

export type ProviderMode = 'live' | 'fake';

export const PROVIDER_MODES: readonly ProviderMode[] = ['live', 'fake'];

export const SUBCOMMANDS = ['run', 'plan', 'fixup', 'translate'] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

/** Flags every subcommand takes. */
export interface CommonArgs {
  readonly provider: ProviderMode;
  /** Publish nothing: no branch, commit, PR or comment. Always true with `--provider fake`. */
  readonly dryRun: boolean;
  /** True when `--provider fake` turned on a dry run that `--dry-run` did not ask for. */
  readonly dryRunForced: boolean;
  /** The run's spend ceiling in USD (`--budget`); live runs refuse to spend without it. */
  readonly budgetUsd?: number;
}

export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'plan'; readonly window: PlanArgs; readonly common: CommonArgs }
  | { readonly kind: 'run'; readonly window: PlanArgs; readonly common: CommonArgs }
  | {
      readonly kind: 'fixup';
      readonly pr: number;
      /** Fix up a PR that a person already approved (the new commit resets the approval). */
      readonly force: boolean;
      /** A `gates.json` workflow artifact the owner downloaded, read instead of the PR comment. */
      readonly report?: string;
      readonly common: CommonArgs;
    }
  | { readonly kind: 'translate'; readonly argv: readonly string[]; readonly common: CommonArgs };

export const COMMON_USAGE = 'common flags: [--provider live|fake] [--dry-run] [--budget <usd>]';

export const FIXUP_USAGE = 'usage: research fixup --pr <n> [--force] [--report <gates.json>]';

export const USAGE = [
  `${PLAN_USAGE.replace('usage: research', 'usage: research [run]')}`,
  `${PLAN_USAGE.replace('usage: research', '       research plan')}`,
  `${FIXUP_USAGE.replace('usage:', '      ')}`,
  `${TRANSLATE_USAGE.replace('usage:', '      ')}`,
  COMMON_USAGE,
].join('\n');

const WINDOW_FLAGS = ['from', 'days', 'only', 'max'] as const;

function usd(value: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) {
    throw new UsageError(`--budget must be an amount in USD such as 5 or 12.50, got "${value}"`);
  }
  return Number(value);
}

function positiveInt(flag: string, value: string | undefined): number {
  if (value === undefined) throw new UsageError(`--${flag} is required\n${FIXUP_USAGE}`);
  if (!/^[1-9][0-9]*$/.test(value)) throw new UsageError(`--${flag} must be a positive integer, got "${value}"`);
  return Number(value);
}

/** Splits off the subcommand: the first word when it names one, else `run`. */
function subcommand(argv: readonly string[]): [Subcommand | 'help', string[]] {
  const [first, ...rest] = argv;
  if (first === 'help' || first === '--help' || first === '-h') return ['help', rest];
  if (first !== undefined && (SUBCOMMANDS as readonly string[]).includes(first)) return [first as Subcommand, rest];
  return ['run', [...argv]];
}

interface Parsed {
  readonly values: Record<string, string | boolean | undefined>;
}

function parse(
  argv: readonly string[],
  options: Record<string, { type: 'string' | 'boolean' }>,
  usage: string,
): Parsed {
  try {
    const { values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        provider: { type: 'string' },
        'dry-run': { type: 'boolean' },
        budget: { type: 'string' },
        ...options,
      },
    });
    return { values };
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${usage}`);
  }
}

function common(values: Parsed['values']): CommonArgs {
  const provider = (values['provider'] as string | undefined) ?? 'live';
  if (!(PROVIDER_MODES as readonly string[]).includes(provider)) {
    throw new UsageError(`--provider must be live or fake, got "${provider}"`);
  }
  const asked = values['dry-run'] === true;
  const budget = values['budget'] as string | undefined;
  return {
    provider: provider as ProviderMode,
    dryRun: asked || provider === 'fake',
    dryRunForced: !asked && provider === 'fake',
    ...(budget === undefined ? {} : { budgetUsd: usd(budget) }),
  };
}

/** Pulls the common flags out of a translate command line and leaves the rest for `parseTranslateArgs`. */
function splitCommon(argv: readonly string[]): [string[], string[]] {
  const mine: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    const flag = /^--(provider|budget)(=.*)?$/.exec(word);
    if (word === '--dry-run') mine.push(word);
    else if (flag !== null) {
      mine.push(word);
      if (flag[2] === undefined && i + 1 < argv.length) mine.push(argv[++i] as string);
    } else rest.push(word);
  }
  return [mine, rest];
}

/** Parses a research command line; throws `UsageError` with what to fix. */
export function parseCommand(argv: readonly string[], options: ParsePlanArgsOptions): Command {
  const [kind, rest] = subcommand(argv);
  if (kind === 'help') return { kind };
  if (kind === 'translate') {
    const [mine, others] = splitCommon(rest);
    return { kind, argv: others, common: common(parse(mine, {}, `${TRANSLATE_USAGE}\n${COMMON_USAGE}`).values) };
  }
  if (kind === 'fixup') {
    const { values } = parse(
      rest,
      { pr: { type: 'string' }, force: { type: 'boolean' }, report: { type: 'string' } },
      `${FIXUP_USAGE}\n${COMMON_USAGE}`,
    );
    const report = values['report'] as string | undefined;
    return {
      kind,
      pr: positiveInt('pr', values['pr'] as string | undefined),
      force: values['force'] === true,
      ...(report === undefined ? {} : { report }),
      common: common(values),
    };
  }
  const { values } = parse(
    rest,
    Object.fromEntries(WINDOW_FLAGS.map((flag) => [flag, { type: 'string' as const }])),
    `${PLAN_USAGE}\n${COMMON_USAGE}`,
  );
  const window = WINDOW_FLAGS.flatMap((flag) => {
    const value = values[flag] as string | undefined;
    return value === undefined ? [] : [`--${flag}`, value];
  });
  return { kind, window: parsePlanArgs(window, options), common: common(values) };
}
