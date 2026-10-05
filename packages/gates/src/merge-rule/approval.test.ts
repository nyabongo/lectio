import { describe, expect, it } from 'vitest';

import {
  approvalCommitProblems,
  formatApprovalTrailer,
  isApprovalCommit,
  lastContentCommitAt,
  parseApprovalTrailer,
} from './approval.ts';
import type { PullRequestCommit } from './approval.ts';
import {
  APPROVAL_COMMIT_AT,
  CONTENT_COMMIT_AT,
  LATER_CONTENT_COMMIT_AT,
  MAIN_TIP_SHA,
  OTHER_SHA,
  PARENT_SHA,
  PR_NUMBER,
  RUN_ID,
  approvalCommit,
} from './fixtures/facts.ts';

const TRAILER = `Lectio-Approval: human run=${RUN_ID} head=${PARENT_SHA}`;

describe('approval trailer', () => {
  it('formats and parses the trailer', () => {
    expect(formatApprovalTrailer({ kind: 'human', runId: RUN_ID, head: PARENT_SHA })).toBe(TRAILER);
    expect(parseApprovalTrailer(`Approve MT.20.1-16\n\n${TRAILER}\n`)).toEqual({
      kind: 'human',
      runId: RUN_ID,
      head: PARENT_SHA,
    });
    const sha256 = 'd'.repeat(64);
    expect(parseApprovalTrailer(`x\n\nLectio-Approval: auto run=1 head=${sha256}`)).toEqual({
      kind: 'auto',
      runId: '1',
      head: sha256,
    });
  });

  it('refuses to format a bad run id or sha', () => {
    expect(() => formatApprovalTrailer({ kind: 'auto', runId: 'abc', head: PARENT_SHA })).toThrow('invalid run id');
    expect(() => formatApprovalTrailer({ kind: 'auto', runId: '1', head: 'HEAD' })).toThrow('invalid head sha');
  });

  it.each([
    ['no trailer', 'Add MT.20.1-16'],
    ['two trailers', `${TRAILER}\n${TRAILER}`],
    ['an unknown kind', `Lectio-Approval: maybe run=1 head=${PARENT_SHA}`],
    ['a short sha', 'Lectio-Approval: human run=1 head=abc123'],
    ['a run id that is not a number', `Lectio-Approval: human run=x head=${PARENT_SHA}`],
    ['the trailer mid-line', `see Lectio-Approval: human run=1 head=${PARENT_SHA}`],
  ])('finds no trailer in a message with %s', (_name, message) => {
    expect(parseApprovalTrailer(message)).toBeNull();
  });
});

describe('approval commit validity', () => {
  it('accepts a signed bot commit from a pull_request run on the parent', () => {
    expect(approvalCommitProblems(approvalCommit(), PR_NUMBER)).toEqual([]);
    expect(approvalCommitProblems(approvalCommit({ run: { workflow: 'content-gates.yml' } }), PR_NUMBER)).toEqual([]);
  });

  it('accepts an issue_comment run whose head SHA is main’s tip', () => {
    const commit = approvalCommit({ run: { event: 'issue_comment', headSha: MAIN_TIP_SHA } });
    expect(approvalCommitProblems(commit, PR_NUMBER)).toEqual([]);
  });

  it('accepts a workflow_dispatch run without comparing its head SHA', () => {
    const commit = approvalCommit({ run: { event: 'workflow_dispatch', headSha: OTHER_SHA } });
    expect(approvalCommitProblems(commit, PR_NUMBER)).toEqual([]);
  });

  it.each([
    ['a non-bot author', approvalCommit({ authorIsBot: false }), 'it is not authored by github-actions[bot]'],
    ['an unsigned commit', approvalCommit({ signatureVerified: false }), 'its signature is not verified'],
    ['a bad run id', approvalCommit({ runId: 'abc' }), 'its run id "abc" is not a workflow run id'],
    [
      'another workflow',
      approvalCommit({ run: { workflow: 'ci.yml' } }),
      `run ${RUN_ID} is a ci.yml run, not content-gates.yml`,
    ],
    ['another PR', approvalCommit({ run: { prNumber: 7 } }), `run ${RUN_ID} belongs to PR #7, not #42`],
    [
      'an unexpected event',
      approvalCommit({ run: { event: 'push' } }),
      `run ${RUN_ID} was triggered by push, which never writes approval commits`,
    ],
    [
      'a parent that is not a sha',
      approvalCommit({ parentSha: 'HEAD', trailerHead: 'HEAD', run: { event: 'issue_comment' } }),
      'its parent "HEAD" is not a commit sha',
    ],
    [
      'a trailer head that is not the parent',
      approvalCommit({ trailerHead: OTHER_SHA }),
      `the trailer head ${OTHER_SHA} is not the commit's parent ${PARENT_SHA}`,
    ],
    [
      'a pull_request run on another sha',
      approvalCommit({ run: { headSha: OTHER_SHA } }),
      `pull_request run ${RUN_ID} ran on ${OTHER_SHA}, not on the parent ${PARENT_SHA}`,
    ],
  ])('rejects %s', (_name, commit, problem) => {
    expect(approvalCommitProblems(commit, PR_NUMBER)).toEqual([problem]);
  });

  it('rejects every approval commit when the PR number is unknown', () => {
    for (const unknown of [undefined, 0]) {
      expect(approvalCommitProblems(approvalCommit(), unknown)).toEqual([
        `the PR number is unknown, so run ${RUN_ID} cannot be tied to it`,
      ]);
    }
  });
});

describe('last content commit', () => {
  const content = (committedAt: string): PullRequestCommit => ({
    committedAt,
    message: 'Add MT.20.1-16',
    authorIsBot: false,
    signatureVerified: false,
  });
  const approval = (committedAt: string, overrides: Partial<PullRequestCommit> = {}): PullRequestCommit => ({
    committedAt,
    message: `Approve MT.20.1-16\n\n${TRAILER}`,
    authorIsBot: true,
    signatureVerified: true,
    ...overrides,
  });

  it('skips signed bot approval commits only', () => {
    expect(isApprovalCommit(approval(APPROVAL_COMMIT_AT))).toBe(true);
    expect(isApprovalCommit(approval(APPROVAL_COMMIT_AT, { authorIsBot: false }))).toBe(false);
    expect(isApprovalCommit(approval(APPROVAL_COMMIT_AT, { signatureVerified: false }))).toBe(false);
    expect(isApprovalCommit(content(CONTENT_COMMIT_AT))).toBe(false);
  });

  it('is the latest content commit time; an approval commit never resets it', () => {
    expect(lastContentCommitAt([content(CONTENT_COMMIT_AT), approval(APPROVAL_COMMIT_AT)])).toBe(CONTENT_COMMIT_AT);
    expect(
      lastContentCommitAt([content(LATER_CONTENT_COMMIT_AT), content(CONTENT_COMMIT_AT), approval(APPROVAL_COMMIT_AT)]),
    ).toBe(LATER_CONTENT_COMMIT_AT);
    expect(lastContentCommitAt([approval(APPROVAL_COMMIT_AT, { authorIsBot: false })])).toBe(APPROVAL_COMMIT_AT);
  });

  it('is null without content commits and throws on a bad time', () => {
    expect(lastContentCommitAt([])).toBeNull();
    expect(lastContentCommitAt([approval(APPROVAL_COMMIT_AT)])).toBeNull();
    expect(() => lastContentCommitAt([content('yesterday')])).toThrow('invalid commit time: yesterday');
  });
});
