/**
 * The `changes` job of content-gates.yml: which PR and head sha a run is about, whether it should
 * run at all, and whether anything relevant changed.
 *
 * - `pull_request` (opened, synchronize, reopened, labeled): the event's PR, head and base sha.
 * - `issue_comment` (created): only a comment on a PR whose first line is the approval command;
 *   the PR's current head is read from GitHub. These runs execute main's workflow file and report
 *   their checks on main's tip, not on the PR.
 * - `workflow_dispatch` (input `pr`): the PR's current head, read from GitHub (the merge-rule job
 *   dispatches this on the approval commit).
 *
 * The verifiers run only on a new head (`opened`, `synchronize`, `reopened`, a dispatch) that is
 * not an approval commit: a label or an `/approve` comment changes no content, and an approval
 * commit needs no verdicts. Relevance: the diff against the PR base (`pull_request`) or against
 * `origin/<base>` (any other event, normally origin/main) touches passages/, calendar/, corpus/ or
 * config/. Otherwise every gate job exits green without running a gate.
 */
import type { LectioConfig } from '@lectio/config';
import type { GitHubClient } from '@lectio/providers';

import { parseApprovalTrailer } from '../merge-rule/index.ts';
import { ACTIONS_BOT, isApprovalCommand } from './facts.ts';

export const CONTENT_GATES_EVENTS = ['pull_request', 'issue_comment', 'workflow_dispatch'] as const;

/** Top-level directories whose changes the content gates check. */
export const RELEVANT_PREFIXES = ['passages/', 'calendar/', 'corpus/', 'config/'] as const;

export interface Target {
  /** False when this run has nothing to do (for example a comment that is not `/approve`). */
  readonly run: boolean;
  readonly reason: string;
  readonly prNumber: number;
  readonly headSha: string;
  /** Head branch name (in the head repository). */
  readonly headRef: string;
  /** What the changes diff starts from: the PR base sha, or `origin/<base>`. */
  readonly base: string;
  /** The base branch name, fetched fresh by the merge-rule job. */
  readonly baseRef: string;
  readonly fork: boolean;
  /** Whether the verifiers job should run on this head. */
  readonly verifiers: boolean;
  /** The head carries a bot-signed approval trailer (decide still checks it fully). */
  readonly approvalHead: boolean;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const NOTHING: Omit<Target, 'reason'> = {
  run: false,
  prNumber: 0,
  headSha: '',
  headRef: '',
  base: '',
  baseRef: '',
  fork: false,
  verifiers: false,
  approvalHead: false,
};

const NEW_HEAD_ACTIONS: ReadonlySet<string> = new Set(['opened', 'synchronize', 'reopened']);

async function isApprovalHead(github: GitHubClient, sha: string): Promise<boolean> {
  const commit = await github.getCommit(sha);
  return commit.author === ACTIONS_BOT && commit.verified && parseApprovalTrailer(commit.message) !== null;
}

/** The PR number named by `value` (a dispatch input or an issue number), or `null`. */
function prNumberOf(value: unknown): number | null {
  const number = typeof value === 'number' ? value : /^[1-9][0-9]*$/.test(text(value)) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** The target of a content-gates.yml run from its event name and payload. */
export async function resolveTarget(
  eventName: string,
  payload: unknown,
  github: GitHubClient,
  config: Pick<LectioConfig, 'reviewer'>,
): Promise<Target> {
  const event = obj(payload);
  if (eventName === 'pull_request') {
    const pr = obj(event['pull_request']);
    const head = obj(pr['head']);
    const base = obj(pr['base']);
    const number = prNumberOf(pr['number']);
    if (number === null) throw new Error('pull_request event without a PR number');
    const headSha = text(head['sha']);
    const approvalHead = await isApprovalHead(github, headSha);
    return {
      run: true,
      reason: `pull_request ${text(event['action'])} on #${String(number)}`,
      prNumber: number,
      headSha,
      headRef: text(head['ref']),
      base: text(base['sha']),
      baseRef: text(base['ref']),
      fork: text(obj(head['repo'])['full_name']) !== text(obj(base['repo'])['full_name']),
      verifiers: NEW_HEAD_ACTIONS.has(text(event['action'])) && !approvalHead,
      approvalHead,
    };
  }
  let number: number | null;
  let verifiers: boolean;
  if (eventName === 'issue_comment') {
    const issue = obj(event['issue']);
    if (issue['pull_request'] === undefined) return { ...NOTHING, reason: 'a comment on an issue, not a PR' };
    if (!isApprovalCommand(text(obj(event['comment'])['body']), config.reviewer.approvalCommand))
      return { ...NOTHING, reason: `a comment that is not ${config.reviewer.approvalCommand}` };
    number = prNumberOf(issue['number']);
    verifiers = false;
  } else if (eventName === 'workflow_dispatch') {
    number = prNumberOf(obj(event['inputs'])['pr']);
    verifiers = true;
  } else {
    return { ...NOTHING, reason: `content-gates.yml does not handle ${eventName} events` };
  }
  if (number === null) throw new Error(`${eventName} event without a valid PR number`);
  const pr = await github.getPr(number);
  if (pr.state !== 'open') return { ...NOTHING, reason: `#${String(number)} is ${pr.state}` };
  const approvalHead = await isApprovalHead(github, pr.headSha);
  return {
    run: true,
    reason: `${eventName} on #${String(number)}`,
    prNumber: number,
    headSha: pr.headSha,
    headRef: pr.head,
    base: `origin/${pr.base}`,
    baseRef: pr.base,
    fork: pr.fork,
    verifiers: verifiers && !approvalHead,
    approvalHead,
  };
}

/** The changed paths the content gates check. */
export function relevantFiles(paths: readonly string[]): string[] {
  return paths.filter((path) => RELEVANT_PREFIXES.some((prefix) => path.replace(/^\.\//, '').startsWith(prefix)));
}
