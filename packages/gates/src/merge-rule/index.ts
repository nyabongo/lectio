/**
 * Gate `merge-rule` (Merge rule) and the decision function behind `lectio-gates decide`
 * ([decision 003](../../../../docs/decisions/003-auto-merge.md)).
 *
 * Stub created by L-023 so the registry, runner and CLI work end to end. L-028 replaces this file,
 * keeping the `mergeRuleGate` and `decide` exports and the input and output shapes below (it may
 * refine them). Until then every PR needs review.
 */
import type { LectioConfig } from '@lectio/config';

import type { Gate } from '../core/gate.ts';
import type { GateResult } from '../core/result.ts';
import { skippedResult } from '../core/result.ts';

export const DECISIONS = ['approved-commit', 'blocked', 'human-approved', 'auto-merge', 'needs-review'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Decisions after which the merge-rule job ends green. */
export const GREEN_DECISIONS: ReadonlySet<Decision> = new Set(['approved-commit', 'human-approved', 'auto-merge']);

/** A reviewer's approval: an `approved` label or `/approve` comment (or the local CLI). */
export interface PullRequestApproval {
  readonly handle: string;
  readonly via: 'cli' | 'label' | 'comment';
  /** ISO timestamp. */
  readonly at: string;
}

/** The head commit when it carries a `Lectio-Approval` trailer. */
export interface ApprovalCommit {
  readonly kind: 'human' | 'auto';
  readonly runId: string;
  readonly trailerHead: string;
  readonly parentSha: string;
  readonly authorIsBot: boolean;
  readonly signatureVerified: boolean;
  readonly run: {
    readonly workflow: string;
    readonly prNumber: number;
    readonly event: string;
    readonly headSha: string;
  };
}

/** What the merge rule knows about the pull request (assembled by the CI job, L-031). */
export interface PullRequestFacts {
  /** Every changed path, repository-relative. */
  readonly files: readonly string[];
  /** Files whose review block the PR changes. */
  readonly reviewEdits: readonly string[];
  readonly approval: PullRequestApproval | null;
  readonly approvalCommit: ApprovalCommit | null;
  /** ISO timestamp of the last commit that changed content (approval commits excluded). */
  readonly lastContentCommitAt: string | null;
  readonly fork: boolean;
}

export interface DecideInput {
  readonly results: readonly GateResult[];
  readonly config: LectioConfig;
  readonly pr: PullRequestFacts;
}

export interface DecideOutput {
  readonly decision: Decision;
  readonly reasons: readonly string[];
}

/** Stub: every PR needs review until L-028. */
export function decide(_input: DecideInput): DecideOutput {
  return { decision: 'needs-review', reasons: ['not implemented (L-028)'] };
}

export const mergeRuleGate: Gate = {
  id: 'merge-rule',
  title: 'Merge rule',
  rules: [],
  run: () => skippedResult('merge-rule', 'not implemented (L-028)'),
};
