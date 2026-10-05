/**
 * The `merge-rule` job of the trusted content-gates.yml (main's copy only). It decides, labels,
 * writes the approval commit, dispatches workflows and reports `merge-rule` as a check run on the
 * PR head (Checks API), green or red. It never merges and never waits for other checks.
 *
 * It runs in two phases, so that the approval artifact is uploaded from inside this run before any
 * commit exists:
 *
 * 1. `decide`: gathers the PR facts (`./facts.ts`) and runs `decide` (L-028) from the tooling
 *    checkout; the PR head is only read, as regular-file blobs, so a PR that edits `decide` or a gate
 *    cannot change its own decision, and a changed symbolic link or submodule fails the run. Upserts
 *    one sticky comment and sets exactly one of `auto-merge-candidate` / `needs-review` /
 *    `gates-failed`. When an approval commit is due it says so (`write`) and names the approval
 *    artifact; otherwise it publishes the check run and is done.
 * 2. `approve` (after the workflow uploaded the artifact): decides again on the same head and, if an
 *    approval commit is still due, writes the review block and one approval commit, dispatches every
 *    registry workflow on the head branch (commits made with GITHUB_TOKEN trigger none) and this
 *    workflow on the default branch, and publishes the check run.
 *
 * On `approved-commit` (the head is a valid approval commit) it publishes a green check and nothing
 * else, which rules out a dispatch loop; the `merge` job then takes over. A PR that changes
 * `.github/**` (`manualMerge`) gets neither an approval commit nor dispatches. A fork PR is
 * report-only: the check run (red) and the job summary, no labels, comments or commits.
 */
import type { LectioConfig } from '@lectio/config';
import { ProviderError } from '@lectio/providers';
import type { CheckConclusion, GitHubClient } from '@lectio/providers';

import { COMMENT_MARKER, renderComment } from '../core/markdown.ts';
import type { PullRequestApproval } from '../core/pull-request.ts';
import type { GateResult } from '../core/result.ts';
import { REPORT_VERSION, nonRegularResult, overallStatus } from '../core/runner.ts';
import type { GateReport } from '../core/runner.ts';
import { APPROVAL_WORKFLOW, GREEN_DECISIONS, decide } from '../merge-rule/index.ts';
import type { Decision, DecideOutput } from '../merge-rule/index.ts';
import { GATES, ruleBookFor } from '../registry.ts';
import type { FormatJson } from '../review/approve.ts';
import { ApprovalCommitError, writeApprovalCommit } from './approval-commit.ts';
import type { PrCheckout } from './checkout.ts';
import { approvalArtifactName, gatherFacts } from './facts.ts';
import type { GatheredFacts } from './facts.ts';
import type { RequiredChecksRegistry } from './registry.ts';

export const DECISION_LABELS = ['auto-merge-candidate', 'needs-review', 'gates-failed'] as const;
export type DecisionLabel = (typeof DECISION_LABELS)[number];

/** The check run the trusted workflow publishes on the PR head (a required check, L-032). */
export const MERGE_RULE_CHECK = 'merge-rule';

/** The one decision label for a decision. A green PR that must be merged by hand needs a person. */
export function labelFor(decision: Decision, manualMerge: boolean): DecisionLabel {
  if (decision === 'blocked') return 'gates-failed';
  if (decision === 'needs-review' || manualMerge) return 'needs-review';
  return 'auto-merge-candidate';
}

export type MergeRulePhase = 'decide' | 'approve';

export interface MergeRuleJobInput {
  readonly phase: MergeRulePhase;
  readonly github: GitHubClient;
  readonly config: LectioConfig;
  readonly checkout: PrCheckout;
  readonly registry: RequiredChecksRegistry;
  readonly prNumber: number;
  /** The head sha this run resolved (`pr-head/` holds it). */
  readonly headSha: string;
  /** The PR's current base, fetched fresh (`origin/<base>`). */
  readonly base: string;
  /** The repository's default branch (main's copy of the workflows lives there). */
  readonly defaultBranch: string;
  readonly runId: string;
  /** Results of this run's deterministic and verifier jobs (a job that did not run is missing). */
  readonly results: readonly GateResult[];
  /** The fetcher note of the deterministic run, if it reported one. */
  readonly note?: string;
  readonly format: FormatJson;
  readonly now: () => Date;
  readonly log: (line: string) => void;
}

export interface MergeRuleJobOutcome {
  /** `null` when nothing was decided (a closed PR, or the head moved since the event). */
  readonly decision: Decision | null;
  readonly manualMerge: boolean;
  readonly exitCode: number;
  readonly summary: string;
  readonly label?: DecisionLabel;
  /** Phase `decide`: an approval commit is due; upload {@link approvalArtifact}, then run `approve`. */
  readonly write: boolean;
  readonly approvalArtifact?: string;
  readonly approvalCommitSha?: string;
  readonly dispatched: readonly string[];
  /** The report to upload as `gates.json` (absent when nothing was decided). */
  readonly report?: DecisionReport;
}

const HEADLINE: Readonly<Record<Decision, string>> = {
  'approved-commit': 'approved; the merge job merges once every required check passes',
  'human-approved': 'approved by a reviewer; writing the approval commit',
  'auto-merge': 'auto-merge; writing the approval commit',
  'needs-review': 'waiting for human review',
  blocked: 'gates failed',
};

function decisionSection(outcome: DecideOutput, notes: readonly string[]): string {
  const lines = [`### Merge rule: \`${outcome.decision}\` (${HEADLINE[outcome.decision]})`, ''];
  for (const reason of outcome.reasons) lines.push(`- ${reason.replace(/\s+/g, ' ')}`);
  if (outcome.manualMerge === true)
    lines.push('- this PR changes `.github/**`: a maintainer merges it by hand after approval');
  for (const note of notes) lines.push(`- ${note}`);
  return lines.join('\n');
}

/** The sticky comment: the gates table and findings, then the decision and its reasons. */
export function renderDecisionComment(
  results: readonly GateResult[],
  outcome: DecideOutput,
  notes: readonly string[],
  head: string,
): string {
  const report: GateReport = {
    reportVersion: REPORT_VERSION,
    status: overallStatus(results),
    base: '',
    head,
    changedFiles: [],
    results,
  };
  const gates = renderComment(report, { gates: GATES, rules: ruleBookFor(GATES) });
  // The head line lets readers of the comment (L-038 fix-up mode) tell a stale comment from a current one.
  const headLine = `Checked head: \`${head}\` ${headMarker(head)}`;
  return `${gates.trimEnd()}\n\n${decisionSection(outcome, notes)}\n\n${headLine}\n`;
}

/** The hidden marker naming the head a comment was written for. */
export function headMarker(head: string): string {
  return `<!-- lectio-gates-head: ${head} -->`;
}

/** The gate report the trusted run uploads as `gates.json`: every result it decided on, the head and the decision. */
export interface DecisionReport extends GateReport {
  readonly decision: DecideOutput;
}

export function decisionReport(
  results: readonly GateResult[],
  outcome: DecideOutput,
  head: string,
  base: string,
  changedFiles: readonly string[],
): DecisionReport {
  return {
    reportVersion: REPORT_VERSION,
    status: overallStatus(results),
    base,
    head,
    changedFiles,
    results,
    decision: outcome,
  };
}

const done = (summary: string): MergeRuleJobOutcome => ({
  decision: null,
  manualMerge: false,
  exitCode: 0,
  summary,
  write: false,
  dispatched: [],
});

interface Decided {
  readonly gathered: GatheredFacts;
  readonly outcome: DecideOutput;
  readonly results: readonly GateResult[];
  readonly manualMerge: boolean;
  readonly writes: boolean;
}

async function decideOn(input: MergeRuleJobInput, pr: Awaited<ReturnType<GitHubClient['getPr']>>): Promise<Decided> {
  const { github, config, headSha, checkout } = input;
  const gathered = await gatherFacts({
    github,
    config,
    pr,
    headSha,
    base: input.base,
    checkout,
    defaultBranch: input.defaultBranch,
  });
  // A changed symbolic link or submodule fails the run; no gate or commit reads it.
  const unsafe = checkout.nonRegular(input.base, headSha);
  const results = unsafe.length > 0 ? [nonRegularResult(unsafe), ...input.results] : input.results;
  const outcome = decide({ results, config, pr: gathered.facts, claims: gathered.claims });
  const manualMerge = outcome.manualMerge === true;
  const writes = (outcome.decision === 'human-approved' || outcome.decision === 'auto-merge') && !manualMerge;
  return { gathered, outcome, results, manualMerge, writes };
}

/** Runs one phase of the merge-rule job for one PR. */
export async function runMergeRuleJob(input: MergeRuleJobInput): Promise<MergeRuleJobOutcome> {
  const { github, prNumber, headSha, log } = input;
  const pr = await github.getPr(prNumber);
  if (pr.state !== 'open') return done(`#${String(prNumber)} is ${pr.state}; nothing to decide.`);
  if (pr.headSha !== headSha)
    return done(`#${String(prNumber)} moved from ${headSha} to ${pr.headSha}; the run on the new head decides.`);

  const { gathered, outcome, results, manualMerge, writes } = await decideOn(input, pr);
  log(`decision (${input.phase}): ${outcome.decision}${manualMerge ? ' (manual merge)' : ''}`);
  for (const reason of outcome.reasons) log(`  - ${reason}`);

  const notes = input.note === undefined ? [] : [input.note];
  const report = decisionReport(results, outcome, headSha, input.base, gathered.facts.files);
  const publish = async (exitCode: number, summary: string): Promise<void> => {
    const conclusion: CheckConclusion = exitCode === 0 ? 'success' : 'failure';
    await github.createCheckRun({
      name: MERGE_RULE_CHECK,
      headSha,
      conclusion,
      title: `${outcome.decision}${manualMerge ? ' (manual merge)' : ''}`,
      summary,
    });
  };

  if (pr.fork) {
    notes.push('fork PR: report only; a maintainer reviews and merges it by hand');
    const summary = renderDecisionComment(results, outcome, notes, headSha);
    await publish(1, summary);
    return { decision: outcome.decision, manualMerge, exitCode: 1, summary, write: false, dispatched: [], report };
  }

  const label = labelFor(outcome.decision, manualMerge);
  let exitCode = GREEN_DECISIONS.has(outcome.decision) ? 0 : 1;
  const base = { decision: outcome.decision, manualMerge, label, report };

  if (input.phase === 'decide') {
    await github.removeLabels(
      prNumber,
      DECISION_LABELS.filter((other) => other !== label && pr.labels.includes(other)),
    );
    await github.addLabels(prNumber, [label]);
    const summary = renderDecisionComment(results, outcome, notes, headSha);
    await github.upsertComment(prNumber, COMMENT_MARKER, summary);
    if (writes) {
      const approvalArtifact = approvalArtifactName(prNumber, headSha);
      return { ...base, exitCode, summary, write: true, approvalArtifact, dispatched: [] };
    }
    await publish(exitCode, summary);
    return { ...base, exitCode, summary, write: false, dispatched: [] };
  }

  // Phase approve: the artifact is uploaded; write only if the decision still calls for it.
  if (!writes) {
    const summary = renderDecisionComment(
      results,
      outcome,
      [...notes, 'no approval commit: the decision changed'],
      headSha,
    );
    await publish(1, summary);
    return { ...base, exitCode: 1, summary, write: false, dispatched: [] };
  }
  let approvalCommitSha: string | undefined;
  const dispatched: string[] = [];
  try {
    const approval = gathered.facts.approval;
    const { commit, reviewed } = await writeApprovalCommit({
      github,
      config: input.config,
      checkout: input.checkout,
      changedFiles: gathered.changedFiles,
      prNumber,
      branch: pr.head,
      headSha,
      runId: input.runId,
      write:
        outcome.decision === 'human-approved'
          ? { kind: 'human', approval: approval as PullRequestApproval }
          : { kind: 'auto', results, now: input.now() },
      format: input.format,
    });
    approvalCommitSha = commit.sha;
    const what = reviewed.length > 0 ? ` reviews ${reviewed.join(', ')}` : ' records the approval';
    notes.push(`approval commit ${commit.sha}${what}; dispatching the required-check workflows on it`);
    // Registry workflows on the head branch; this (trusted) workflow on the default branch only.
    const targets = input.registry.workflows.map((workflow): [string, string, Record<string, string>] =>
      workflow === APPROVAL_WORKFLOW
        ? [workflow, input.defaultBranch, { pr: String(prNumber) }]
        : [workflow, pr.head, {}],
    );
    for (const [workflow, ref, inputs] of targets) {
      try {
        await github.dispatchWorkflow(workflow, ref, inputs);
        dispatched.push(workflow);
      } catch (error) {
        exitCode = 1;
        notes.push(`could not dispatch ${workflow}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    if (!(error instanceof ApprovalCommitError || error instanceof ProviderError)) throw error;
    exitCode = 1;
    notes.push(`no approval commit: ${error.message}`);
  }
  const summary = renderDecisionComment(results, outcome, notes, headSha);
  await github.upsertComment(prNumber, COMMENT_MARKER, summary);
  await publish(exitCode, summary);
  return {
    ...base,
    exitCode,
    summary,
    write: false,
    ...(approvalCommitSha === undefined ? {} : { approvalCommitSha }),
    dispatched,
  };
}
