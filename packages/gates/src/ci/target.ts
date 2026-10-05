/**
 * Which PR and head a run of the trusted workflow (content-gates.yml, main's copy) is about, read
 * from GitHub, never from anything the PR-side run produced:
 *
 * - `workflow_run` (the PR-side content-checks.yml completed): the PRs GitHub lists for that run
 *   (`workflow_run.pull_requests`), or, when it lists none (a fork PR, a dispatch on the approval
 *   commit), the open PRs whose head is the run's head sha. The PR's current head must still be
 *   that sha; otherwise a newer run decides.
 * - `issue_comment` (created): only a comment on a PR whose first line is the approval command; the
 *   PR's current head is read from GitHub.
 * - `workflow_dispatch` (input `pr`): only on the default branch (main's copy); the PR's current
 *   head is read from GitHub. The merge-rule job dispatches this after an approval commit.
 *
 * The verifiers run on a new head from a `pull_request` run (not a `labeled` one) or a dispatch that
 * is not an approval commit, and never for a fork PR (no LLM spend on PRs from outside). The changes diff starts from
 * `origin/<base>`. Relevance: passages/, calendar/, corpus/ or config/ changed.
 */
import type { LectioConfig } from '@lectio/config';
import type { GitHubClient, PullRequest } from '@lectio/providers';

import { parseApprovalTrailer } from '../merge-rule/index.ts';
import { ACTIONS_BOT, isApprovalCommand } from './facts.ts';

/** Top-level directories whose changes the content gates check. */
export const RELEVANT_PREFIXES = ['passages/', 'calendar/', 'corpus/', 'config/'] as const;

export interface Target {
  /** False when this run has nothing to do (for example a comment that is not `/approve`). */
  readonly run: boolean;
  readonly reason: string;
  readonly prNumber: number;
  readonly headSha: string;
  /** What the diff starts from: `origin/<base>`. */
  readonly base: string;
  /** The base branch name, fetched fresh. */
  readonly baseRef: string;
  readonly fork: boolean;
  /** Whether the verifiers job should run on this head. */
  readonly verifiers: boolean;
  /** The head carries a bot-signed approval trailer (decide still checks it fully). */
  readonly approvalHead: boolean;
}

export interface TargetContext {
  readonly github: GitHubClient;
  readonly config: Pick<LectioConfig, 'reviewer'>;
  /** The run executes the default branch's copy (`GITHUB_REF` is the default branch). */
  readonly onDefaultBranch: boolean;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const skip = (reason: string): Target => ({
  run: false,
  reason,
  prNumber: 0,
  headSha: '',
  base: '',
  baseRef: '',
  fork: false,
  verifiers: false,
  approvalHead: false,
});

async function isApprovalHead(github: GitHubClient, sha: string): Promise<boolean> {
  const commit = await github.getCommit(sha);
  return commit.author === ACTIONS_BOT && commit.verified && parseApprovalTrailer(commit.message) !== null;
}

/** The PR number named by `value` (a dispatch input or an issue number), or `null`. */
function prNumberOf(value: unknown): number | null {
  const number = typeof value === 'number' ? value : /^[1-9][0-9]*$/.test(text(value)) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function targetOf(github: GitHubClient, pr: PullRequest, reason: string, newHead: boolean): Promise<Target> {
  const approvalHead = await isApprovalHead(github, pr.headSha);
  return {
    run: true,
    reason,
    prNumber: pr.number,
    headSha: pr.headSha,
    base: `origin/${pr.base}`,
    baseRef: pr.base,
    fork: pr.fork,
    verifiers: newHead && !approvalHead && !pr.fork,
    approvalHead,
  };
}

async function fromWorkflowRun(event: Json, github: GitHubClient): Promise<Target> {
  const run = obj(event['workflow_run']);
  const headSha = text(run['head_sha']);
  const listed = (Array.isArray(run['pull_requests']) ? run['pull_requests'] : [])
    .map((pr) => prNumberOf(obj(pr)['number']))
    .filter((number): number is number => number !== null);
  const candidates =
    listed.length > 0
      ? await Promise.all(listed.map((number) => github.getPr(number)))
      : (await github.listPrs({ state: 'open' })).filter((pr) => pr.headSha === headSha);
  const pr = candidates.find((candidate) => candidate.state === 'open' && candidate.headSha === headSha);
  if (pr === undefined) return skip(`no open PR has head ${headSha} any more; a newer run decides`);
  const reason = `workflow_run (${text(run['event'])}) on #${String(pr.number)} at ${headSha}`;
  // The PR-side run names its action (`run-name: Content checks (<action>)`). A label adds no
  // content, so it does not re-run the verifiers. The title is PR-controlled, but it only decides
  // whether the verifiers run: hiding a new head behind "(labeled)" just means needs-review.
  const labeled = text(run['display_title']).endsWith('(labeled)');
  return targetOf(github, pr, reason, run['event'] === 'pull_request' && !labeled);
}

/** The target of a trusted content-gates.yml run from its event name and payload. */
export async function resolveTarget(eventName: string, payload: unknown, context: TargetContext): Promise<Target> {
  const { github, config } = context;
  const event = obj(payload);
  if (eventName === 'workflow_run') return fromWorkflowRun(event, github);
  let number: number | null;
  if (eventName === 'issue_comment') {
    const issue = obj(event['issue']);
    if (issue['pull_request'] === undefined) return skip('a comment on an issue, not a PR');
    if (!isApprovalCommand(text(obj(event['comment'])['body']), config.reviewer.approvalCommand))
      return skip(`a comment that is not ${config.reviewer.approvalCommand}`);
    number = prNumberOf(issue['number']);
  } else if (eventName === 'workflow_dispatch') {
    if (!context.onDefaultBranch) return skip('a dispatch off the default branch runs nothing (not main’s copy)');
    number = prNumberOf(obj(event['inputs'])['pr']);
  } else {
    return skip(`content-gates.yml does not handle ${eventName} events`);
  }
  if (number === null) throw new Error(`${eventName} event without a valid PR number`);
  const pr = await github.getPr(number);
  if (pr.state !== 'open') return skip(`#${String(number)} is ${pr.state}`);
  return targetOf(github, pr, `${eventName} on #${String(number)}`, eventName === 'workflow_dispatch');
}

/** The changed paths the content gates check. */
export function relevantFiles(paths: readonly string[]): string[] {
  return paths.filter((path) => RELEVANT_PREFIXES.some((prefix) => path.replace(/^\.\//, '').startsWith(prefix)));
}
