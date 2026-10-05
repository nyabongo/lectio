/**
 * Builders for merge-rule tests: gate results, verifier claim records, PR facts and approval
 * commits. The decision table (tests/gates/05-merge-rule.gate.test.ts) and the unit tests share them.
 */
import type { GateResult } from '../../core/result.ts';
import type { ApprovalCommit } from '../approval.ts';
import type { PullRequestFacts } from '../index.ts';
import type { VerifierClaimRecord, VerifierVerdict } from '../verifiers.ts';

export const PASSAGE = 'passages/MT.20.1-16.json';
export const PR_NUMBER = 42;
/** The content commit an approval commit sits on. */
export const PARENT_SHA = 'a'.repeat(40);
/** Main's tip, which issue_comment runs report as their head SHA. */
export const MAIN_TIP_SHA = 'b'.repeat(40);
export const OTHER_SHA = 'c'.repeat(40);
export const RUN_ID = '9876543210';

export const CONTENT_COMMIT_AT = '2026-10-05T10:00:00Z';
export const APPROVED_AT = '2026-10-05T10:05:00Z';
export const APPROVAL_COMMIT_AT = '2026-10-05T10:06:00Z';
export const LATER_CONTENT_COMMIT_AT = '2026-10-05T10:10:00Z';

export function passResult(gate: string, meta: Record<string, unknown> = {}): GateResult {
  return { gate, status: 'pass', items: [], meta };
}

export function failResult(gate: string): GateResult {
  return {
    gate,
    status: 'fail',
    items: [{ ruleId: `${gate}/broken`, severity: 'error', file: PASSAGE, pointer: '', message: 'broken' }],
    meta: {},
  };
}

export function flagResult(gate: string, meta: Record<string, unknown> = {}): GateResult {
  return {
    gate,
    status: 'flag',
    items: [
      { ruleId: `${gate}/print-source`, severity: 'warning', file: PASSAGE, pointer: '', message: 'print source' },
      { ruleId: `${gate}/note`, severity: 'info', pointer: '', message: 'note' },
    ],
    meta,
  };
}

export function skippedResult(gate: string): GateResult {
  return { gate, status: 'skipped', items: [], meta: { reason: 'no keys' } };
}

export const DETERMINISTIC_PASS: readonly GateResult[] = [
  passResult('schema'),
  passResult('evidence'),
  passResult('licence'),
];

export function verdict(overrides: Partial<VerifierVerdict> = {}): VerifierVerdict {
  return { verdict: 'supported', support: 0.95, sensitive: false, ...overrides };
}

export function claim(claimId: string, overrides: Partial<VerifierClaimRecord> = {}): VerifierClaimRecord {
  return {
    file: PASSAGE,
    claimId,
    sensitive: false,
    confirmer: verdict(),
    refuter: verdict({ support: 0.92 }),
    ...overrides,
  };
}

/** The verifiers gate result carrying `claims` in `meta.claims` (the L-027 contract). */
export function verifierResult(claims: readonly VerifierClaimRecord[]): GateResult {
  return passResult('verifiers', { claims });
}

/** Every gate green and both verifiers sure of `claims`. */
export function greenResults(claims: readonly VerifierClaimRecord[] = [claim('c1'), claim('c2')]): GateResult[] {
  return [...DETERMINISTIC_PASS, verifierResult(claims)];
}

export function prFacts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    files: [PASSAGE],
    reviewEdits: [],
    approval: null,
    approvalCommit: null,
    lastContentCommitAt: CONTENT_COMMIT_AT,
    fork: false,
    number: PR_NUMBER,
    ...overrides,
  };
}

type ApprovalCommitOverrides = Partial<Omit<ApprovalCommit, 'run'>> & {
  readonly run?: Partial<ApprovalCommit['run']>;
};

/** A valid approval commit written by a pull_request run of PR {@link PR_NUMBER}. */
export function approvalCommit(overrides: ApprovalCommitOverrides = {}): ApprovalCommit {
  const { run, ...rest } = overrides;
  return {
    kind: 'human',
    runId: RUN_ID,
    trailerHead: PARENT_SHA,
    parentSha: PARENT_SHA,
    authorIsBot: true,
    signatureVerified: true,
    ...rest,
    run: {
      workflow: '.github/workflows/content-gates.yml',
      prNumber: PR_NUMBER,
      event: 'pull_request',
      headSha: PARENT_SHA,
      ...run,
    },
  };
}
