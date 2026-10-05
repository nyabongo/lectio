/**
 * The facts `decide` needs that only GitHub knows (L-028 leaves them to this job): who approved
 * and when (from the events and comments APIs, with actors and server times), whether the head is
 * an approval commit and which run wrote it, when GitHub last saw new content on the PR head
 * (`pull_request` runs of content-gates.yml, never commit dates), and whether the PR comes from a
 * fork. Everything else is read from the PR head as data (`PrCheckout`).
 */
import type { LectioConfig } from '@lectio/config';
import { ProviderError } from '@lectio/providers';
import type { GitCommit, GitHubClient, IssueComment, IssueEvent, PullRequest, WorkflowRun } from '@lectio/providers';

import type { ChangedFile } from '../core/git.ts';
import type { ApprovalCommit, PullRequestApproval, PullRequestFacts } from '../core/pull-request.ts';
import {
  APPROVAL_WORKFLOW,
  approvalCommitProblems,
  approvedReviewEdits,
  changedClaims,
  changedPaths,
  headObservationsFromRuns,
  isApprovalCommit,
  lastContentCommitAt,
  parseApprovalTrailer,
} from '../merge-rule/index.ts';
import type { ClaimRef, PullRequestCommit } from '../merge-rule/index.ts';
import type { PrCheckout } from './checkout.ts';

/** The login of the Actions `GITHUB_TOKEN`, which authors (and GitHub signs) approval commits. */
export const ACTIONS_BOT = 'github-actions[bot]';

/** content-gates.yml names its runs `Content gates · PR #<n>` (`run-name:`). */
export const RUN_NAME_PREFIX = 'Content gates · PR #';

/** The `run-name:` content-gates.yml gives a run for PR `number`. */
export function runName(number: number): string {
  return `${RUN_NAME_PREFIX}${String(number)}`;
}

/**
 * The PR a content-gates.yml run belongs to: `number` when GitHub lists it among the run's PRs or
 * the run title names it, else the first PR the run lists or names, else 0 (unknown).
 * `issue_comment` and `workflow_dispatch` runs list no PRs, so their title (main's `run-name:` for
 * `issue_comment`) is what ties them to a PR.
 */
export function runPrNumber(run: Pick<WorkflowRun, 'prNumbers' | 'displayTitle'>, number: number): number {
  const titled = run.displayTitle.startsWith(RUN_NAME_PREFIX)
    ? Number(run.displayTitle.slice(RUN_NAME_PREFIX.length))
    : Number.NaN;
  const named = Number.isInteger(titled) && titled > 0 ? [titled] : [];
  const candidates = [...run.prNumbers, ...named];
  return candidates.includes(number) ? number : (candidates[0] ?? 0);
}

/** True when the comment's first line is exactly the approval command (for example `/approve`). */
export function isApprovalCommand(body: string, command: string): boolean {
  const first = body.trim().split(/\r?\n/, 1)[0] ?? '';
  return first.trim().toLowerCase() === command.trim().toLowerCase();
}

const sameHandle = (a: string, b: string): boolean =>
  a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();

/**
 * The approval to give `decide`: the latest by a configured reviewer, else the latest by anyone
 * (so the PR comment says why it was ignored), or `null`.
 *
 * - Label: a `labeled` event for `config.reviewer.approvalLabel` whose actor is the approver, and
 *   only while the label is still on the PR.
 * - Comment: a comment whose first line is `config.reviewer.approvalCommand`, by its author, and
 *   only if it was never edited: anyone with write access can edit a comment, so an edited one
 *   cannot prove its author approved.
 */
export function pickApproval(
  events: readonly IssueEvent[],
  comments: readonly IssueComment[],
  labels: readonly string[],
  config: Pick<LectioConfig, 'reviewer'>,
): PullRequestApproval | null {
  const { approvalLabel, approvalCommand, githubHandles } = config.reviewer;
  const candidates: PullRequestApproval[] = [];
  if (labels.includes(approvalLabel)) {
    for (const event of events)
      if (event.event === 'labeled' && event.label === approvalLabel)
        candidates.push({ handle: event.actor, via: 'label', at: event.createdAt });
  }
  for (const comment of comments)
    if (comment.updatedAt === comment.createdAt && isApprovalCommand(comment.body, approvalCommand))
      candidates.push({ handle: comment.author, via: 'comment', at: comment.createdAt });
  const latest = (list: readonly PullRequestApproval[]): PullRequestApproval | null =>
    list.reduce<PullRequestApproval | null>(
      (best, next) => (best === null || Date.parse(next.at) >= Date.parse(best.at) ? next : best),
      null,
    );
  const configured = candidates.filter((approval) =>
    githubHandles.some((handle) => sameHandle(handle, approval.handle)),
  );
  return latest(configured) ?? latest(candidates);
}

/** A commit as the merge rule's commit model sees it. */
export function toPullRequestCommit(commit: GitCommit): PullRequestCommit {
  return {
    sha: commit.sha,
    parents: commit.parents,
    message: commit.message,
    authorIsBot: commit.author === ACTIONS_BOT,
    signatureVerified: commit.verified,
  };
}

/**
 * `commit` as an {@link ApprovalCommit} when its message carries a `Lectio-Approval` trailer (else
 * `null`), with the run its trailer names. A run that does not exist reads as a run of no workflow
 * and no PR, so the validity rule rejects it.
 */
export async function approvalCommitOf(
  commit: GitCommit,
  github: GitHubClient,
  prNumber: number,
): Promise<ApprovalCommit | null> {
  const trailer = parseApprovalTrailer(commit.message);
  if (trailer === null) return null;
  let run: ApprovalCommit['run'];
  try {
    const found = await github.getWorkflowRun(Number(trailer.runId));
    run = {
      workflow: found.workflowFile,
      prNumber: runPrNumber(found, prNumber),
      event: found.event,
      headSha: found.headSha,
    };
  } catch (error) {
    if (!(error instanceof ProviderError) || error.code !== 'not-found') throw error;
    run = { workflow: '(no such run)', prNumber: 0, event: '(none)', headSha: '' };
  }
  return {
    kind: trailer.kind,
    runId: trailer.runId,
    trailerHead: trailer.head,
    parentSha: commit.parents.length === 1 ? (commit.parents[0] as string) : commit.parents.join(','),
    authorIsBot: commit.author === ACTIONS_BOT,
    signatureVerified: commit.verified,
    run,
  };
}

export interface GatherInput {
  readonly github: GitHubClient;
  readonly config: LectioConfig;
  readonly pr: PullRequest;
  /** The PR head sha this run decides on. */
  readonly headSha: string;
  /** The PR's current base, fetched fresh (for example `origin/main`). */
  readonly base: string;
  readonly checkout: PrCheckout;
}

export interface GatheredFacts {
  readonly facts: PullRequestFacts;
  readonly claims: readonly ClaimRef[];
  readonly changedFiles: readonly ChangedFile[];
  /** The PR commits in `base..head`, with GitHub's author and signature. */
  readonly commits: readonly PullRequestCommit[];
}

/**
 * The newest approval commit below the head that is valid for this PR, or `null`. Review blocks it
 * wrote are the bot's, not the author's: a later content commit that keeps them is not a review
 * edit (it needs a fresh approval, which `lastContentCommitAt` already demands).
 */
async function lastValidApprovalBelowHead(
  commits: readonly PullRequestCommit[],
  headSha: string,
  github: GitHubClient,
  prNumber: number,
): Promise<string | null> {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  for (let sha = bySha.get(headSha)?.parents[0]; sha !== undefined; sha = bySha.get(sha)?.parents[0]) {
    const commit = bySha.get(sha);
    if (commit === undefined) return null;
    if (!isApprovalCommit(commit)) continue;
    const approval = await approvalCommitOf(await github.getCommit(sha), github, prNumber);
    if (approval !== null && approvalCommitProblems(approval, prNumber).length === 0) return sha;
  }
  return null;
}

/** Everything `decide` needs about the PR at `headSha`. */
export async function gatherFacts(input: GatherInput): Promise<GatheredFacts> {
  const { github, config, pr, headSha, base, checkout } = input;
  const changedFiles = checkout.changedFiles(base, headSha);
  const links = checkout.revList(base, headSha);
  const commits = await Promise.all(links.map(async (link) => toPullRequestCommit(await github.getCommit(link.sha))));
  const runs = (await Promise.all(commits.map((commit) => github.listRunsForSha(commit.sha)))).flat();
  const observations = headObservationsFromRuns(runs.filter((run) => run.workflowFile === APPROVAL_WORKFLOW));

  const [events, comments] = await Promise.all([github.listIssueEvents(pr.number), github.listComments(pr.number)]);
  const approval = pickApproval(events, comments, pr.labels, config);
  const head = await github.getCommit(headSha);
  const approvalCommit = await approvalCommitOf(head, github, pr.number);

  const baseline =
    approvalCommit === null ? await lastValidApprovalBelowHead(commits, headSha, github, pr.number) : null;
  const readBase =
    baseline === null ? (path: string) => checkout.show(base, path) : (path: string) => checkout.show(baseline, path);
  const view = { changedFiles, readFile: (path: string) => checkout.readFile(path), readBase };

  const facts: PullRequestFacts = {
    number: pr.number,
    files: changedPaths(changedFiles),
    reviewEdits: approvedReviewEdits(view),
    approval,
    approvalCommit,
    lastContentCommitAt: lastContentCommitAt(commits, observations),
    fork: pr.fork,
  };
  return { facts, claims: changedClaims(view), changedFiles, commits };
}
