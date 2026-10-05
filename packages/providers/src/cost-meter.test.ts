import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { createCostMeter } from './cost-meter.ts';
import { BudgetExceededError, ProviderError } from './errors.ts';
import { FakeLlmClient } from './fake-llm.ts';
import type { LlmRequest } from './llm.ts';

const pricing = DEFAULT_CONFIG.pricing;

describe('createCostMeter pricing', () => {
  it('prices input, output, cached input and web searches from config.pricing', () => {
    const meter = createCostMeter({ pricing });
    // claude-opus-5-5: $4 in, $20 out, $0.2 cached per MTok, $10 per 1000 searches
    expect(
      meter.price('claude-opus-5-5', {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cachedInputTokens: 500_000,
        webSearches: 3,
      }),
    ).toBe(4 + 2 + 0.1 + 0.03);
  });

  it('bills cached tokens at the input price when no cached price is set', () => {
    const meter = createCostMeter({ pricing: { m: { inputPerMTok: 2, outputPerMTok: 0 } } });
    expect(meter.price('m', { inputTokens: 0, outputTokens: 0, cachedInputTokens: 1_000_000 })).toBe(2);
  });

  it('rejects unpriced models, unpriced searches and bad counts', () => {
    const meter = createCostMeter({ pricing });
    expect(() => meter.price('gpt-0', { inputTokens: 1, outputTokens: 1 })).toThrow(/no price for model "gpt-0"/);
    expect(() => meter.price('fake', { inputTokens: 1, outputTokens: 1, webSearches: 1 })).toThrow(
      /no web search price/,
    );
    expect(() => meter.price('fake', { inputTokens: -1, outputTokens: 1 })).toThrow(ProviderError);
    expect(() => meter.price('fake', { inputTokens: Number.NaN, outputTokens: 1 })).toThrow(/inputTokens/);
    expect(() => meter.chargeUsd(-1, 'refund')).toThrow(/cannot charge/);
    expect(() => meter.chargeUsd(Number.POSITIVE_INFINITY, 'x')).toThrow(/cannot charge/);
  });

  it('rejects a negative ceiling', () => {
    expect(() => createCostMeter({ pricing, ceilingUsd: -1 })).toThrow(RangeError);
    expect(() => createCostMeter({ pricing, ceilingUsd: Number.NaN })).toThrow(RangeError);
  });
});

describe('createCostMeter charges', () => {
  it('records charges and reports spend and what is left', () => {
    const meter = createCostMeter({ pricing, ceilingUsd: 1, label: 'run' });
    expect(meter.label).toBe('run');
    expect(meter.ceilingUsd).toBe(1);
    expect(meter.chargeUsage('claude-haiku-4-5-20251001', { inputTokens: 100_000, outputTokens: 20_000 })).toBe(0.2);
    expect(meter.chargeUsd(0.05, 'tts')).toBe(0.05);
    expect(meter.spentUsd()).toBe(0.25);
    expect(meter.remainingUsd()).toBe(0.75);
    expect(meter.entries()).toEqual([
      {
        meter: 'run',
        note: 'llm:claude-haiku-4-5-20251001',
        usd: 0.2,
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 100_000, outputTokens: 20_000 },
      },
      { meter: 'run', note: 'tts', usd: 0.05 },
    ]);
  });

  it('defaults to an unlimited meter labelled run', () => {
    const meter = createCostMeter({ pricing });
    meter.chargeUsd(1_000_000, 'huge');
    expect(meter.label).toBe('run');
    expect(meter.remainingUsd()).toBe(Infinity);
    expect(() => meter.assertWithinBudget()).not.toThrow();
  });

  it('throws BudgetExceededError once a charge crosses the ceiling, after recording it', () => {
    const meter = createCostMeter({ pricing, ceilingUsd: 0.1, label: 'run' });
    meter.chargeUsd(0.1, 'exactly at the ceiling');
    expect(() => meter.assertWithinBudget()).toThrow(BudgetExceededError);
    const error = (() => {
      try {
        meter.chargeUsd(0.01, 'one cent over');
      } catch (e) {
        return e as BudgetExceededError;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(BudgetExceededError);
    expect(error).toMatchObject({ name: 'BudgetExceededError', meter: 'run', ceilingUsd: 0.1, spentUsd: 0.11 });
    expect(error?.message).toBe('budget exceeded for run: spent $0.1100 of a $0.10 ceiling');
    expect(meter.spentUsd()).toBe(0.11);
    expect(meter.remainingUsd()).toBe(0);
  });

  it('charges a scope and every parent, enforcing each ceiling', () => {
    const run = createCostMeter({ pricing, ceilingUsd: 1 });
    const passageA = run.scope('passage:a', 0.6);
    passageA.chargeUsd(0.5, 'a1');
    expect(() => passageA.chargeUsd(0.2, 'a2')).toThrow(/passage:a/);
    expect(run.spentUsd()).toBe(0.7);
    const passageB = run.scope('passage:b');
    expect(passageB.ceilingUsd).toBe(Infinity);
    expect(() => passageB.chargeUsd(0.4, 'b1')).toThrow(/budget exceeded for run/);
    expect(passageB.spentUsd()).toBe(0.4);
    expect(() => passageB.assertWithinBudget()).toThrow(/run/);
    expect(run.entries().map((e) => `${e.meter}:${e.note}`)).toEqual(['passage:a:a1', 'passage:a:a2', 'passage:b:b1']);
    expect(passageA.entries()).toHaveLength(2);
  });
});

describe('budget guard', () => {
  const request: LlmRequest = {
    role: 'generator',
    system: 'Write a study note.',
    messages: [{ role: 'user', content: 'Passage 1' }],
    model: 'claude-opus-5-5',
    maxTokens: 4096,
  };

  it('stops a run at the configured ceiling', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      research: { ...DEFAULT_CONFIG.research, budget: { perPassageUsd: 1.5, perRunUsd: 2, backfillTotalUsd: 0 } },
    };
    const meter = createCostMeter({ pricing: config.pricing, ceilingUsd: config.research.budget.perRunUsd });
    // Each call: 50k in at $4/MTok + 20k out at $20/MTok = $0.60.
    const llm = new FakeLlmClient({
      costMeter: meter,
      roles: { generator: { usage: { inputTokens: 50_000, outputTokens: 20_000 } } },
    });
    const completed: number[] = [];
    let stoppedBy: unknown;
    for (let passage = 1; passage <= 10; passage++) {
      try {
        meter.assertWithinBudget();
        await llm.generate({ ...request, messages: [{ role: 'user', content: `Passage ${passage}` }] });
        completed.push(passage);
      } catch (error) {
        stoppedBy = error;
        break;
      }
    }
    expect(stoppedBy).toBeInstanceOf(BudgetExceededError);
    expect(completed).toEqual([1, 2, 3]);
    expect(llm.calls).toHaveLength(4);
    expect(meter.spentUsd()).toBe(2.4);
  });

  it('stops before starting work when the ceiling is already reached', async () => {
    const meter = createCostMeter({ pricing, ceilingUsd: 0.6 });
    const llm = new FakeLlmClient({
      costMeter: meter,
      roles: { generator: { usage: { inputTokens: 50_000, outputTokens: 20_000 } } },
    });
    await llm.generate(request);
    expect(() => meter.assertWithinBudget()).toThrow(BudgetExceededError);
  });
});
