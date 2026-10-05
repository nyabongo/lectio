/**
 * The GitHub operations Lectio needs: research publishes PRs, the merge-rule job reads
 * approvals (labels and comments with their actors), writes the approval commit,
 * dispatches workflows and merges; the runway monitor upserts an issue.
 *
 * Numbers are shared between issues and PRs, as on GitHub. Timestamps are ISO strings.
 */

export interface GitCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly message: string;
  /** Login of the commit author (for example `github-actions[bot]`). */
  readonly author: string;
  /** GitHub shows the signature as verified (commits created through the API are). */
  readonly verified: boolean;
  readonly createdAt: string;
}

/** A file to write (`content` as UTF-8 text) or delete (`content: null`). */
export interface FileChange {
  readonly path: string;
  readonly content: string | null;
}

export interface CreateBranchInput {
  readonly name: string;
  /** Branch name or commit sha to start from. Default: the default branch. */
  readonly from?: string;
}

export interface CommitFilesInput {
  readonly branch: string;
  readonly message: string;
  readonly files: readonly FileChange[];
  /** Rejects with a `conflict` error when the branch head is not this sha. */
  readonly expectedHeadSha?: string;
  /**
   * Allows `files: []`: a commit with the head's tree that changes nothing (an approval commit on a
   * PR without a review block to write). Default false.
   */
  readonly allowEmpty?: boolean;
}

export type PrState = 'open' | 'closed' | 'merged';

export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  /** Head branch name (in `headRepo`). */
  readonly head: string;
  /** `owner/name` of the repository the head branch lives in. */
  readonly headRepo: string;
  /** True when the head branch is in another repository (a fork PR: no secrets, never auto-merged). */
  readonly fork: boolean;
  readonly base: string;
  readonly headSha: string;
  readonly state: PrState;
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly author: string;
  readonly autoMerge: boolean;
  readonly mergeCommitSha: string | null;
  readonly createdAt: string;
}

export interface OpenOrUpdatePrInput {
  readonly head: string;
  /** Default: the default branch. */
  readonly base?: string;
  readonly title: string;
  readonly body: string;
  readonly draft?: boolean;
  /** Added (never removed) on create and update. */
  readonly labels?: readonly string[];
}

export interface ListPrsFilter {
  /** Default `open`. */
  readonly state?: PrState | 'all';
  readonly head?: string;
  readonly label?: string;
}

export interface PrFile {
  /** Path after the change (the new path of a rename). */
  readonly path: string;
  readonly status: 'added' | 'modified' | 'removed' | 'renamed';
  /** For `renamed`: the old path, which matters when a file moves out of a protected directory. */
  readonly previousPath?: string;
}

export interface IssueComment {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type IssueEventType =
  'labeled' | 'unlabeled' | 'committed' | 'merged' | 'closed' | 'reopened' | 'auto_merge_enabled';

/** A timeline event. `actor` is who did it, which is how approval by label is verified. */
export interface IssueEvent {
  readonly id: number;
  readonly event: IssueEventType;
  readonly actor: string;
  readonly createdAt: string;
  /** For `labeled` / `unlabeled`. */
  readonly label?: string;
  /** For `committed` and `merged`. */
  readonly sha?: string;
}

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out';

export interface CheckRun {
  readonly name: string;
  readonly headSha: string;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: CheckConclusion | null;
}

export interface WaitForChecksInput {
  readonly sha: string;
  /** Required check names not to wait for (for example the job that is waiting). */
  readonly exclude?: readonly string[];
  readonly timeoutMs?: number;
}

export interface RequiredChecksResult {
  readonly sha: string;
  /** Every awaited check completed as success, neutral or skipped. */
  readonly ok: boolean;
  readonly checks: readonly CheckRun[];
}

/** A completed check run to publish on a commit (Checks API). */
export interface CreateCheckRunInput {
  readonly name: string;
  readonly headSha: string;
  readonly conclusion: CheckConclusion;
  readonly title: string;
  /** Markdown; GitHub truncates above 65,535 characters. */
  readonly summary: string;
}

export interface WorkflowRun {
  readonly id: number;
  /** Workflow file name, for example `content-gates.yml`. */
  readonly workflowFile: string;
  /** Triggering event: `pull_request`, `issue_comment`, `workflow_dispatch`, `push`. */
  readonly event: string;
  readonly headSha: string;
  readonly headBranch: string;
  /**
   * PRs the run belongs to. Real GitHub fills this only for `pull_request`-style events; it is
   * empty for `issue_comment` and `workflow_dispatch` runs, so a "run belongs to PR n" check
   * must use the run's head branch or inputs for those.
   */
  readonly prNumbers: readonly number[];
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: CheckConclusion | null;
  readonly actor: string;
  /**
   * The run's title (`display_title`): the workflow's `run-name:` when it sets one. content-gates.yml
   * names its runs after the PR, which is how an `issue_comment` or `workflow_dispatch` run (no
   * `prNumbers`) is tied to its PR.
   */
  readonly displayTitle: string;
  /** Server timestamp (ISO) of when GitHub created the run; never a commit date. */
  readonly createdAt: string;
}

export interface Issue {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  readonly labels: readonly string[];
  readonly author: string;
}

export interface UpsertIssueInput {
  readonly title: string;
  readonly body: string;
  /** Added (never removed). */
  readonly labels?: readonly string[];
  /** Default `open`. */
  readonly state?: 'open' | 'closed';
}

export interface GitHubClient {
  /** Login of the account this client acts as. */
  viewer(): Promise<string>;
  /** Rejects with `conflict` when the branch exists. */
  createBranch(input: CreateBranchInput): Promise<{ readonly name: string; readonly sha: string }>;
  /**
   * One commit with all the changes on top of the branch head, created through the Git Data
   * API so GitHub signs it (`verified: true`); never a local `git push`. The approval commit
   * (L-031) relies on this.
   */
  commitFiles(input: CommitFilesInput): Promise<GitCommit>;
  getCommit(sha: string): Promise<GitCommit>;
  /** Opens a PR for `head`, or updates the open one (title, body, draft, labels and a changed `base`). */
  openOrUpdatePr(input: OpenOrUpdatePrInput): Promise<{ readonly pr: PullRequest; readonly created: boolean }>;
  getPr(number: number): Promise<PullRequest>;
  /** Sorted by number. */
  listPrs(filter?: ListPrsFilter): Promise<readonly PullRequest[]>;
  /** Files the PR changes against its base, sorted by path. */
  getPrFiles(number: number): Promise<readonly PrFile[]>;
  /** Creates missing labels in the repo; adding a present label is a no-op. Returns the labels after. */
  addLabels(number: number, labels: readonly string[]): Promise<readonly string[]>;
  /** Removing an absent label is a no-op. Returns the labels after. */
  removeLabels(number: number, labels: readonly string[]): Promise<readonly string[]>;
  /**
   * One sticky comment per marker and author: updates this viewer's comment that contains
   * `markerComment(marker)`, or creates it. The marker is appended to the body if missing.
   */
  upsertComment(
    number: number,
    marker: string,
    body: string,
  ): Promise<{ readonly comment: IssueComment; readonly created: boolean }>;
  /** Oldest first. */
  listComments(number: number): Promise<readonly IssueComment[]>;
  /** Timeline events with actors, oldest first. */
  listIssueEvents(number: number): Promise<readonly IssueEvent[]>;
  enableAutoMerge(number: number, options?: { readonly method?: 'squash' | 'merge' | 'rebase' }): Promise<void>;
  /**
   * Merges only if the PR is open, not a draft and its head is still `matchHeadSha`
   * (otherwise `conflict`). Returns the merge commit sha.
   */
  mergePr(
    number: number,
    options: { readonly matchHeadSha: string; readonly method?: 'squash' | 'merge' | 'rebase' },
  ): Promise<{ readonly sha: string }>;
  /** Waits until the required checks on `sha` complete (`timeout` error otherwise). */
  waitForRequiredChecks(input: WaitForChecksInput): Promise<RequiredChecksResult>;
  /** `workflow_dispatch` on `ref`. Rejects with `not-found` for an unknown workflow file or ref. */
  dispatchWorkflow(file: string, ref: string, inputs?: Readonly<Record<string, string>>): Promise<void>;
  /** One issue per marker: updates the issue whose body contains `markerComment(marker)`, or creates it. */
  upsertIssue(marker: string, input: UpsertIssueInput): Promise<{ readonly issue: Issue; readonly created: boolean }>;
  getWorkflowRun(id: number): Promise<WorkflowRun>;
  /**
   * Every workflow run for head commit `sha` (any workflow, any event), oldest first, with server
   * timestamps and events. The merge-rule job (L-031) builds head observations from the
   * `pull_request` runs of content-gates.yml (`headObservationsFromRuns`).
   */
  listRunsForSha(sha: string): Promise<readonly WorkflowRun[]>;
  /**
   * Publishes a completed check run on `headSha` (Checks API, `checks: write`). The trusted
   * content-gates workflow (L-031) reports `merge-rule` on the PR head this way, because its own
   * jobs report on main.
   */
  createCheckRun(input: CreateCheckRunInput): Promise<CheckRun>;
  /**
   * Names of the artifacts workflow run `id` uploaded (expired ones included), sorted. Only a run's
   * own jobs can upload to it, so an artifact name is evidence of what that run did: the trusted
   * merge-rule job (L-031) names one after the PR and head it approves before writing the commit.
   */
  listRunArtifacts(id: number): Promise<readonly string[]>;
}

/** The hidden HTML comment that marks a sticky comment or issue. */
export function markerComment(marker: string): string {
  if (!/^[\w.:/-]+$/.test(marker)) throw new RangeError(`invalid marker: "${marker}"`);
  return `<!-- ${marker} -->`;
}

/** `body` with the marker appended unless it already contains it. */
export function withMarker(marker: string, body: string): string {
  const tag = markerComment(marker);
  return body.includes(tag) ? body : `${body}\n\n${tag}`;
}
