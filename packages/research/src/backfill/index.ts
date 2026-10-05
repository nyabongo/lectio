/**
 * `npm run research -- backfill` (L-072): back-fill the library from the 2026–2028 calendars.
 *
 * - By default it only prints the estimate (key count, cost at the per-passage average, the
 *   back-fill ceiling and the number of batches). No provider is built: nothing is called.
 * - `--execute` researches one batch through `research run` on a window from today to the end of
 *   the last year, so the planner orders keys by next occurrence and skips existing passages and
 *   open research PRs. The batch is bounded by reviewer capacity, weekly intake, `--max` and a
 *   ceiling of `min(run budget, research.budget.backfillTotalUsd)`.
 * - With `backfillTotalUsd` at 0 (the default until the owner sets one) `--execute` refuses and
 *   nothing is generated. A live batch also needs `--budget <usd>`, at most `research.budget.perRunUsd`.
 *
 * The CLI registry (../cli/registry.ts) routes the subcommand here; main.ts reports the errors it
 * throws (`UsageError` exit 2; `BudgetRefusedError`, `ProviderSetupError`, `ProviderError` exit 1).
 */
import { join } from 'node:path';

import { openRepo } from '@lectio/content';
import { openCorpus } from '@lectio/corpus';
import { systemClock } from '@lectio/providers';
import { toIsoDateInZone } from '@lectio/shared';

import { parseCommonArgs } from '../cli/args.ts';
import { runCeilingUsd } from '../cli/budget.ts';
import type { CliContext, CliIo } from '../cli/main.ts';
import { composeProviders } from '../cli/providers.ts';
import type { RegisteredSubcommand } from '../cli/registry.ts';
import { runResearch } from '../cli/run.ts';
import type { RunReport } from '../cli/run.ts';
import { formatRunReport } from '../cli/summary.ts';
import { BACKFILL_USAGE, parseBackfillArgs } from './args.ts';
import { backfillWindow, estimateBackfill } from './estimate.ts';
import type { BackfillEstimate } from './estimate.ts';
import { formatEstimate } from './format.ts';

export { BACKFILL_USAGE, DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, parseBackfillArgs } from './args.ts';
export type { BackfillArgs } from './args.ts';
export { backfillWindow, estimateBackfill } from './estimate.ts';
export type { BackfillEstimate, BackfillKey, BackfillWindow, EstimateInput } from './estimate.ts';
export { PREVIEW_KEYS, formatEstimate } from './format.ts';

const money = (usd: number): string => `$${usd.toFixed(2)}`;

/** Passages of a batch that came out ready (written, not abandoned, published or a dry run). */
function done(report: RunReport): number {
  return report.rows.filter((row) => row.research === 'written' && !row.problem).length;
}

/** The closing line of a batch: what is left and what it would cost. */
export function formatBatchSummary(estimate: BackfillEstimate, report: RunReport): string {
  const left = estimate.remaining.length - done(report);
  const verb = report.dryRun ? 'would be left (dry run: nothing was published)' : 'left';
  return (
    `Back-fill: ${String(done(report))} passage(s) ready in this batch; ${String(left)} ${verb}, ` +
    `estimated ${money(left * estimate.perPassageUsd)}.`
  );
}

async function run(argv: readonly string[], context: CliContext, io: CliIo): Promise<number> {
  const [common, rest] = parseCommonArgs(argv, `usage: ${BACKFILL_USAGE}`);
  const args = parseBackfillArgs(rest);
  const say = (...lines: string[]): void => {
    for (const line of lines) io.out(line);
  };
  const { config } = context;
  const clock = context.clock ?? systemClock;
  const contentRoot = join(context.repoRoot, config.content.root);
  const repo = context.repo ?? openRepo(contentRoot);
  const estimate = estimateBackfill({
    fromYear: args.fromYear,
    toYear: args.toYear,
    today: toIsoDateInZone(clock.now(), config.site.timezone),
    repo,
    config,
    ...(args.perPassageUsd === undefined ? {} : { perPassageUsd: args.perPassageUsd }),
  });
  io.out(formatEstimate(estimate));

  if (!args.execute) {
    say('', 'Estimate only: nothing was generated. Pass --execute to research the next batch.');
    return 0;
  }
  const totalUsd = config.research.budget.backfillTotalUsd;
  if (totalUsd <= 0) {
    io.err(
      'research backfill: research.budget.backfillTotalUsd is $0.00, so back-fill only estimates and nothing was ' +
        'generated. The owner sets the ceiling in config/lectio.config.json (docs/decisions/004-research-runner.md).',
    );
    return 1;
  }
  if (estimate.remaining.length === 0) {
    say('', 'Nothing left to back-fill.');
    return 0;
  }

  const ceilingUsd = Math.min(runCeilingUsd(common, config), totalUsd);
  if (common.dryRunForced) say('', '--provider fake: dry run, nothing is published.');
  else if (common.dryRun) say('', 'Dry run: nothing is published.');
  say('', `Batch ceiling: ${money(ceilingUsd)} (the run budget, at most research.budget.backfillTotalUsd).`);
  const kit = await (context.compose ?? composeProviders)({
    mode: common.provider,
    config,
    env: context.env,
    ceilingUsd,
    llm: true,
    clock,
  });
  // Loaded here: main.ts loads the registry, which loads this module.
  const { dryRunGitHub } = await import('../cli/main.ts');
  const window = backfillWindow(estimate);
  const report = await runResearch(
    { ...window, ...(args.max === undefined ? {} : { max: args.max }) },
    {
      ...kit,
      github: common.dryRun ? dryRunGitHub(kit.github) : kit.github,
      ...(context.format === undefined ? {} : { format: context.format }),
      config,
      repoRoot: context.repoRoot,
      repo,
      corpus: context.corpus ?? openCorpus(join(context.repoRoot, 'corpus')),
      dryRun: common.dryRun,
    },
  );
  say('', formatRunReport(report), '', formatBatchSummary(estimate, report));
  return report.rows.some((row) => row.problem) ? 1 : 0;
}

export const backfillSubcommand: RegisteredSubcommand = { name: 'backfill', usage: BACKFILL_USAGE, run };
