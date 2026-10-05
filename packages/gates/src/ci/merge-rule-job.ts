/**
 * The `merge-rule` job of content-gates.yml (a required check). It only decides, labels, writes the
 * approval commit, dispatches workflows and ends green or red; it never merges and never waits for
 * other checks.
 *
 * 1. Gathers the PR facts (`./facts.ts`) and runs `decide` (L-028) from the tooling checkout: the
 *    PR head is only read, so a PR that edits `decide` or a gate cannot change its own decision.
 * 2. Upserts one sticky comment and sets exactly one of `auto-merge-candidate` / `needs-review` /
 *    `gates-failed`.
 * 3. On `human-approved` or `auto-merge`, writes the review block and one approval commit, then
 *    dispatches every workflow in `.github/required-checks/` on the head branch, because commits
 *    made with `GITHUB_TOKEN` trigger no workflow. Each reports on the approval commit.
 * 4. On `approved-commit` (the head is a valid approval commit) it ends green and does nothing
 *    else, which rules out a dispatch loop; the `merge` job then takes over.
 *
 * A PR that changes `.github/**` (`manualMerge`) gets neither an approval commit nor dispatches: a
 * maintainer merges it by hand. A fork PR is report-only (no write token): the decision goes to the
 * job summary and the job ends red, since only a maintainer can merge it.
 */
import type { LectioConfig } from '@lectio/config';
import { ProviderError } from '@lectio/providers';
import type { GitHubClient } from '@lectio/providers';

import { COMMENT_MARKER, renderComment } from '../core/markdown.ts';
import type { PullRequestApproval } from '../core/pull-request.ts';
import type { GateResult } from '../core/result.ts';
import { overallStatus, REPORT_VERSION } from '../core/runner.ts';
import type { GateReport } from '../core/runner.ts';
import { APPROVAL_WORKFLOW, GREEN_DECISIONS, decide } from '../merge-rule/index.ts';
import type { Decision, DecideOutput } from '../merge-rule/index.ts';
import { GATES, ruleBookFor } from '../registry.ts';
import { ApprovalCommitError, writeApprovalCommit } from './approval-commit.ts';
import type { FormatJson } from '../review/approve.ts';
import type { PrCheckout } from './checkout.ts';
import { gatherFacts } from './facts.ts';
import type { RequiredChecksRegistry } from './registry.ts';

export const DECISION_LABELS = ['auto-merge-candidate', 'needs-review', 'gates-failed'] as const;
export type DecisionLabel = (typeof DECISION_LABELS)[number];

/** The one decision label for a decision. A green PR that must be merged by hand needs a person. */
export function labelFor(decision: Decision, manualMerge: boolean): DecisionLabel {
  if (decision === 'blocked') return 'gates-failed';
  if (decision === 'needs-review' || manualMerge) return 'needs-review';
  return 'auto-merge-candidate';
}

export interface MergeRuleJobInput {
  readonly github: GitHubClient;
  readonly config: LectioConfig;
  readonly checkout: PrCheckout;
  readonly registry: RequiredChecksRegistry;
  readonly prNumber: number;
  /** The head sha this run checked (the event's head; `pr-head/` is checked out at it). */
  readonly headSha: string;
  /** The PR's current base, fetched fresh (`origin/<base>`). */
  readonly base: string;
  readonly runId: string;
  /** Results of the deterministic and verifier jobs (a job that did not run is missing). */
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
  readonly approvalCommitSha?: string;
  readonly dispatched: readonly string[];
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
  return `${gates.trimEnd()}\n\n${decisionSection(outcome, notes)}\n`;
}

const done = (summary: string): MergeRuleJobOutcome => ({
  decision: null,
  manualMerge: false,
  exitCode: 0,
  summary,
  dispatched: [],
});

/** Runs the merge-rule job for one PR. */
export async function runMergeRuleJob(input: MergeRuleJobInput): Promise<MergeRuleJobOutcome> {
  const { github, config, prNumber, headSha, log } = input;
  const pr = await github.getPr(prNumber);
  if (pr.state !== 'open') return done(`#${String(prNumber)} is ${pr.state}; nothing to decide.`);
  if (pr.headSha !== headSha)
    return done(`#${String(prNumber)} moved from ${headSha} to ${pr.headSha}; the run on the new head decides.`);

  const gathered = await gatherFacts({ github, config, pr, headSha, base: input.base, checkout: input.checkout });
  const outcome = decide({ results: input.results, config, pr: gathered.facts, claims: gathered.claims });
  const manualMerge = outcome.manualMerge === true;
  log(`decision: ${outcome.decision}${manualMerge ? ' (manual merge)' : ''}`);
  for (const reason of outcome.reasons) log(`  - ${reason}`);

  const notes = input.note === undefined ? [] : [input.note];
  if (pr.fork) {
    notes.push('fork PR: report only (no write token); a maintainer reviews and merges it by hand');
    const summary = renderDecisionComment(input.results, outcome, notes, headSha);
    return { decision: outcome.decision, manualMerge, exitCode: 1, summary, dispatched: [] };
  }

  const label = labelFor(outcome.decision, manualMerge);
  await github.removeLabels(
    prNumber,
    DECISION_LABELS.filter((other) => other !== label && pr.labels.includes(other)),
  );
  await github.addLabels(prNumber, [label]);

  let exitCode = GREEN_DECISIONS.has(outcome.decision) ? 0 : 1;
  let approvalCommitSha: string | undefined;
  const dispatched: string[] = [];
  const writes = (outcome.decision === 'human-approved' || outcome.decision === 'auto-merge') && !manualMerge;
  if (writes) {
    try {
      const approval = gathered.facts.approval;
      const { commit, reviewed } = await writeApprovalCommit({
        github,
        config,
        checkout: input.checkout,
        changedFiles: gathered.changedFiles,
        prNumber,
        branch: pr.head,
        headSha,
        runId: input.runId,
        write:
          outcome.decision === 'human-approved'
            ? { kind: 'human', approval: approval as PullRequestApproval }
            : { kind: 'auto', results: input.results, now: input.now() },
        format: input.format,
      });
      approvalCommitSha = commit.sha;
      notes.push(
        `approval commit ${commit.sha}${reviewed.length > 0 ? ` reviews ${reviewed.join(', ')}` : ''}; dispatching the required-check workflows on it`,
      );
      for (const workflow of input.registry.workflows) {
        const inputs: Record<string, string> = workflow === APPROVAL_WORKFLOW ? { pr: String(prNumber) } : {};
        try {
          await github.dispatchWorkflow(workflow, pr.head, inputs);
          dispatched.push(workflow);
        } catch (error) {
          exitCode = 1;
          notes.push(`could not dispatch ${workflow}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      const known = error instanceof ApprovalCommitError || error instanceof ProviderError;
      if (!known) throw error;
      exitCode = 1;
      notes.push(`no approval commit: ${error.message}`);
    }
  }

  const summary = renderDecisionComment(input.results, outcome, notes, headSha);
  await github.upsertComment(prNumber, COMMENT_MARKER, summary);
  return {
    decision: outcome.decision,
    manualMerge,
    exitCode,
    summary,
    label,
    ...(approvalCommitSha === undefined ? {} : { approvalCommitSha }),
    dispatched,
  };
}
