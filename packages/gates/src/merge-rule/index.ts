/**
 * Gate `merge-rule` (Merge rule) and the decision function behind `lectio-gates decide`
 * ([decision 003](../../../../docs/decisions/003-auto-merge.md)).
 *
 * `decide({ results, config, pr })` is pure. It reads the gate results, `config.autoMerge` and
 * `config.reviewer`, and the facts the CI job (L-031) gathers about the PR, and returns one
 * decision with its reasons, checked in this order:
 *
 * 1. `blocked` when a deterministic gate failed.
 * 2. `approved-commit` when the head is a valid approval commit (verifier results not needed);
 *    `blocked` when it carries a `Lectio-Approval` trailer that fails the validity rule (forged).
 * 3. `blocked` when the PR sets a review block to approved without a verified approval.
 * 4. `human-approved` when a configured reviewer (the PR author included) approved by label or
 *    comment after the last content commit.
 * 5. `needs-review` when any review condition holds (protected path, auto-merge disabled,
 *    verifiers skipped or unreadable, low support, refutations, sensitive claims, gate flags,
 *    files outside passages/, fork PR, a deterministic gate that did not run).
 * 6. `auto-merge` otherwise. It never returns `close`.
 */
import { posix } from 'node:path';

import type { LectioConfig } from '@lectio/config';

import type { Gate, GateContext } from '../core/gate.ts';
import type { PullRequestApproval, PullRequestFacts } from '../core/pull-request.ts';
import { finding, resultFromFindings } from '../core/result.ts';
import type { GateResult, Severity } from '../core/result.ts';
import { defineRule } from '../core/rules.ts';
import type { Rule } from '../core/rules.ts';
import { approvalCommitProblems } from './approval.ts';
import { UNREADABLE_CLAIMS, changedClaims } from './claims.ts';
import type { ClaimRef } from './claims.ts';
import { approvedReviewEdits } from './review-edits.ts';
import { VERIFIER_ROLES, readVerifierClaims } from './verifiers.ts';

export {
  APPROVAL_RUN_EVENTS,
  APPROVAL_TRAILER_KEY,
  APPROVAL_WORKFLOW,
  approvalCommitProblems,
  formatApprovalTrailer,
  parseApprovalTrailer,
} from './approval.ts';
export type { ApprovalKind, ApprovalTrailer } from './approval.ts';
export { UNREADABLE_CLAIMS, changedClaims } from './claims.ts';
export type { ClaimRef } from './claims.ts';
export {
  UNSEEN_COMMIT_AT,
  headObservationsFromRuns,
  isApprovalCommit,
  lastContentCommitAt,
} from './content-commits.ts';
export type { HeadObservation, ObservedRun, PullRequestCommit } from './content-commits.ts';
export { approvedReviewEdits } from './review-edits.ts';
export { VERDICTS, VERIFIER_ROLES, readVerifierClaims } from './verifiers.ts';
export type {
  ReadVerifierClaims,
  Verdict,
  VerifierClaimRecord,
  VerifierMeta,
  VerifierRole,
  VerifierVerdict,
} from './verifiers.ts';

export const MERGE_RULE_GATE_ID = 'merge-rule';
export const VERIFIERS_GATE_ID = 'verifiers';

/** The deterministic gates; each must run and pass before a PR can auto-merge. */
export const DETERMINISTIC_GATE_IDS = ['schema', 'evidence', 'licence'] as const;

/** Hard rule, not configurable: a PR touching these paths is never auto-merged. */
export const PROTECTED_PATH_PREFIXES = ['packages/gates/', '.github/', 'config/'] as const;

export const DECISIONS = ['approved-commit', 'blocked', 'human-approved', 'auto-merge', 'needs-review'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Decisions after which the merge-rule job ends green. */
export const GREEN_DECISIONS: ReadonlySet<Decision> = new Set(['approved-commit', 'human-approved', 'auto-merge']);

export interface DecideInput {
  readonly results: readonly GateResult[];
  readonly config: LectioConfig;
  readonly pr: PullRequestFacts;
  /**
   * Every claim of the changed passages at the PR head (`changedClaims`). Auto-merge needs a
   * verifier record for each one.
   */
  readonly claims: readonly ClaimRef[];
}

export interface DecideOutput {
  readonly decision: Decision;
  readonly reasons: readonly string[];
  /**
   * The PR changes `.github/**`: whatever the decision, the merge job (L-031) must not merge it or
   * dispatch workflows; a maintainer merges it by hand after approval. Omitted when false.
   * This flag is the only safeguard for such PRs: a `pull_request` (or dispatched) run executes the
   * PR branch's own content-gates.yml, so a PR that edits it can mint a bot-signed approval commit
   * that passes the validity rule. `decide` cannot tell, so L-031 must honour this flag.
   */
  readonly manualMerge?: true;
}

export const MERGE_RULES = {
  deterministicPass: defineRule(
    'merge-rule/deterministic-gates-pass',
    'The deterministic gates (schema, evidence, licence) must not fail.',
    'Fix the findings of the failed gate and push; the PR is decided again.',
  ),
  approvalCommitValid: defineRule(
    'merge-rule/approval-commit-valid',
    'A Lectio-Approval commit must be signed by github-actions[bot] from a content-gates.yml run for this PR, with trailer head equal to its parent.',
    'Drop the commit: only the merge-rule job writes approval commits. Approve with the label or /approve instead.',
  ),
  reviewBlockApproved: defineRule(
    'merge-rule/review-block-approved',
    'A review block is set to approved only with a configured reviewer’s approval or a valid approval commit.',
    'Restore the pending review block; a reviewer approves with the label or /approve and the merge-rule job writes the block.',
  ),
  approvedCommit: defineRule(
    'merge-rule/approved-commit',
    'A valid approval commit at the head means the PR was approved; nothing more is decided.',
    'Nothing to fix.',
  ),
  humanApproval: defineRule(
    'merge-rule/human-approval',
    'A configured reviewer’s label or /approve comment after the last content commit approves the PR.',
    'Ask a reviewer in config.reviewer.githubHandles to approve again after the last content commit.',
  ),
  autoMerge: defineRule(
    'merge-rule/auto-merge',
    'A PR auto-merges when every gate passes, both verifiers support every claim at autoMerge.minSupport and nothing is refuted.',
    'Nothing to fix.',
  ),
  protectedPath: defineRule(
    'merge-rule/protected-path',
    'A PR that changes packages/gates/**, .github/** or config/** always needs a person (not configurable).',
    'Ask a reviewer to approve, or split the content change from the code or config change.',
  ),
  autoMergeEnabled: defineRule(
    'merge-rule/auto-merge-enabled',
    'Auto-merge happens only while autoMerge.enabled is true.',
    'Ask a reviewer to approve.',
  ),
  deterministicRan: defineRule(
    'merge-rule/deterministic-gates-ran',
    'Every deterministic gate (schema, evidence, licence) must run before a PR can auto-merge.',
    'Re-run the gates so each deterministic gate reports a result, or ask a reviewer to approve.',
  ),
  verifiersRan: defineRule(
    'merge-rule/verifiers-ran',
    'The verifiers must run and report readable per-claim scores before a PR can auto-merge.',
    'Re-run the gates with both verifier keys configured, or ask a reviewer to approve.',
  ),
  everyClaimVerified: defineRule(
    'merge-rule/every-claim-verified',
    'The verifiers report a record for every claim of every changed passage.',
    'Re-run the verifiers so they check every claim, or ask a reviewer to approve.',
  ),
  liveVerifiers: defineRule(
    'merge-rule/live-verifiers',
    'Verdicts from fake verifier clients (meta.fake) never auto-merge a PR.',
    'Re-run the gates with live verifier clients (both keys configured), or ask a reviewer to approve.',
  ),
  bothVerifiers: defineRule(
    'merge-rule/both-verifiers',
    'With autoMerge.requireBothVerifiers, the confirmer and the refuter both give a verdict on every claim.',
    'Re-run the verifiers, or ask a reviewer to approve.',
  ),
  claimSupport: defineRule(
    'merge-rule/claim-support',
    'Each verifier supports every claim at autoMerge.minSupport or higher.',
    'Strengthen the claim’s sources or wording and push, or ask a reviewer to approve.',
  ),
  verdictSupported: defineRule(
    'merge-rule/verdict-supported',
    'Each verifier’s verdict on every claim is "supported".',
    'Fix the claim the verifier could not support and push, or ask a reviewer to approve.',
  ),
  noRefutations: defineRule(
    'merge-rule/no-refutations',
    'No more claims are refuted than autoMerge.maxRefutations allows.',
    'Correct or remove the refuted claims and push, or ask a reviewer to approve.',
  ),
  sensitiveClaim: defineRule(
    'merge-rule/sensitive-claim',
    'With autoMerge.sensitiveClaimsRequireReview, a claim flagged sensitive by the generator or either verifier needs a person.',
    'Ask a reviewer to approve.',
  ),
  noFlags: defineRule(
    'merge-rule/no-flags',
    'With autoMerge.flagsRequireReview, a gate flag needs a person.',
    'Resolve the flagged findings and push, or ask a reviewer to approve.',
  ),
  passagesOnly: defineRule(
    'merge-rule/passages-only',
    'With autoMerge.passagesOnly, only PRs that change nothing outside passages/ can auto-merge.',
    'Ask a reviewer to approve, or split the passage change from the rest.',
  ),
  sameRepository: defineRule(
    'merge-rule/same-repository',
    'A PR from a fork always needs a person.',
    'Ask a reviewer to approve.',
  ),
  approvalCounted: defineRule(
    'merge-rule/approval-counted',
    'An approval counts only from a handle in config.reviewer.githubHandles, made after the last content commit.',
    'Ask a configured reviewer to approve again after the last content commit.',
  ),
} as const;

/** One reason for a decision, with the rule it applies. */
export interface DecisionReason {
  readonly rule: Rule;
  readonly message: string;
  readonly file?: string;
  readonly claimId?: string;
  /** Only for context notes (an ignored approval); otherwise the decision sets the severity. */
  readonly severity?: Severity;
}

export interface Assessment {
  readonly decision: Decision;
  readonly reasons: readonly DecisionReason[];
}

const normalizePath = (path: string): string => path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/** The passages directory under the content root, with a trailing slash (`passages/`). */
function passagesPrefix(config: LectioConfig): string {
  const dir = normalizePath(posix.join(normalizePath(config.content.root), 'passages'));
  return `${dir}/`;
}

const sameHandle = (a: string, b: string): boolean =>
  a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();

type ApprovalCheck =
  | { readonly counts: true; readonly reason: DecisionReason }
  | { readonly counts: false; readonly note: DecisionReason };

function checkApproval(approval: PullRequestApproval, pr: PullRequestFacts, config: LectioConfig): ApprovalCheck {
  const rule = MERGE_RULES.approvalCounted;
  const who = `@${approval.handle.replace(/^@/, '')}`;
  const ignored = (why: string): ApprovalCheck => ({
    counts: false,
    note: { rule, severity: 'info', message: `approval by ${who} via ${approval.via} ignored: ${why}` },
  });
  if (!config.reviewer.githubHandles.some((handle) => sameHandle(handle, approval.handle)))
    return ignored('not a handle in config.reviewer.githubHandles');
  const at = Date.parse(approval.at);
  if (Number.isNaN(at)) return ignored(`its time "${approval.at}" is not a timestamp`);
  if (pr.lastContentCommitAt !== null) {
    const last = Date.parse(pr.lastContentCommitAt);
    if (Number.isNaN(last))
      return ignored(`the last content commit time "${pr.lastContentCommitAt}" is not a timestamp`);
    if (at <= last)
      return ignored(`given at ${approval.at}, not after the last content commit at ${pr.lastContentCommitAt}`);
  }
  return {
    counts: true,
    reason: {
      rule: MERGE_RULES.humanApproval,
      message: `approved by ${who} via ${approval.via} at ${approval.at}, after the last content commit`,
    },
  };
}

function reviewConditions(input: DecideInput, results: readonly GateResult[]): DecisionReason[] {
  const { config, pr } = input;
  const auto = config.autoMerge;
  const reasons: DecisionReason[] = [];
  const files = [...new Set(pr.files.map(normalizePath))];

  for (const file of files) {
    const prefix = PROTECTED_PATH_PREFIXES.find((protectedPrefix) => file.startsWith(protectedPrefix));
    if (prefix !== undefined)
      reasons.push({
        rule: MERGE_RULES.protectedPath,
        file,
        message: `${file} is under ${prefix}** (never auto-merged)`,
      });
  }
  if (!auto.enabled) reasons.push({ rule: MERGE_RULES.autoMergeEnabled, message: 'autoMerge.enabled is false' });

  for (const id of DETERMINISTIC_GATE_IDS) {
    const result = results.find((candidate) => candidate.gate === id);
    if (result === undefined || result.status === 'skipped')
      reasons.push({ rule: MERGE_RULES.deterministicRan, message: `the ${id} gate did not run` });
  }

  reasons.push(...verifierConditions(input, results));

  if (auto.flagsRequireReview) {
    for (const result of results) {
      if (result.status !== 'flag') continue;
      const count = result.items.filter((item) => item.severity !== 'info').length;
      reasons.push({
        rule: MERGE_RULES.noFlags,
        message: `the ${result.gate} gate flagged ${String(count)} finding${count === 1 ? '' : 's'}`,
      });
    }
  }

  if (auto.passagesOnly) {
    const passages = passagesPrefix(config);
    for (const file of files) {
      if (!file.startsWith(passages))
        reasons.push({ rule: MERGE_RULES.passagesOnly, file, message: `${file} is outside ${passages}` });
    }
  }

  if (pr.fork) reasons.push({ rule: MERGE_RULES.sameRepository, message: 'the PR comes from a fork' });
  return reasons;
}

function verifierConditions(input: DecideInput, results: readonly GateResult[]): DecisionReason[] {
  const auto = input.config.autoMerge;
  const result = results.find((candidate) => candidate.gate === VERIFIERS_GATE_ID);
  if (result === undefined || result.status === 'skipped')
    return [{ rule: MERGE_RULES.verifiersRan, message: 'the verifiers were skipped' }];
  if (result.status === 'fail') return [{ rule: MERGE_RULES.verifiersRan, message: 'the verifiers gate failed' }];
  if (result.meta['fake'] === true)
    return [{ rule: MERGE_RULES.liveVerifiers, message: 'the verdicts came from fake verifier clients' }];
  const read = readVerifierClaims(result.meta);
  if (!read.ok) return [{ rule: MERGE_RULES.verifiersRan, message: read.error }];
  if (read.claims.length === 0) return [{ rule: MERGE_RULES.verifiersRan, message: 'the verifiers checked no claims' }];

  const reasons: DecisionReason[] = [];
  const recorded = new Set(read.claims.map((claim) => `${claim.file}\0${claim.claimId}`));
  for (const expected of input.claims) {
    if (!recorded.has(`${expected.file}\0${expected.claimId}`))
      reasons.push({
        rule: MERGE_RULES.everyClaimVerified,
        file: expected.file,
        ...(expected.claimId === UNREADABLE_CLAIMS ? {} : { claimId: expected.claimId }),
        message: `claim ${expected.claimId} (${expected.file}) has no verifier record`,
      });
  }
  let refutations = 0;
  for (const claim of read.claims) {
    const at = { file: claim.file, claimId: claim.claimId };
    const label = `claim ${claim.claimId} (${claim.file})`;
    const sensitiveBy: string[] = claim.sensitive ? ['the generator'] : [];
    const verdicts = VERIFIER_ROLES.map((role) => [role, claim[role]] as const);
    if (verdicts.every(([, verdict]) => verdict === null))
      reasons.push({ rule: MERGE_RULES.verifiersRan, ...at, message: `${label} has no verifier verdict` });
    for (const [role, verdict] of verdicts) {
      if (verdict === null) {
        if (auto.requireBothVerifiers)
          reasons.push({ rule: MERGE_RULES.bothVerifiers, ...at, message: `${label} has no ${role} verdict` });
        continue;
      }
      if (verdict.support < auto.minSupport)
        reasons.push({
          rule: MERGE_RULES.claimSupport,
          ...at,
          message: `${label}: ${role} support ${String(verdict.support)} is below ${String(auto.minSupport)}`,
        });
      if (verdict.verdict === 'refuted') refutations += 1;
      else if (verdict.verdict !== 'supported')
        reasons.push({
          rule: MERGE_RULES.verdictSupported,
          ...at,
          message: `${label}: ${role} verdict is ${verdict.verdict}`,
        });
      if (verdict.sensitive) sensitiveBy.push(`the ${role}`);
    }
    if (auto.sensitiveClaimsRequireReview && sensitiveBy.length > 0)
      reasons.push({
        rule: MERGE_RULES.sensitiveClaim,
        ...at,
        message: `${label} is flagged sensitive by ${sensitiveBy.join(' and ')}`,
      });
  }
  if (refutations > auto.maxRefutations)
    reasons.push({
      rule: MERGE_RULES.noRefutations,
      message: `${String(refutations)} refuted verdict${refutations === 1 ? '' : 's'}, more than autoMerge.maxRefutations (${String(auto.maxRefutations)})`,
    });
  return reasons;
}

function autoMergeReason(results: readonly GateResult[], config: LectioConfig): DecisionReason {
  const verifiers = results.find((result) => result.gate === VERIFIERS_GATE_ID) as GateResult;
  const read = readVerifierClaims(verifiers.meta) as { claims: readonly unknown[] };
  return {
    rule: MERGE_RULES.autoMerge,
    message: `every gate passed and both verifiers support all ${String(read.claims.length)} claims at ${String(config.autoMerge.minSupport)} or higher, with no refutation`,
  };
}

/** The decision with structured reasons (rule, file, claim); `decide` flattens the reasons to text. */
export function assess(input: DecideInput): Assessment {
  const { config, pr } = input;
  const results = input.results.filter((result) => result.gate !== MERGE_RULE_GATE_ID);

  const failed = results.filter((result) => result.gate !== VERIFIERS_GATE_ID && result.status === 'fail');
  const blocked: DecisionReason[] = failed.map((result) => ({
    rule: MERGE_RULES.deterministicPass,
    message: `the ${result.gate} gate failed`,
  }));

  if (pr.approvalCommit !== null) {
    const commit = pr.approvalCommit;
    const problems = approvalCommitProblems(commit, pr.number);
    if (problems.length > 0) {
      blocked.push(
        ...problems.map((problem) => ({
          rule: MERGE_RULES.approvalCommitValid,
          message: `forged approval commit (${commit.kind}, run ${commit.runId}): ${problem}`,
        })),
      );
    } else if (blocked.length === 0) {
      return {
        decision: 'approved-commit',
        reasons: [
          {
            rule: MERGE_RULES.approvedCommit,
            message: `the head is a valid ${commit.kind} approval commit from run ${commit.runId} on ${commit.parentSha}`,
          },
        ],
      };
    }
  }

  const approval = pr.approval === null ? null : checkApproval(pr.approval, pr, config);
  const notes = approval !== null && !approval.counts ? [approval.note] : [];
  if (approval === null || !approval.counts) {
    for (const file of pr.reviewEdits)
      blocked.push({
        rule: MERGE_RULES.reviewBlockApproved,
        file,
        message: `${file} sets its review block to approved without a verified approval or a valid approval commit`,
      });
  }
  if (blocked.length > 0) return { decision: 'blocked', reasons: [...blocked, ...notes] };
  if (approval?.counts === true) return { decision: 'human-approved', reasons: [approval.reason] };

  const review = reviewConditions(input, results);
  if (review.length > 0) return { decision: 'needs-review', reasons: [...review, ...notes] };
  return { decision: 'auto-merge', reasons: [autoMergeReason(results, config)] };
}

/** Paths the merge job never merges by itself, even after approval: a maintainer merges by hand. */
export const MANUAL_MERGE_PATH_PREFIXES = ['.github/'] as const;

/** Whether a PR changing `files` must be merged by hand (it touches `.github/**`). */
export function needsManualMerge(files: readonly string[]): boolean {
  return files.some((file) => MANUAL_MERGE_PATH_PREFIXES.some((prefix) => normalizePath(file).startsWith(prefix)));
}

/** The merge rule: one decision and its reasons for a PR. Pure; never returns `close`. */
export function decide(input: DecideInput): DecideOutput {
  const { decision, reasons } = assess(input);
  return {
    decision,
    reasons: reasons.map((reason) => reason.message),
    ...(needsManualMerge(input.pr.files) ? { manualMerge: true as const } : {}),
  };
}

const SEVERITY: Readonly<Record<Decision, Severity>> = {
  blocked: 'error',
  'needs-review': 'warning',
  'approved-commit': 'info',
  'human-approved': 'info',
  'auto-merge': 'info',
};

/** What `factsFromChanges` reads: the diff and the files on both sides of it. */
export type ChangeView = Pick<GateContext, 'changedFiles' | 'readFile' | 'readBase'>;

/** Every changed path, with the old path of a rename or copy, deduplicated. */
export function changedPaths(changedFiles: ChangeView['changedFiles']): string[] {
  const files = changedFiles.flatMap((file) =>
    file.previousPath === undefined ? [file.path] : [file.previousPath, file.path],
  );
  return [...new Set(files)];
}

/**
 * The PR facts a local run can see: the changed files (old paths of renames included) and the
 * review blocks set to approved, with PR number `number` (0: no PR, so no approval commit is
 * valid). Approvals, approval commits, push times and fork status come from GitHub, so only the CI
 * job (L-031) knows them.
 */
export function factsFromChanges(view: ChangeView, number = 0): PullRequestFacts {
  return {
    number,
    files: changedPaths(view.changedFiles),
    reviewEdits: approvedReviewEdits(view),
    approval: null,
    approvalCommit: null,
    lastContentCommitAt: null,
    fork: false,
  };
}

/** Runs the merge rule over the gates that ran before it and reports the decision and its reasons. */
export function runMergeRule(context: GateContext): GateResult {
  const facts = factsFromChanges(context);
  const { decision, reasons } = assess({
    results: context.results,
    config: context.config,
    pr: facts,
    claims: changedClaims(context),
  });
  const items = reasons.map((reason) =>
    finding(reason.rule, {
      ...(reason.file === undefined ? {} : { file: reason.file }),
      ...(reason.claimId === undefined ? {} : { claimId: reason.claimId }),
      message: reason.message,
      severity: reason.severity ?? SEVERITY[decision],
    }),
  );
  return resultFromFindings(MERGE_RULE_GATE_ID, items, { decision, manualMerge: needsManualMerge(facts.files) });
}

export const mergeRuleGate: Gate = {
  id: MERGE_RULE_GATE_ID,
  title: 'Merge rule',
  rules: Object.values(MERGE_RULES),
  run: runMergeRule,
};
