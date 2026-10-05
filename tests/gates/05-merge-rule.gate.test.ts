/**
 * Gate 5 — the merge rule (L-028, decision 003) as a readable decision table.
 *
 * Each row is one PR situation: the gate results, the facts the CI job gathers about the PR and
 * the decision `decide` must return. The verifier records are built from the real seed passage
 * (passages/MT.20.1-16.json): one record per claim, with the generator's own `sensitive` flag.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import type { GateResult, PullRequestFacts } from '@lectio/gates';

import {
  APPROVAL_COMMIT_AT,
  APPROVED_AT,
  CONTENT_COMMIT_AT,
  DETERMINISTIC_PASS,
  LATER_CONTENT_COMMIT_AT,
  MAIN_TIP_SHA,
  OTHER_SHA,
  PARENT_SHA,
  RUN_ID,
  PASSAGE,
  approvalCommit,
  failResult,
  flagResult,
  prFacts,
  skippedResult,
  verdict,
  verifierResult,
} from '../../packages/gates/src/merge-rule/fixtures/facts.ts';
import {
  UNSEEN_COMMIT_AT,
  decide,
  lastContentCommitAt,
  mergeRuleGate,
} from '../../packages/gates/src/merge-rule/index.ts';
import type {
  ClaimRef,
  Decision,
  HeadObservation,
  PullRequestCommit,
  VerifierClaimRecord,
} from '../../packages/gates/src/merge-rule/index.ts';
import { REPO_ROOT, contentContext, gateTest } from './helpers/gate-test.ts';

interface SeedPassage {
  readonly review: { readonly status: string };
  readonly claims: readonly { readonly id: string; readonly sensitive: boolean }[];
}

const seed = JSON.parse(readFileSync(join(REPO_ROOT, PASSAGE), 'utf8')) as SeedPassage;

/** Both verifiers support every seed claim at 0.95 / 0.92; the generator's flags are kept. */
function seedClaims(edit: (record: VerifierClaimRecord) => VerifierClaimRecord = (record) => record) {
  return seed.claims.map((claim) =>
    edit({
      file: PASSAGE,
      claimId: claim.id,
      sensitive: claim.sensitive,
      confirmer: verdict({ support: 0.95 }),
      refuter: verdict({ support: 0.92 }),
    }),
  );
}

/** The seed claims with the generator's sensitive flags cleared, so perfect scores can auto-merge. */
const plainClaims = () => seedClaims((record) => ({ ...record, sensitive: false }));

const perfect = (claims = plainClaims()): GateResult[] => [...DETERMINISTIC_PASS, verifierResult(claims)];

const config: LectioConfig = loadConfig(undefined, { cwd: REPO_ROOT });

/** Every seed claim: auto-merge needs a verifier record for each. */
const seedRefs: readonly ClaimRef[] = seed.claims.map((claim) => ({ file: PASSAGE, claimId: claim.id }));

// PR commits and when GitHub saw each head (server time; git dates are not an input).
const APPROVAL_SHA = 'd'.repeat(40);
const EARLY_SHA = 'e'.repeat(40);
const LATE_SHA = 'f'.repeat(40);
const contentCommit = (sha: string, parent?: string, message = 'Edit MT.20.1-16'): PullRequestCommit => ({
  sha,
  parents: parent === undefined ? [] : [parent],
  message,
  authorIsBot: false,
  signatureVerified: false,
});
const approvalCommitOnList = (sha: string, parent: string): PullRequestCommit => ({
  sha,
  parents: [parent],
  message: `Approve MT.20.1-16\n\nLectio-Approval: human run=${RUN_ID} head=${PARENT_SHA}`,
  authorIsBot: true,
  signatureVerified: true,
});
const seen = (sha: string, seenAt: string): HeadObservation => ({ sha, seenAt });

const label = { handle: 'nyabongo', via: 'label', at: APPROVED_AT } as const;
const comment = { handle: 'nyabongo', via: 'comment', at: APPROVED_AT } as const;

interface Row {
  readonly results: readonly GateResult[];
  readonly pr?: Partial<PullRequestFacts>;
  readonly config?: LectioConfig;
  readonly decision: Decision;
  /** A reason the decision must give (substring). */
  readonly because?: string;
  /** The PR touches .github/**: the merge job must leave the merge to a maintainer. */
  readonly manualMerge?: true;
}

const TABLE: Record<string, Row> = {
  // auto-merge
  'perfect scores on the seed claims, passages only → auto-merge': {
    results: perfect(),
    decision: 'auto-merge',
  },

  // approved-commit
  'valid approval commit at head → approved-commit with verifiers skipped': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: { approvalCommit: approvalCommit(), reviewEdits: [PASSAGE] },
    decision: 'approved-commit',
  },
  'approval by comment (issue_comment run on main’s tip, trailer head = parent) → approved-commit': {
    results: DETERMINISTIC_PASS,
    pr: {
      approval: comment,
      reviewEdits: [PASSAGE],
      approvalCommit: approvalCommit({ run: { event: 'issue_comment', headSha: MAIN_TIP_SHA } }),
    },
    decision: 'approved-commit',
  },
  'valid approval commit on a .github/** PR → approved-commit, merged by hand (manualMerge)': {
    results: DETERMINISTIC_PASS,
    pr: { files: [PASSAGE, '.github/workflows/content-gates.yml'], approvalCommit: approvalCommit() },
    decision: 'approved-commit',
    manualMerge: true,
  },
  'issue_comment approval whose commit landed on a moved branch (trailer head = decided SHA ≠ parent) → blocked': {
    results: DETERMINISTIC_PASS,
    pr: {
      approval: comment,
      approvalCommit: approvalCommit({
        trailerHead: PARENT_SHA, // the SHA the approval was decided on
        parentSha: OTHER_SHA, // a push landed during the run
        run: { event: 'issue_comment', headSha: MAIN_TIP_SHA },
      }),
    },
    decision: 'blocked',
    because: "is not the commit's parent",
  },
  'valid approval commit but a deterministic gate failed → blocked': {
    results: [failResult('schema')],
    pr: { approvalCommit: approvalCommit() },
    decision: 'blocked',
    because: 'the schema gate failed',
  },

  // forged approval commits
  'forged trailer: non-bot author → blocked': {
    results: perfect(),
    pr: { approvalCommit: approvalCommit({ authorIsBot: false }) },
    decision: 'blocked',
    because: 'not authored by github-actions[bot]',
  },
  'forged trailer: unsigned → blocked': {
    results: perfect(),
    pr: { approvalCommit: approvalCommit({ signatureVerified: false }) },
    decision: 'blocked',
    because: 'signature is not verified',
  },
  'forged trailer: run for another PR → blocked': {
    results: perfect(),
    pr: { approvalCommit: approvalCommit({ run: { prNumber: 7 } }) },
    decision: 'blocked',
    because: 'belongs to PR #7',
  },
  'forged trailer: trailer head ≠ parent → blocked': {
    results: perfect(),
    pr: { approvalCommit: approvalCommit({ trailerHead: OTHER_SHA }) },
    decision: 'blocked',
    because: "is not the commit's parent",
  },
  'forged trailer: pull_request run whose head SHA ≠ parent → blocked': {
    results: perfect(),
    pr: { approvalCommit: approvalCommit({ run: { event: 'pull_request', headSha: OTHER_SHA } }) },
    decision: 'blocked',
    because: 'not on the parent',
  },
  'forged trailer: run of another workflow → blocked': {
    results: perfect(),
    pr: { approvalCommit: approvalCommit({ run: { workflow: 'ci.yml' } }) },
    decision: 'blocked',
    because: 'not content-gates.yml',
  },

  // review blocks
  'hand-edited `status: approved` without approval → blocked': {
    results: perfect(),
    pr: { reviewEdits: [PASSAGE] },
    decision: 'blocked',
    because: 'sets its review block to approved without a verified approval',
  },
  'hand-edited `status: approved` with a stale approval → blocked': {
    results: perfect(),
    pr: { reviewEdits: [PASSAGE], approval: label, lastContentCommitAt: LATER_CONTENT_COMMIT_AT },
    decision: 'blocked',
  },

  // human approval
  'author == reviewer approves via label → human-approved': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: { approval: label },
    decision: 'human-approved',
  },
  'approval by /approve comment on a flagged PR → human-approved': {
    results: [...DETERMINISTIC_PASS, verifierResult(seedClaims())],
    pr: { approval: comment },
    decision: 'human-approved',
  },
  'approval before a new content commit → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: { approval: label, lastContentCommitAt: LATER_CONTENT_COMMIT_AT },
    decision: 'needs-review',
    because: 'not after the last content commit',
  },
  'the merge-rule approval commit after an approval is not a new content commit → still human-approved': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: {
      approval: label, // 10:05
      reviewEdits: [PASSAGE],
      lastContentCommitAt: lastContentCommitAt(
        [contentCommit(PARENT_SHA), approvalCommitOnList(APPROVAL_SHA, PARENT_SHA)],
        [seen(PARENT_SHA, CONTENT_COMMIT_AT), seen(APPROVAL_SHA, APPROVAL_COMMIT_AT)],
      ),
    },
    decision: 'human-approved',
  },
  'backdated commit (GIT_COMMITTER_DATE 09:00) pushed after the approval → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: {
      approval: label, // 10:05
      // Git dates are not an input at all: only when GitHub saw each head counts.
      lastContentCommitAt: lastContentCommitAt(
        // Date-sorted list: the backdated commit sorts before its parent.
        [contentCommit(LATE_SHA, PARENT_SHA, 'backdated to 09:00'), contentCommit(PARENT_SHA)],
        [seen(PARENT_SHA, CONTENT_COMMIT_AT), seen(LATE_SHA, LATER_CONTENT_COMMIT_AT)],
      ),
    },
    decision: 'needs-review',
    because: `not after the last content commit at ${LATER_CONTENT_COMMIT_AT}`,
  },
  'review repro: date-sorted list, backdated commit on an unmerged approval commit, re-approval → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: {
      approval: { ...label, at: '2026-10-05T09:40:00Z' }, // re-approval
      // C1 content; X1 an approval commit on C1 seen by a labeled run at 09:35; C2 pushed on X1 at
      // 10:10, committer date backdated to 09:00, so a date-sorted list is [C1, C2, X1].
      lastContentCommitAt: lastContentCommitAt(
        [
          contentCommit(PARENT_SHA),
          contentCommit(LATE_SHA, APPROVAL_SHA),
          approvalCommitOnList(APPROVAL_SHA, PARENT_SHA),
        ],
        [
          seen(PARENT_SHA, '2026-10-05T09:30:00Z'),
          seen(APPROVAL_SHA, '2026-10-05T09:35:00Z'),
          seen(LATE_SHA, LATER_CONTENT_COMMIT_AT),
        ],
      ),
    },
    decision: 'needs-review',
    because: `not after the last content commit at ${LATER_CONTENT_COMMIT_AT}`,
  },
  'commit made before the approval but pushed after it (with a newer one) → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: {
      approval: label, // 10:05
      // c2 was committed locally at 10:01 and pushed at 10:10 together with c3; c2 is never a head.
      lastContentCommitAt: lastContentCommitAt(
        [
          contentCommit(PARENT_SHA),
          contentCommit(EARLY_SHA, PARENT_SHA, 'committed 10:01'),
          contentCommit(LATE_SHA, EARLY_SHA),
        ],
        [seen(PARENT_SHA, CONTENT_COMMIT_AT), seen(LATE_SHA, LATER_CONTENT_COMMIT_AT)],
      ),
    },
    decision: 'needs-review',
    because: `not after the last content commit at ${LATER_CONTENT_COMMIT_AT}`,
  },
  'current head not yet seen by GitHub → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: {
      approval: label,
      lastContentCommitAt: lastContentCommitAt(
        [contentCommit(PARENT_SHA), contentCommit(LATE_SHA, PARENT_SHA)],
        [seen(PARENT_SHA, CONTENT_COMMIT_AT)],
      ),
    },
    decision: 'needs-review',
    because: `not after the last content commit at ${UNSEEN_COMMIT_AT}`,
  },
  'approval from a handle not in config.reviewer.githubHandles → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: { approval: { ...label, handle: 'someone-else' } },
    decision: 'needs-review',
    because: 'not a handle in config.reviewer.githubHandles',
  },

  // needs-review
  'protected path (config/**) with perfect scores → needs-review': {
    results: perfect(),
    pr: { files: [PASSAGE, 'config/lectio.config.json'] },
    decision: 'needs-review',
    because: 'config/lectio.config.json is under config/**',
  },
  'protected path (packages/gates/**) with perfect scores and passagesOnly off → needs-review': {
    results: perfect(),
    pr: { files: [PASSAGE, 'packages/gates/src/merge-rule/index.ts'] },
    config: { ...config, autoMerge: { ...config.autoMerge, passagesOnly: false } },
    decision: 'needs-review',
    because: 'under packages/gates/**',
  },
  'protected path (.github/**) with perfect scores → needs-review, merged by hand (manualMerge)': {
    results: perfect(),
    pr: { files: ['.github/workflows/content-gates.yml'] },
    decision: 'needs-review',
    because: 'under .github/**',
    manualMerge: true,
  },
  'generator-sensitive seed claims (c5, c18, c22) → needs-review': {
    results: perfect(seedClaims()),
    decision: 'needs-review',
    because: 'claim c5 (passages/MT.20.1-16.json) is flagged sensitive by the generator',
  },
  'verifier-only sensitive flag → needs-review': {
    results: perfect(
      plainClaims().map((record) =>
        record.claimId === 'c3' ? { ...record, refuter: verdict({ support: 0.92, sensitive: true }) } : record,
      ),
    ),
    decision: 'needs-review',
    because: 'claim c3 (passages/MT.20.1-16.json) is flagged sensitive by the refuter',
  },
  'one claim at 0.89 from the refuter → needs-review': {
    results: perfect(
      plainClaims().map((record) =>
        record.claimId === 'c7' ? { ...record, refuter: verdict({ support: 0.89 }) } : record,
      ),
    ),
    decision: 'needs-review',
    because: 'refuter support 0.89 is below 0.9',
  },
  'verifiers left out one seed claim (c24), perfect scores on the rest → needs-review': {
    results: perfect(plainClaims().filter((record) => record.claimId !== 'c24')),
    decision: 'needs-review',
    because: 'claim c24 (passages/MT.20.1-16.json) has no verifier record',
  },
  'one refutation → needs-review': {
    results: perfect(
      plainClaims().map((record) =>
        record.claimId === 'c1' ? { ...record, refuter: verdict({ verdict: 'refuted', support: 0.95 }) } : record,
      ),
    ),
    decision: 'needs-review',
    because: '1 refuted verdict',
  },
  'verifiers skipped (no keys) → needs-review': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    decision: 'needs-review',
    because: 'the verifiers were skipped',
  },
  'a gate flag (print source) → needs-review': {
    results: [
      DETERMINISTIC_PASS[0] as GateResult,
      flagResult('evidence'),
      DETERMINISTIC_PASS[2] as GateResult,
      verifierResult(plainClaims()),
    ],
    decision: 'needs-review',
    because: 'the evidence gate flagged 1 finding',
  },
  'a calendar file next to the passage (passagesOnly) → needs-review': {
    results: perfect(),
    pr: { files: [PASSAGE, 'calendar/2026.json'] },
    decision: 'needs-review',
    because: 'calendar/2026.json is outside passages/',
  },
  'autoMerge.enabled false → needs-review': {
    results: perfect(),
    config: { ...config, autoMerge: { ...config.autoMerge, enabled: false } },
    decision: 'needs-review',
    because: 'autoMerge.enabled is false',
  },
  'perfect scores from fake verifier clients (meta.fake) → needs-review': {
    results: [...DETERMINISTIC_PASS, { ...verifierResult(plainClaims()), meta: { fake: true, claims: plainClaims() } }],
    decision: 'needs-review',
    because: 'the verdicts came from fake verifier clients',
  },
  '.github/** change approved by a reviewer → human-approved, merged by hand (manualMerge)': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: { files: [PASSAGE, '.github/workflows/content-gates.yml'], approval: label },
    decision: 'human-approved',
    manualMerge: true,
  },
  'config/** change approved by a reviewer → human-approved, the merge job may merge': {
    results: [...DETERMINISTIC_PASS, skippedResult('verifiers')],
    pr: { files: [PASSAGE, 'config/lectio.config.json'], approval: label },
    decision: 'human-approved',
  },
  'fork PR approved by a reviewer → human-approved': {
    results: perfect(),
    pr: { fork: true, approval: comment },
    decision: 'human-approved',
  },
  'fork PR with perfect scores → needs-review': {
    results: perfect(),
    pr: { fork: true },
    decision: 'needs-review',
    because: 'the PR comes from a fork',
  },
  'a failed verifiers gate (provider error) → needs-review, never closed': {
    results: [...DETERMINISTIC_PASS, failResult('verifiers')],
    decision: 'needs-review',
    because: 'the verifiers gate failed',
  },

  // blocked
  'a failed deterministic gate → blocked': {
    results: [failResult('licence'), ...perfect().slice(1)],
    decision: 'blocked',
    because: 'the licence gate failed',
  },
};

describe('merge rule decision table (decision 003)', () => {
  it.each(Object.entries(TABLE))('%s', (_name, row) => {
    const outcome = decide({
      results: row.results,
      config: row.config ?? config,
      pr: prFacts(row.pr),
      claims: seedRefs,
    });
    expect(outcome.decision).toBe(row.decision);
    expect(outcome.manualMerge).toBe(row.manualMerge);
    if (row.because !== undefined) expect(outcome.reasons.join('\n')).toContain(row.because);
  });

  it('the seed note is pending and the repository config matches the recorded defaults', () => {
    expect(seed.review.status).toBe('pending');
    expect(config.autoMerge).toEqual(DEFAULT_CONFIG.autoMerge);
    expect(config.reviewer.githubHandles).toEqual(['nyabongo']);
  });

  it('never returns close', () => {
    for (const row of Object.values(TABLE)) {
      const { decision } = decide({
        results: row.results,
        config: row.config ?? config,
        pr: prFacts(row.pr),
        claims: seedRefs,
      });
      expect(decision).not.toBe('close');
    }
  });
});

describe('the merge-rule gate over the repository content', () => {
  // Fails if a committed passage arrives with an approved review block that no approval wrote.
  gateTest('merge-rule/review-block-approved', { gate: mergeRuleGate, allow: ['info'] });

  it('reads the seed claims from the working tree: perfect scores still flag the sensitive ones', async () => {
    const context = { ...contentContext([PASSAGE]), results: perfect(seedClaims()) };
    const result = await mergeRuleGate.run(context);
    expect(result.status).toBe('flag');
    const sensitive = seed.claims.filter((claim) => claim.sensitive).map((claim) => claim.id);
    expect(result.items.map((item) => [item.ruleId, item.claimId])).toEqual(
      sensitive.map((id) => ['merge-rule/sensitive-claim', id]),
    );
  });

  it('flags a seed claim the verifiers left out', async () => {
    const context = { ...contentContext([PASSAGE]), results: perfect(plainClaims().slice(1)) };
    const result = await mergeRuleGate.run(context);
    expect(result.items.map((item) => [item.ruleId, item.claimId])).toEqual([
      ['merge-rule/every-claim-verified', seed.claims[0]?.id],
    ]);
  });
});
