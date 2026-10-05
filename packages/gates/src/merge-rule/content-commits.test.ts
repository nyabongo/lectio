import { describe, expect, it } from 'vitest';

import {
  UNSEEN_COMMIT_AT,
  headObservationsFromRuns,
  isApprovalCommit,
  lastContentCommitAt,
} from './content-commits.ts';
import type { PullRequestCommit } from './content-commits.ts';
import { PARENT_SHA, RUN_ID } from './fixtures/facts.ts';

const content = (sha: string): PullRequestCommit => ({
  sha,
  message: `Edit ${sha}`,
  authorIsBot: false,
  signatureVerified: false,
});
const approval = (sha: string, overrides: Partial<PullRequestCommit> = {}): PullRequestCommit => ({
  sha,
  message: `Approve\n\nLectio-Approval: human run=${RUN_ID} head=${PARENT_SHA}`,
  authorIsBot: true,
  signatureVerified: true,
  ...overrides,
});
const seen = (sha: string, seenAt: string) => ({ sha, seenAt });

describe('isApprovalCommit', () => {
  it('is a signed bot commit with a well-formed trailer', () => {
    expect(isApprovalCommit(approval('a1'))).toBe(true);
    expect(isApprovalCommit(approval('a1', { authorIsBot: false }))).toBe(false);
    expect(isApprovalCommit(approval('a1', { signatureVerified: false }))).toBe(false);
    expect(isApprovalCommit(content('c1'))).toBe(false);
  });
});

describe('lastContentCommitAt', () => {
  it('is when the head containing the last content commit was first seen', () => {
    const commits = [content('c1'), content('c2')];
    const observations = [
      seen('c2', '2026-10-05T10:10:00Z'),
      seen('c1', '2026-10-05T10:00:00Z'),
      seen('c2', '2026-10-05T10:30:00Z'), // a later run on the same head (e.g. labeled)
    ];
    expect(lastContentCommitAt(commits, observations)).toBe('2026-10-05T10:10:00Z');
  });

  it('dates commits pushed together by the push, whatever their git dates', () => {
    expect(lastContentCommitAt([content('c1'), content('c2')], [seen('c2', '2026-10-05T10:10:00Z')])).toBe(
      '2026-10-05T10:10:00Z',
    );
  });

  it('ignores approval commits', () => {
    const commits = [content('c1'), approval('a1')];
    const observations = [seen('c1', '2026-10-05T10:00:00Z'), seen('a1', '2026-10-05T10:06:00Z')];
    expect(lastContentCommitAt(commits, observations)).toBe('2026-10-05T10:00:00Z');
    expect(lastContentCommitAt([approval('a1')], [])).toBeNull();
    expect(lastContentCommitAt([], [])).toBeNull();
  });

  it('counts a commit that left the head (force push) from its return', () => {
    const observations = [
      seen('c1', '2026-10-05T10:00:00Z'),
      seen('x9', '2026-10-05T10:02:00Z'), // force-pushed to other history
      seen('c1', '2026-10-05T10:10:00Z'), // and back
    ];
    expect(lastContentCommitAt([content('c1')], observations)).toBe('2026-10-05T10:10:00Z');
  });

  it('is unseen when the latest observed head does not contain a content commit', () => {
    expect(lastContentCommitAt([content('c1'), content('c2')], [seen('c1', '2026-10-05T10:00:00Z')])).toBe(
      UNSEEN_COMMIT_AT,
    );
    expect(lastContentCommitAt([content('c1')], [])).toBe(UNSEEN_COMMIT_AT);
  });

  it('throws on an observation that is not a timestamp', () => {
    expect(() => lastContentCommitAt([content('c1')], [seen('c1', 'yesterday')])).toThrow(
      'invalid observation time: yesterday',
    );
  });
});

describe('headObservationsFromRuns', () => {
  it('keeps pull_request runs only', () => {
    const runs = [
      { event: 'pull_request', headSha: 'c1', createdAt: '2026-10-05T10:00:00Z' },
      { event: 'issue_comment', headSha: 'main', createdAt: '2026-10-05T10:05:00Z' },
    ];
    expect(headObservationsFromRuns(runs)).toEqual([seen('c1', '2026-10-05T10:00:00Z')]);
  });
});
