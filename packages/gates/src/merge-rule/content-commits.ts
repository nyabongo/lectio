/**
 * `PullRequestFacts.lastContentCommitAt` from server observations, never from git dates.
 *
 * Committer and author dates are set on the pushing machine: a commit made before an approval but
 * pushed after it, or one backdated with `GIT_COMMITTER_DATE`, would otherwise slip under an
 * approval the reviewer gave without seeing it. What counts is when GitHub saw the content on the
 * PR head. An approval commit is not a content commit: it never resets that time.
 */
import { parseApprovalTrailer } from './approval.ts';

/**
 * One commit of the PR, in any order. Containment is worked out from `parents` (never from list
 * order or dates), so build the list with parent SHAs: `git rev-list --parents base..head`, or the
 * API's commit records (`GitCommit.parents`).
 */
export interface PullRequestCommit {
  readonly sha: string;
  /** Parent SHAs; parents outside the PR (the base) are ignored. */
  readonly parents: readonly string[];
  readonly message: string;
  readonly authorIsBot: boolean;
  readonly signatureVerified: boolean;
}

/**
 * The moment GitHub saw the PR head at `sha`, as a **server** timestamp. Sources, through the
 * GitHubClient: the `created_at` of each `pull_request` content-gates.yml run (or check suite) for
 * that head SHA, and the PR timeline's `head_ref_force_pushed` events. Several observations of the
 * same SHA are fine (for example a `labeled` run after the push).
 */
export interface HeadObservation {
  readonly sha: string;
  /** ISO server timestamp. */
  readonly seenAt: string;
}

/** A workflow run as the Actions API reports it. */
export interface ObservedRun {
  readonly event: string;
  readonly headSha: string;
  /** The run's server `created_at`. */
  readonly createdAt: string;
}

/**
 * Head observations from content-gates.yml runs. Only `pull_request` runs count: `issue_comment`
 * runs report main's tip as their head SHA.
 */
export function headObservationsFromRuns(runs: readonly ObservedRun[]): HeadObservation[] {
  return runs.filter((run) => run.event === 'pull_request').map((run) => ({ sha: run.headSha, seenAt: run.createdAt }));
}

/**
 * What `lastContentCommitAt` returns when a content commit is not in the latest observed head (for
 * example the current head has no run yet): later than any approval, so none counts until GitHub
 * has seen the content.
 */
export const UNSEEN_COMMIT_AT = '9999-12-31T23:59:59Z';

/** A bot-authored, signed commit with a well-formed approval trailer; it does not reset approvals. */
export function isApprovalCommit(commit: PullRequestCommit): boolean {
  return commit.authorIsBot && commit.signatureVerified && parseApprovalTrailer(commit.message) !== null;
}

interface Timed {
  readonly at: string;
  readonly time: number;
}

/** The PR commits reachable from `head` through parent links (`head` included when it is one). */
function ancestry(head: string, bySha: ReadonlyMap<string, PullRequestCommit>): Set<string> {
  const reached = new Set<string>();
  const stack = [head];
  for (let sha = stack.pop(); sha !== undefined; sha = stack.pop()) {
    const commit = bySha.get(sha);
    if (commit === undefined || reached.has(sha)) continue;
    reached.add(sha);
    stack.push(...commit.parents);
  }
  return reached;
}

/**
 * The latest time a content commit (approval commits excluded) entered the PR head's history.
 *
 * An observed head contains a commit when the commit is reachable from it through parent links;
 * list order and dates are never used. Observations are replayed in time order; a head that does
 * not contain the commit (a force push to other history, or an old head that is not a PR commit
 * any more) takes it out again, so a commit that comes back counts from its return. `null` when
 * the PR has no content commit; {@link UNSEEN_COMMIT_AT} when a content commit is not in the
 * latest observed head.
 */
export function lastContentCommitAt(
  commits: readonly PullRequestCommit[],
  observations: readonly HeadObservation[],
): string | null {
  const replay = observations
    .map((observation) => {
      const time = Date.parse(observation.seenAt);
      if (Number.isNaN(time)) throw new RangeError(`invalid observation time: ${observation.seenAt}`);
      return { sha: observation.sha, at: observation.seenAt, time };
    })
    .sort((a, b) => a.time - b.time);
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const contents = new Map(replay.map((observation) => [observation.sha, ancestry(observation.sha, bySha)]));
  let latest: Timed | null = null;
  for (const commit of commits) {
    if (isApprovalCommit(commit)) continue;
    let entered: Timed | null = null;
    for (const observation of replay) {
      if (!(contents.get(observation.sha) as Set<string>).has(commit.sha)) entered = null;
      else entered ??= observation;
    }
    if (entered === null) return UNSEEN_COMMIT_AT;
    if (latest === null || entered.time > latest.time) latest = entered;
  }
  return latest?.at ?? null;
}
