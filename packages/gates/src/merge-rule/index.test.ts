import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';

import { DECISIONS, GREEN_DECISIONS, decide, mergeRuleGate } from './index.ts';

// L-023 stub; L-028 replaces this file and its tests.
describe('merge-rule stub', () => {
  it('decides needs-review for every PR', () => {
    const pr = {
      files: [],
      reviewEdits: [],
      approval: null,
      approvalCommit: null,
      lastContentCommitAt: null,
      fork: false,
    };
    expect(decide({ results: [], config: DEFAULT_CONFIG, pr })).toEqual({
      decision: 'needs-review',
      reasons: ['not implemented (L-028)'],
    });
  });

  it('only approval decisions are green', () => {
    expect(DECISIONS.filter((decision) => GREEN_DECISIONS.has(decision))).toEqual([
      'approved-commit',
      'human-approved',
      'auto-merge',
    ]);
  });

  it('the gate reports skipped', async () => {
    expect(await mergeRuleGate.run({} as never)).toEqual({
      gate: 'merge-rule',
      status: 'skipped',
      items: [],
      meta: { reason: 'not implemented (L-028)' },
    });
  });
});
