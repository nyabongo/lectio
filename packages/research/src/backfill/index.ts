/**
 * `npm run research -- backfill` (L-072): back-fill the library from the 2026–2028 calendars.
 *
 * - By default it only prints the estimate (key count, cost at the per-passage average, the
 *   back-fill ceiling and the number of batches). No provider is built: nothing is called.
 * - `--execute` researches one batch through `research run` on a window from today to the end of
 *   the last year, so the planner orders keys by next occurrence and skips existing passages, open
 *   research PRs and keys whose research PR a person closed (before the batch is capped). The batch
 *   is bounded by reviewer capacity, weekly intake, `--max` and a ceiling of
 *   `min(run budget, research.budget.backfillTotalUsd − spent so far)`.
 * - `backfillTotalUsd` is cumulative: a live batch reserves its ceiling in the spend ledger
 *   (./ledger.ts, `research/backfill-ledger.jsonl`) before it builds a provider and settles what it
 *   spent when it ends, so repeated or concurrent batches never spend more than the ceiling in
 *   total. When nothing is left the batch refuses. `--provider fake` reads the ledger (same caps)
 *   but records nothing, since fake runs spend nothing real.
 * - With `backfillTotalUsd` at 0 (the default until the owner sets one) `--execute` refuses and
 *   nothing is generated. A live batch also needs `--budget <usd>`, at most `research.budget.perRunUsd`.
 *
 * The CLI registry (../cli/registry.ts) routes the subcommand here; main.ts reports the errors it
 * throws (`UsageError` exit 2; `BudgetRefusedError`, `ProviderSetupError`, `ProviderError` exit 1).
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import { openCorpus } from '@lectio/corpus';
import { systemClock } from '@lectio/providers';
import { toIsoDateInZone } from '@lectio/shared';

import { parseCommonArgs } from '../cli/args.ts';
import { runCeilingUsd } from '../cli/budget.ts';
import type { CliContext, CliIo } from '../cli/main.ts';
import { composeProviders } from '../cli/providers.ts';
import type { Toolkit } from '../cli/providers.ts';
import type { RegisteredSubcommand } from '../cli/registry.ts';
import { closedKeys, runResearch } from '../cli/run.ts';
import type { ClosedSkip, RunReport } from '../cli/run.ts';
import { formatRunReport } from '../cli/summary.ts';
import { BACKFILL_USAGE, parseBackfillArgs, resolveYears } from './args.ts';
import { backfillWindow, estimateBackfill } from './estimate.ts';
import type { BackfillEstimate } from './estimate.ts';
import { formatEstimate } from './format.ts';
import { LEDGER_PATH, ledgerTotals, readLedger, reserveSpend, settleSpend } from './ledger.ts';

export { BACKFILL_USAGE, DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, parseBackfillArgs, resolveYears } from './args.ts';
export type { BackfillArgs } from './args.ts';
export { backfillWindow, estimateBackfill } from './estimate.ts';
export type { BackfillEstimate, BackfillKey, BackfillWindow, EstimateInput } from './estimate.ts';
export { PREVIEW_KEYS, formatEstimate } from './format.ts';
export { LEDGER_PATH, ledgerTotals, readLedger, reserveSpend, settleSpend, withLedgerLock } from './ledger.ts';
export type { LedgerEntry, LedgerOptions, LedgerTotals, Reservation } from './ledger.ts';

const money = (usd: number): string => `$${usd.toFixed(2)}`;

/**
 * Passages of a batch that came out ready: written, not abandoned, and published (a PR) or, in a
 * dry run, publishable. A publish that was skipped (for example a branch that already exists) is
 * not progress.
 */
function done(report: RunReport): number {
  const published = new Set(report.published.flatMap((outcome) => (outcome.ok ? [outcome.key] : [])));
  return report.rows.filter(
    (row) =>
      row.research === 'written' && !row.problem && (report.dryRun ? row.pr === 'dry run' : published.has(row.key)),
  ).length;
}

/** The closing line of a batch: what is ready, what a person closed, what is left and what it would cost. */
export function formatBatchSummary(
  estimate: BackfillEstimate,
  report: RunReport,
  closed: readonly ClosedSkip[] = [],
): string {
  const ready = done(report);
  const left = estimate.remaining.length - ready - closed.length;
  const verb = report.dryRun ? 'would be left (dry run: nothing was published)' : 'left';
  return (
    `Back-fill: ${String(ready)} passage(s) ready in this batch; ` +
    (closed.length === 0 ? '' : `${String(closed.length)} skipped (a person closed their PR); `) +
    `${String(left)} ${verb}, estimated ${money(left * estimate.perPassageUsd)}.`
  );
}

/** `repo` with `keys` listed among the passages, so the planner skips them before it caps the batch. */
function hiding(repo: ContentRepo, keys: readonly string[]): ContentRepo {
  if (keys.length === 0) return repo;
  return { ...repo, passageKeys: () => [...repo.passageKeys(), ...keys] };
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
  const ledger = join(context.repoRoot, LEDGER_PATH);
  const estimate = estimateBackfill({
    ...resolveYears(args, repo.years()),
    today: toIsoDateInZone(clock.now(), config.site.timezone),
    repo,
    config,
    ...(args.perPassageUsd === undefined ? {} : { perPassageUsd: args.perPassageUsd }),
    spentUsd: ledgerTotals(readLedger(ledger)).spentUsd,
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

  const wantUsd = Math.min(runCeilingUsd(common, config), totalUsd);
  const live = common.provider === 'live';
  const at = (): string => clock.now().toISOString();
  const reservation = live
    ? await reserveSpend(ledger, { run: `backfill-${at()}-${randomUUID().slice(0, 8)}`, at: at(), wantUsd, totalUsd })
    : null;
  if (!live && estimate.leftUsd < 0.01) {
    io.err(
      `research backfill: the back-fill ceiling is used up (${money(estimate.spentUsd)} of ${money(totalUsd)} ` +
        `research.budget.backfillTotalUsd in ${LEDGER_PATH}); nothing was generated.`,
    );
    return 1;
  }
  const ceilingUsd = reservation?.reservedUsd ?? Math.min(wantUsd, estimate.leftUsd);
  if (common.dryRunForced) say('', '--provider fake: dry run, nothing is published.');
  else if (common.dryRun) say('', 'Dry run: nothing is published.');
  say(
    '',
    `Batch ceiling: ${money(ceilingUsd)} (the run budget, at most what is left of ` +
      'research.budget.backfillTotalUsd). ' +
      (reservation === null
        ? `--provider fake spends nothing real: this batch is not recorded in ${LEDGER_PATH}.`
        : `Reserved in ${LEDGER_PATH} until the batch ends.`),
  );
  let kit: Toolkit | undefined;
  try {
    kit = await (context.compose ?? composeProviders)({
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
    // Closed keys sit at the front of the order on every run; hide them so they do not use the batch.
    const closed = await closedKeys(
      estimate.remaining.map((entry) => ({ key: entry.key, ref: entry.ref, firstDate: entry.firstDate, dates: [] })),
      kit.github,
    );
    const ran = await runResearch(
      { ...window, ...(args.max === undefined ? {} : { max: args.max }) },
      {
        ...kit,
        github: common.dryRun ? dryRunGitHub(kit.github) : kit.github,
        ...(context.format === undefined ? {} : { format: context.format }),
        config,
        repoRoot: context.repoRoot,
        repo: hiding(
          repo,
          closed.map((entry) => entry.key),
        ),
        corpus: context.corpus ?? openCorpus(join(context.repoRoot, 'corpus')),
        dryRun: common.dryRun,
      },
    );
    const shown = new Set(closed.map((entry) => entry.key));
    // The planner lists the hidden keys as existing passages; leave them out and name them below.
    const report: RunReport = {
      ...ran,
      plan: { ...ran.plan, skipped: ran.plan.skipped.filter((item) => !shown.has(item.key)) },
    };
    say(
      '',
      formatRunReport(report),
      ...closed.map((entry) => `Skipped ${entry.key}: a person closed PR #${String(entry.pr)}`),
      '',
      formatBatchSummary(estimate, report, closed),
    );
    return report.rows.some((row) => row.problem) ? 1 : 0;
  } finally {
    if (reservation !== null) {
      const spentUsd = kit?.meter.spentUsd() ?? 0;
      await settleSpend(ledger, { run: reservation.run, at: at(), spentUsd });
      const total = reservation.spentBeforeUsd + spentUsd;
      say(
        `Back-fill spend: ${money(spentUsd)} in this batch; ${money(total)} of ${money(totalUsd)} spent in total, ` +
          `${money(Math.max(0, totalUsd - total))} left (${LEDGER_PATH}; commit it so other clones count it).`,
      );
    }
  }
}

export const backfillSubcommand: RegisteredSubcommand = { name: 'backfill', usage: BACKFILL_USAGE, run };
