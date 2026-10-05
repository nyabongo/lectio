/**
 * Spend ceilings of a CLI run. Live research spends real money, so its run budget is $0 until the
 * owner names one with `--budget <usd>`, and that figure may not exceed `research.budget.perRunUsd`
 * (two keys: the config sets the most a run may ever spend, the flag opts one run in). Every passage
 * is also capped at `research.budget.perPassageUsd` by the agent and the repair loop.
 *
 * Fake runs spend nothing real; their meter uses `--budget` or `perRunUsd` so the plan and the
 * metering behave as in a live run.
 */
import type { LectioConfig } from '@lectio/config';

import { UsageError } from '../plan/args.ts';
import type { CommonArgs } from './args.ts';

/** A live run that would spend without an explicit budget. */
export class BudgetRefusedError extends Error {
  override readonly name = 'BudgetRefusedError';
}

const money = (usd: number): string => `$${usd.toFixed(2)}`;

/**
 * The run ceiling for a command that calls LLMs. Throws `BudgetRefusedError` for a live run without
 * a positive `--budget`, and `UsageError` for a `--budget` above `research.budget.perRunUsd`.
 */
export function runCeilingUsd(args: CommonArgs, config: Pick<LectioConfig, 'research'>): number {
  const { perRunUsd } = config.research.budget;
  if (args.provider === 'fake') return args.budgetUsd ?? perRunUsd;
  const budget = args.budgetUsd ?? 0;
  if (budget <= 0) {
    throw new BudgetRefusedError(
      `live research spends real money and this run's budget is ${money(budget)}: ` +
        `pass --budget <usd> (at most research.budget.perRunUsd, ${money(perRunUsd)}) to allow it, ` +
        'or use --provider fake for a dry run',
    );
  }
  if (budget > perRunUsd) {
    throw new UsageError(
      `--budget ${money(budget)} is above research.budget.perRunUsd (${money(perRunUsd)}); ` +
        'raise it in config/lectio.config.json first',
    );
  }
  return budget;
}

/** The ceiling the planner divides among passages for `research plan`, which spends nothing. */
export function planCeilingUsd(args: CommonArgs, config: Pick<LectioConfig, 'research'>): number {
  return args.budgetUsd ?? config.research.budget.perRunUsd;
}
