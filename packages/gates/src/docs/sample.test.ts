import { describe, expect, it } from 'vitest';

import { validateGateResult } from '@lectio/schema/gate-result';

import { COMMENT_MARKER_LINE } from '../core/markdown.ts';
import { headMarker } from '../ci/merge-rule-job.ts';
import { SAMPLE_FILE, SAMPLE_HEAD, sampleComment, sampleDecision, samplePullRequest, sampleResults } from './sample.ts';
import { pullRequestFactsProblems } from '../core/pull-request.ts';

describe('the sample PR in docs/gates.md', () => {
  it('is made of valid gate results and PR facts', () => {
    for (const result of sampleResults()) expect(validateGateResult(result)).toBe(true);
    expect(pullRequestFactsProblems(samplePullRequest())).toEqual([]);
    expect(sampleResults().map((result) => result.status)).toEqual(['pass', 'flag', 'pass', 'flag']);
  });

  it('goes to review for the weak claim and the flags', () => {
    expect(sampleDecision()).toEqual({
      decision: 'needs-review',
      reasons: [
        `claim c2 (${SAMPLE_FILE}): refuter support 0.78 is below 0.9`,
        'the evidence gate flagged 1 finding',
        'the verifiers gate flagged 1 finding',
      ],
    });
  });

  it('renders the sticky comment the merge-rule job posts', () => {
    const comment = sampleComment();
    expect(comment.startsWith(`${COMMENT_MARKER_LINE}\n## Lectio gates: needs review\n`)).toBe(true);
    expect(comment).toContain('**Claim `c2`**');
    expect(comment).toContain('`evidence/print-source-flag`');
    expect(comment.trimEnd().endsWith(headMarker(SAMPLE_HEAD))).toBe(true);
  });
});
