/**
 * The facts `decide` needs that only GitHub knows (L-028 leaves them to this job): who approved
 * and when (from the events and comments APIs, with actors and server times), whether the head is
 * an approval commit and which run wrote it, when GitHub last saw new content on the PR head
 * (`pull_request` runs of content-checks.yml, never commit dates), and whether the PR comes from a
 * fork. Everything else is read from the PR head as data (`PrCheckout`).
 */
import type { LectioConfig } from '@lectio/config';
import { ProviderError } from '@lectio/providers';
import type { GitCommit, GitHubClient, IssueComment, IssueEvent, PullRequest, WorkflowRun } from '@lectio/providers';

import type { ChangedFile } from '../core/git.ts';
import type { ApprovalCommit, PullRequestApproval, PullRequestFacts } from '../core/pull-request.ts';
import {
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

/**
 * The PR-side workflow (`pull_request`, read-only, no secrets): its runs show when GitHub saw each
 * PR head. The trusted workflow that decides and writes is `APPROVAL_WORKFLOW` (content-gates.yml).
 */
export const CHECKS_WORKFLOW = 'content-checks.yml';

/** The login of the Actions `GITHUB_TOKEN`, which authors (and GitHub signs) approval commits. */
export const ACTIONS_BOT = 'github-actions[bot]';

/**
 * The artifact the trusted merge-rule job uploads, from inside its own run, just before it writes an
 * approval commit for PR `prNumber` on head `headSha`. Only that run's jobs can upload to it.
 */
export function approvalArtifactName(prNumber: number, headSha: string): string {
  return `lectio-approval-pr${String(prNumber)}-${headSha}`;
}

/**
 * True when `run` executed the default branch's copy of its workflow: `workflow_run` and
 * `issue_comment` runs always do, and a `workflow_dispatch` run does when it ran on the default
 * branch. Any other run (a `pull_request` run, a dispatch on a PR branch) may run a copy the PR
 * edited, so it never vouches for an approval commit.
 */
export function runsMainCopy(run: Pick<WorkflowRun, 'event' | 'headBranch'>, defaultBranch: string): boolean {
  if (run.event === 'workflow_run' || run.event === 'issue_comment') return true;
  return run.event === 'workflow_dispatch' && run.headBranch === defaultBranch;
}

/**
 * The PR a content-gates.yml run wrote an approval commit for: `prNumber` when the run executed
 * main's copy and uploaded the approval artifact for this PR and `parentSha`, else 0, which `decide`
 * blocks as a run of another PR. Run titles are never consulted.
 */
export async function runPrNumber(
  run: WorkflowRun,
  github: GitHubClient,
  prNumber: number,
  parentSha: string,
  defaultBranch: string,
): Promise<number> {
  if (!runsMainCopy(run, defaultBranch)) return 0;
  const names = await github.listRunArtifacts(run.id);
  return names.includes(approvalArtifactName(prNumber, parentSha)) ? prNumber : 0;
}

/** True when the comment's first line is exactly the approval command (for example `/approve`). */
export function isApprovalCommand(body: string, command: string): boolean {
  const first = body.trim().split(/\r?\n/, 1).join('');
  return first.trim().toLowerCase() === command.trim().toLowerCase();
}

const sameHandle = (a: string, b: string): boolean =>
  a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();

/**
 * The approval to give `decide`: the latest by a configured reviewer, else the latest by anyone
 * (so the PR comment says why it was ignored), or `null`.
 *
 * - Label: the latest `labeled` / `unlabeled` event for `config.reviewer.approvalLabel`, when it is
 *   a `labeled` event (its actor is the approver) and the label is still on the PR.
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
  // Only the latest labeling of the approval label counts: a removal revokes it, and whoever adds it
  // back is the approver from then on.
  const labeling = events.filter(
    (event) => (event.event === 'labeled' || event.event === 'unlabeled') && event.label === approvalLabel,
  );
  const latest = labeling.at(-1);
  if (labels.includes(approvalLabel) && latest?.event === 'labeled')
    candidates.push({ handle: latest.actor, via: 'label', at: latest.createdAt });
  for (const comment of comments)
    if (comment.updatedAt === comment.createdAt && isApprovalCommand(comment.body, approvalCommand))
      candidates.push({ handle: comment.author, via: 'comment', at: comment.createdAt });
  const newest = (list: readonly PullRequestApproval[]): PullRequestApproval | null =>
    list.reduce<PullRequestApproval | null>(
      (best, next) => (best === null || Date.parse(next.at) >= Date.parse(best.at) ? next : best),
      null,
    );
  const configured = candidates.filter((approval) =>
    githubHandles.some((handle) => sameHandle(handle, approval.handle)),
  );
  return newest(configured) ?? newest(candidates);
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
  defaultBranch: string,
): Promise<ApprovalCommit | null> {
  const trailer = parseApprovalTrailer(commit.message);
  if (trailer === null) return null;
  const parentSha = commit.parents.length === 1 ? (commit.parents[0] as string) : commit.parents.join(',');
  let run: ApprovalCommit['run'];
  try {
    const found = await github.getWorkflowRun(Number(trailer.runId));
    run = {
      workflow: found.workflowFile,
      prNumber: await runPrNumber(found, github, prNumber, parentSha, defaultBranch),
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
    parentSha,
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
  /** The repository's default branch: a dispatch run there executed main's workflow copy. */
  readonly defaultBranch: string;
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
  defaultBranch: string,
): Promise<string | null> {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  // First parents down from the head, until the walk leaves the PR's commits.
  for (let commit = bySha.get(headSha); commit !== undefined; commit = bySha.get(String(commit.parents[0]))) {
    if (commit.sha === headSha || !isApprovalCommit(commit)) continue;
    const approval = await approvalCommitOf(await github.getCommit(commit.sha), github, prNumber, defaultBranch);
    if (approvalCommitProblems(approval as ApprovalCommit, prNumber).length === 0) return commit.sha;
  }
  return null;
}

/** Everything `decide` needs about the PR at `headSha`. */
export async function gatherFacts(input: GatherInput): Promise<GatheredFacts> {
  const { github, config, pr, headSha, base, checkout, defaultBranch } = input;
  const changedFiles = checkout.changedFiles(base, headSha);
  const links = checkout.revList(base, headSha);
  const commits = await Promise.all(links.map(async (link) => toPullRequestCommit(await github.getCommit(link.sha))));
  const runs = (await Promise.all(commits.map((commit) => github.listRunsForSha(commit.sha)))).flat();
  // When GitHub saw each head: the PR-side workflow's pull_request runs (server timestamps).
  const observations = headObservationsFromRuns(runs.filter((run) => run.workflowFile === CHECKS_WORKFLOW));

  const [events, comments] = await Promise.all([github.listIssueEvents(pr.number), github.listComments(pr.number)]);
  const approval = pickApproval(events, comments, pr.labels, config);
  const head = await github.getCommit(headSha);
  const approvalCommit = await approvalCommitOf(head, github, pr.number, defaultBranch);

  const baseline =
    approvalCommit === null
      ? await lastValidApprovalBelowHead(commits, headSha, github, pr.number, defaultBranch)
      : null;
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
