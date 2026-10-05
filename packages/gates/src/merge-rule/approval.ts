/**
 * Approval commits: the signed commit the merge-rule job (L-031) writes after an approval, with
 * the trailer `Lectio-Approval: <human|auto> run=<run id> head=<parent sha>`.
 *
 * Validity rule ([decision 003](../../../../docs/decisions/003-auto-merge.md)): the commit is
 * authored by github-actions[bot] with a verified signature; its run id belongs to a
 * content-gates.yml run for this PR number; the trailer's `head` equals the commit's parent; and,
 * only when that run was triggered by `pull_request`, the run's head SHA also equals the parent.
 * Runs triggered by `issue_comment` report main's tip as their head SHA, so that last check
 * cannot apply to them. Anything else is a forged approval.
 *
 * Binding to the decided head: the merge-rule job writes `head=` as the SHA it decided on (never
 * the branch tip re-read at commit time), so `trailer head == parent` ties every approval
 * commit, `issue_comment` ones included, to the content the approval saw. If a push lands during
 * the run, the commit's parent differs from `head=` and the commit is blocked.
 *
 * An approval commit is not a content commit: it never resets the time of the last content
 * commit, so the approval it records still counts after it lands.
 */
import type { ApprovalCommit } from '../core/pull-request.ts';

export const APPROVAL_TRAILER_KEY = 'Lectio-Approval';

/** The workflow whose merge-rule job writes approval commits (L-031). */
export const APPROVAL_WORKFLOW = 'content-gates.yml';

/** Events that start a content-gates.yml run (L-031). */
export const APPROVAL_RUN_EVENTS = ['pull_request', 'issue_comment', 'workflow_dispatch'] as const;

export type ApprovalKind = ApprovalCommit['kind'];

export interface ApprovalTrailer {
  readonly kind: ApprovalKind;
  readonly runId: string;
  readonly head: string;
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const RUN_ID = /^[1-9][0-9]*$/;
const TRAILER_LINE = /^Lectio-Approval:(.*)$/gm;
const TRAILER_VALUE = /^\s*(human|auto) run=([1-9][0-9]*) head=([0-9a-f]{40}(?:[0-9a-f]{24})?)\s*$/;

/** The trailer line for an approval commit. */
export function formatApprovalTrailer(trailer: ApprovalTrailer): string {
  if (!RUN_ID.test(trailer.runId)) throw new RangeError(`invalid run id: ${trailer.runId}`);
  if (!SHA.test(trailer.head)) throw new RangeError(`invalid head sha: ${trailer.head}`);
  return `${APPROVAL_TRAILER_KEY}: ${trailer.kind} run=${trailer.runId} head=${trailer.head}`;
}

/**
 * The `Lectio-Approval` trailer of a commit message, or `null` when there is none. A message with
 * a malformed trailer or more than one trailer has none: it is not an approval commit.
 */
export function parseApprovalTrailer(message: string): ApprovalTrailer | null {
  const lines = [...message.matchAll(TRAILER_LINE)];
  if (lines.length !== 1) return null;
  const match = TRAILER_VALUE.exec((lines[0] as RegExpExecArray)[1] as string);
  if (match === null) return null;
  const [, kind, runId, head] = match as unknown as [string, ApprovalKind, string, string];
  return { kind, runId, head };
}

const sameWorkflow = (workflow: string): boolean =>
  workflow === APPROVAL_WORKFLOW || workflow.endsWith(`/${APPROVAL_WORKFLOW}`);

/**
 * Why an approval commit is not valid for PR `prNumber` (empty when it is valid). An unknown PR
 * number makes every approval commit invalid: the run cannot be tied to this PR.
 */
export function approvalCommitProblems(commit: ApprovalCommit, prNumber: number): string[] {
  const problems: string[] = [];
  const { run } = commit;
  if (!commit.authorIsBot) problems.push('it is not authored by github-actions[bot]');
  if (!commit.signatureVerified) problems.push('its signature is not verified');
  if (!RUN_ID.test(commit.runId)) problems.push(`its run id "${commit.runId}" is not a workflow run id`);
  if (!sameWorkflow(run.workflow))
    problems.push(`run ${commit.runId} is a ${run.workflow} run, not ${APPROVAL_WORKFLOW}`);
  if (!Number.isInteger(prNumber) || prNumber <= 0)
    problems.push('the PR number is unknown, so run ' + commit.runId + ' cannot be tied to it');
  else if (run.prNumber !== prNumber)
    problems.push(`run ${commit.runId} belongs to PR #${String(run.prNumber)}, not #${String(prNumber)}`);
  if (!(APPROVAL_RUN_EVENTS as readonly string[]).includes(run.event))
    problems.push(`run ${commit.runId} was triggered by ${run.event}, which never writes approval commits`);
  if (!SHA.test(commit.parentSha)) problems.push(`its parent "${commit.parentSha}" is not a commit sha`);
  if (commit.trailerHead !== commit.parentSha)
    problems.push(`the trailer head ${commit.trailerHead} is not the commit's parent ${commit.parentSha}`);
  if (run.event === 'pull_request' && run.headSha !== commit.parentSha)
    problems.push(`pull_request run ${commit.runId} ran on ${run.headSha}, not on the parent ${commit.parentSha}`);
  return problems;
}
