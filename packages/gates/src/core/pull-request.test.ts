import { describe, expect, it } from 'vitest';

import { parsePullRequestFacts, pullRequestFactsProblems } from './pull-request.ts';
import type { PullRequestFacts } from './pull-request.ts';

const facts: PullRequestFacts = {
  number: 155,
  files: ['passages/MT.20.1-16.json'],
  reviewEdits: [],
  approval: { handle: 'nyabongo', via: 'label', at: '2026-10-05T10:00:00Z' },
  approvalCommit: {
    kind: 'human',
    runId: '123',
    trailerHead: 'abc',
    parentSha: 'abc',
    authorIsBot: true,
    signatureVerified: true,
    run: { workflow: 'content-gates.yml', prNumber: 155, event: 'pull_request', headSha: 'abc' },
  },
  lastContentCommitAt: '2026-10-05T09:00:00Z',
  fork: false,
};

describe('parsePullRequestFacts', () => {
  it('accepts complete facts, and nulls where allowed', () => {
    expect(parsePullRequestFacts(facts)).toBe(facts);
    const minimal = { ...facts, approval: null, approvalCommit: null, lastContentCommitAt: null };
    expect(pullRequestFactsProblems(minimal)).toEqual([]);
  });

  it('rejects a non-object', () => {
    for (const value of [null, [], 'x']) expect(pullRequestFactsProblems(value)).toEqual(['expected a JSON object']);
    expect(() => parsePullRequestFacts(3)).toThrow(
      new TypeError('not valid pull request facts: expected a JSON object'),
    );
  });

  it('names every wrong field, nested ones included', () => {
    const bad = {
      ...facts,
      number: 0,
      files: ['a', 1],
      fork: 'no',
      approval: { handle: 'x', via: 'cli', at: 1 },
      approvalCommit: {
        ...facts.approvalCommit,
        kind: 'robot',
        run: { ...facts.approvalCommit?.run, prNumber: '155' },
      },
    };
    expect(pullRequestFactsProblems(bad)).toEqual([
      'number: missing or of the wrong type',
      'files: missing or of the wrong type',
      'fork: missing or of the wrong type',
      'approval.via: missing or of the wrong type',
      'approval.at: missing or of the wrong type',
      'approvalCommit.kind: missing or of the wrong type',
      'approvalCommit.run.prNumber: missing or of the wrong type',
    ]);
  });

  it('reports a missing run and wrong top-level types for the nested objects', () => {
    const { reviewEdits: _r, ...missing } = facts;
    expect(
      pullRequestFactsProblems({ ...missing, approval: 'yes', approvalCommit: { ...facts.approvalCommit, run: null } }),
    ).toEqual([
      'reviewEdits: missing or of the wrong type',
      'approval: missing or of the wrong type',
      'approvalCommit.run: missing or of the wrong type',
    ]);
  });
});
