import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { UsageError } from '../plan/args.ts';
import type { CommonArgs } from './args.ts';
import { BudgetRefusedError, planCeilingUsd, runCeilingUsd } from './budget.ts';

const live: CommonArgs = { provider: 'live', dryRun: false, dryRunForced: false };
const fake: CommonArgs = { provider: 'fake', dryRun: true, dryRunForced: true };
const config = DEFAULT_CONFIG; // perRunUsd 25

describe('runCeilingUsd', () => {
  it('refuses a live run without a positive --budget: the default budget is $0', () => {
    expect(() => runCeilingUsd(live, config)).toThrow(BudgetRefusedError);
    expect(() => runCeilingUsd(live, config)).toThrow("this run's budget is $0.00: pass --budget <usd>");
    expect(() => runCeilingUsd({ ...live, budgetUsd: 0 }, config)).toThrow(BudgetRefusedError);
  });

  it('takes --budget up to research.budget.perRunUsd', () => {
    expect(runCeilingUsd({ ...live, budgetUsd: 10 }, config)).toBe(10);
    expect(runCeilingUsd({ ...live, budgetUsd: 25 }, config)).toBe(25);
    expect(() => runCeilingUsd({ ...live, budgetUsd: 25.01 }, config)).toThrow(UsageError);
    expect(() => runCeilingUsd({ ...live, budgetUsd: 30 }, config)).toThrow(
      '--budget $30.00 is above research.budget.perRunUsd ($25.00)',
    );
  });

  it('meters fake runs at --budget or perRunUsd, since nothing real is spent', () => {
    expect(runCeilingUsd(fake, config)).toBe(25);
    expect(runCeilingUsd({ ...fake, budgetUsd: 2 }, config)).toBe(2);
  });
});

describe('planCeilingUsd', () => {
  it('uses --budget when given, else perRunUsd', () => {
    expect(planCeilingUsd(live, config)).toBe(25);
    expect(planCeilingUsd({ ...live, budgetUsd: 3 }, config)).toBe(3);
  });
});
