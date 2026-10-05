/**
 * @lectio/gates: the five pull-request gates as named, self-explaining tests, the runner and
 * `lectio-gates` CLI, the PR-comment renderer and the review helper.
 *
 * A {@link Gate} declares its rules (`defineRule`) and returns one gate result (L-004) from a
 * {@link GateContext}. `runGates` runs them in order; `renderComment` turns the report into the
 * one sticky PR comment; `approveHuman` / `approveAuto` write a passage's review block.
 */
export const packageName = '@lectio/gates';

export { createContext, nodeReadText } from './core/gate.ts';
export type { CreateContextOptions, Gate, GateContext, ReadText } from './core/gate.ts';
export { checkedOutAt, createGit, nodeGitExec, parseNameStatus } from './core/git.ts';
export type { ChangeStatus, ChangedFile, Git, GitExec } from './core/git.ts';
export { COMMENT_MARKER, COMMENT_MARKER_LINE, DEFAULT_MAX_COMMENT_LENGTH, renderComment } from './core/markdown.ts';
export type { RenderOptions } from './core/markdown.ts';
export { finding, formatFinding, resultFromFindings, skipReason, skippedResult, statusOf } from './core/result.ts';
export type { FindingInput, GateResult, GateResultItem, GateStatus, Severity } from './core/result.ts';
export { RUNNER_GATE_ID, RUNNER_RULES, createRuleBook, defineRule, gateOfRule } from './core/rules.ts';
export type { Rule, RuleBook } from './core/rules.ts';
export { REPORT_VERSION, overallStatus, runGates } from './core/runner.ts';
export type { GateReport } from './core/runner.ts';
export { USAGE, runGatesCli } from './cli/run.ts';
export type { GatesCliOptions } from './cli/run.ts';
export { DECISIONS, GREEN_DECISIONS, decide } from './merge-rule/index.ts';
export type { DecideInput, DecideOutput, Decision } from './merge-rule/index.ts';
export { parsePullRequestFacts, pullRequestFactsProblems } from './core/pull-request.ts';
export type { ApprovalCommit, PullRequestApproval, PullRequestFacts } from './core/pull-request.ts';
export { GATES, GATE_IDS, allRules, ruleBookFor, selectGates } from './registry.ts';
export type { GateId } from './registry.ts';
export {
  ReviewError,
  approveAuto,
  approveHuman,
  autoReview,
  checkVerifierSummary,
  configuredHandle,
  humanReview,
  nodeReviewFs,
  passageContentHash,
  prettierJson,
  reviewTimestamp,
  tempPathFor,
} from './review/approve.ts';
export type {
  ApprovalOutcome,
  ApproveHumanOptions,
  FormatJson,
  HumanApprovalChannel,
  ReviewFs,
  VerifierSummary,
  WriteOptions,
} from './review/approve.ts';
export { APPROVE_USAGE, runApprove } from './review/run.ts';
export type { ApproveCliOptions } from './review/run.ts';
