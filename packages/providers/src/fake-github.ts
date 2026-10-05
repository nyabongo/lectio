import type { Clock } from './clock.ts';
import { FakeClock } from './clock.ts';
import { ProviderError } from './errors.ts';
import type {
  CheckConclusion,
  CheckRun,
  CommitFilesInput,
  CreateBranchInput,
  GitCommit,
  GitHubClient,
  Issue,
  IssueComment,
  IssueEvent,
  IssueEventType,
  ListPrsFilter,
  OpenOrUpdatePrInput,
  PrFile,
  PullRequest,
  RequiredChecksResult,
  UpsertIssueInput,
  WaitForChecksInput,
  WorkflowRun,
} from './github.ts';
import { markerComment, withMarker } from './github.ts';
import { sha256Hex, stableStringify } from './hash.ts';

type Tree = ReadonlyMap<string, string>;

interface CommitRecord extends GitCommit {
  readonly seq: number;
  readonly tree: Tree;
}

interface ThreadRecord {
  readonly number: number;
  readonly kind: 'pr' | 'issue';
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  readonly labels: string[];
  readonly author: string;
  readonly createdAt: string;
  // PR only
  readonly head: string;
  readonly base: string;
  readonly forkSha: string;
  draft: boolean;
  autoMerge: boolean;
  mergeCommitSha: string | null;
}

interface EventRecord extends IssueEvent {
  readonly number: number;
}

interface CommentRecord {
  readonly id: number;
  readonly number: number;
  readonly author: string;
  body: string;
  readonly createdAt: string;
  updatedAt: string;
}

/** A workflow the fake knows: dispatching it creates a run and completes these check runs. */
export interface FakeWorkflow {
  /** Check run names (job names) the workflow reports on the dispatched ref's head sha. */
  readonly jobs?: readonly string[];
  /** Conclusion of the run and its check runs. Default `success`. */
  readonly conclusion?: CheckConclusion;
}

/** A recorded `workflow_dispatch`. */
export interface FakeDispatch {
  readonly file: string;
  readonly ref: string;
  readonly sha: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly actor: string;
  readonly runId: number;
  readonly createdAt: string;
}

/** A recorded merge. */
export interface FakeMerge {
  readonly number: number;
  readonly headSha: string;
  readonly sha: string;
  readonly method: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface FakeGitHubOptions {
  /** `owner/name`, used in URLs. Default `nyabongo/lectio`. */
  readonly repo?: string;
  /** Default `main`. */
  readonly defaultBranch?: string;
  /** Who the root client acts as. Default `lectio-bot`. */
  readonly actor?: string;
  /** Files on the default branch's initial commit. */
  readonly files?: Readonly<Record<string, string>>;
  /** Check names branch protection requires (`waitForRequiredChecks` awaits these). */
  readonly requiredChecks?: readonly string[];
  /** Workflows that can be dispatched, by file name. Others are `not-found`. */
  readonly workflows?: Readonly<Record<string, FakeWorkflow>>;
  /** Base for timestamps; every mutation is stamped at least one second after the previous one. */
  readonly clock?: Clock;
}

class FakeRepo {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly requiredChecks: readonly string[];
  readonly workflows: Readonly<Record<string, FakeWorkflow>>;
  readonly clock: Clock;
  readonly commits = new Map<string, CommitRecord>();
  readonly branches = new Map<string, { head: string; forkSha: string }>();
  readonly threads = new Map<number, ThreadRecord>();
  readonly events: EventRecord[] = [];
  readonly comments: CommentRecord[] = [];
  readonly checks = new Map<string, Map<string, CheckRun>>();
  readonly runs = new Map<number, WorkflowRun>();
  readonly repoLabels = new Set<string>();
  readonly dispatches: FakeDispatch[] = [];
  readonly merges: FakeMerge[] = [];
  #seq = 0;
  #lastMs = -Infinity;
  #nextNumber = 1;
  #nextRunId = 1000;

  constructor(options: FakeGitHubOptions) {
    this.repo = options.repo ?? 'nyabongo/lectio';
    this.defaultBranch = options.defaultBranch ?? 'main';
    this.requiredChecks = options.requiredChecks ?? [];
    this.workflows = options.workflows ?? {};
    this.clock = options.clock ?? new FakeClock();
    const root = this.commit([], new Map(Object.entries(options.files ?? {})), 'Initial commit', 'lectio-owner', true);
    this.branches.set(this.defaultBranch, { head: root.sha, forkSha: root.sha });
  }

  /** The next sequence number and a timestamp strictly after the previous one. */
  stamp(): { seq: number; at: string } {
    this.#seq += 1;
    const ms = Math.max(this.clock.now().getTime(), this.#lastMs + 1000);
    this.#lastMs = ms;
    return { seq: this.#seq, at: new Date(ms).toISOString() };
  }

  nextNumber(): number {
    return this.#nextNumber++;
  }

  nextRunId(): number {
    return this.#nextRunId++;
  }

  commit(parents: string[], tree: Tree, message: string, author: string, verified: boolean): CommitRecord {
    const { seq, at } = this.stamp();
    const sha = sha256Hex(stableStringify({ parents, tree: [...tree].sort(), message, author, seq })).slice(0, 40);
    const record: CommitRecord = { sha, parents, message, author, verified, createdAt: at, seq, tree };
    this.commits.set(sha, record);
    return record;
  }

  getCommit(sha: string): CommitRecord {
    const commit = this.commits.get(sha);
    if (!commit) throw new ProviderError('not-found', `no commit ${sha}`);
    return commit;
  }

  branch(name: string): { head: string; forkSha: string } {
    const branch = this.branches.get(name);
    if (!branch) throw new ProviderError('not-found', `no branch ${name}`);
    return branch;
  }

  thread(number: number, kind?: 'pr' | 'issue'): ThreadRecord {
    const thread = this.threads.get(number);
    if (!thread || (kind !== undefined && thread.kind !== kind)) {
      throw new ProviderError('not-found', `no ${kind ?? 'issue or pr'} #${number}`);
    }
    return thread;
  }

  event(number: number, event: IssueEventType, actor: string, extra: { label?: string; sha?: string } = {}): void {
    const { seq, at } = this.stamp();
    this.events.push({ id: seq, number, event, actor, createdAt: at, ...extra });
  }

  toPr(thread: ThreadRecord): PullRequest {
    return {
      number: thread.number,
      url: `https://github.com/${this.repo}/pull/${thread.number}`,
      title: thread.title,
      body: thread.body,
      head: thread.head,
      base: thread.base,
      headSha: this.headOf(thread),
      state: thread.state,
      draft: thread.draft,
      labels: [...thread.labels],
      author: thread.author,
      autoMerge: thread.autoMerge,
      mergeCommitSha: thread.mergeCommitSha,
      createdAt: thread.createdAt,
    };
  }

  toIssue(thread: ThreadRecord): Issue {
    return {
      number: thread.number,
      url: `https://github.com/${this.repo}/issues/${thread.number}`,
      title: thread.title,
      body: thread.body,
      state: thread.state === 'closed' ? 'closed' : 'open',
      labels: [...thread.labels],
      author: thread.author,
    };
  }

  /** A PR's head: the merged head for a merged PR (its branch may have moved since), else the branch head. */
  headOf(thread: ThreadRecord): string {
    const merge = this.merges.find((m) => m.number === thread.number);
    return merge?.headSha ?? this.branch(thread.head).head;
  }

  setCheck(run: CheckRun): void {
    const bySha = this.checks.get(run.headSha) ?? new Map<string, CheckRun>();
    bySha.set(run.name, run);
    this.checks.set(run.headSha, bySha);
  }
}

function toComment(record: CommentRecord): IssueComment {
  return {
    id: record.id,
    author: record.author,
    body: record.body,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function diff(base: Tree, head: Tree): PrFile[] {
  const changes = new Map<string, PrFile['status']>();
  for (const [path, content] of head) {
    const before = base.get(path);
    if (before === undefined) changes.set(path, 'added');
    else if (before !== content) changes.set(path, 'modified');
  }
  for (const path of base.keys()) if (!head.has(path)) changes.set(path, 'removed');
  return [...changes.keys()].sort().map((path) => ({ path, status: changes.get(path) as PrFile['status'] }));
}

const PASSING: ReadonlySet<CheckConclusion | null> = new Set(['success', 'neutral', 'skipped']);

/**
 * An in-memory GitHub: branches, commits, PRs, issues, labels, comments, timeline
 * events with actors, check runs, workflow runs, dispatches and merges. `as(login)`
 * returns a client acting as someone else over the same repository, which is how
 * tests make a reviewer add the `approved` label or comment `/approve`.
 */
export class FakeGitHubClient implements GitHubClient {
  readonly actor: string;
  readonly #repo: FakeRepo;

  constructor(options: FakeGitHubOptions = {}, repo?: FakeRepo) {
    this.actor = options.actor ?? 'lectio-bot';
    this.#repo = repo ?? new FakeRepo(options);
  }

  // -- fake-only helpers ----------------------------------------------------

  /** A client acting as `login` over the same repository. */
  as(login: string): FakeGitHubClient {
    return new FakeGitHubClient({ actor: login }, this.#repo);
  }

  get defaultBranch(): string {
    return this.#repo.defaultBranch;
  }

  /** Every workflow dispatch, oldest first. */
  get dispatches(): readonly FakeDispatch[] {
    return [...this.#repo.dispatches];
  }

  /** Every merge, oldest first. */
  get merges(): readonly FakeMerge[] {
    return [...this.#repo.merges];
  }

  /** Labels that exist in the repository. */
  get repoLabels(): readonly string[] {
    return [...this.#repo.repoLabels].sort();
  }

  /** Head sha of a branch. */
  headOf(branch: string): string {
    return this.#repo.branch(branch).head;
  }

  /** A file's content at a branch or sha (`undefined` when absent). */
  fileAt(ref: string, path: string): string | undefined {
    const sha = this.#repo.branches.get(ref)?.head ?? ref;
    return this.#repo.getCommit(sha).tree.get(path);
  }

  /** A plain (non-sticky) comment by this actor, such as a reviewer's `/approve`. */
  async postComment(number: number, body: string): Promise<IssueComment> {
    this.#repo.thread(number);
    const { seq, at } = this.#repo.stamp();
    const record: CommentRecord = { id: seq, number, author: this.actor, body, createdAt: at, updatedAt: at };
    this.#repo.comments.push(record);
    return toComment(record);
  }

  /** A commit as this actor, optionally unsigned (a human `git push`). */
  async pushCommit(input: CommitFilesInput & { readonly verified?: boolean }): Promise<GitCommit> {
    return this.#commitFiles(input, input.verified ?? false);
  }

  /** Records a check run on a sha (latest per name wins). */
  setCheck(sha: string, name: string, conclusion: CheckConclusion | null): void {
    this.#repo.setCheck({ name, headSha: sha, status: conclusion === null ? 'in_progress' : 'completed', conclusion });
  }

  /** Records a workflow run that was not dispatched (for example a `pull_request` run). */
  addWorkflowRun(run: Omit<WorkflowRun, 'id'> & { readonly id?: number }): WorkflowRun {
    const stored: WorkflowRun = { ...run, id: run.id ?? this.#repo.nextRunId() };
    this.#repo.runs.set(stored.id, stored);
    return stored;
  }

  /** Closes a PR without merging. */
  async closePr(number: number): Promise<void> {
    const thread = this.#repo.thread(number, 'pr');
    thread.state = 'closed';
    this.#repo.event(number, 'closed', this.actor);
  }

  // -- GitHubClient ---------------------------------------------------------

  async viewer(): Promise<string> {
    return this.actor;
  }

  async createBranch(input: CreateBranchInput): Promise<{ name: string; sha: string }> {
    const repo = this.#repo;
    if (repo.branches.has(input.name)) throw new ProviderError('conflict', `branch ${input.name} already exists`);
    const from = input.from ?? repo.defaultBranch;
    const sha = repo.branches.get(from)?.head ?? repo.getCommit(from).sha;
    repo.branches.set(input.name, { head: sha, forkSha: sha });
    return { name: input.name, sha };
  }

  async commitFiles(input: CommitFilesInput): Promise<GitCommit> {
    return this.#commitFiles(input, true);
  }

  #commitFiles(input: CommitFilesInput, verified: boolean): GitCommit {
    const repo = this.#repo;
    const branch = repo.branch(input.branch);
    if (input.expectedHeadSha !== undefined && input.expectedHeadSha !== branch.head) {
      throw new ProviderError('conflict', `${input.branch} is at ${branch.head}, not ${input.expectedHeadSha}`);
    }
    if (input.files.length === 0) throw new ProviderError('invalid-request', 'a commit needs at least one file');
    const tree = new Map(repo.getCommit(branch.head).tree);
    for (const file of input.files) {
      if (file.content === null) tree.delete(file.path);
      else tree.set(file.path, file.content);
    }
    const { tree: _tree, seq: _seq, ...commit } = repo.commit([branch.head], tree, input.message, this.actor, verified);
    branch.head = commit.sha;
    return commit;
  }

  async getCommit(sha: string): Promise<GitCommit> {
    const { tree: _tree, seq: _seq, ...commit } = this.#repo.getCommit(sha);
    return commit;
  }

  async openOrUpdatePr(input: OpenOrUpdatePrInput): Promise<{ pr: PullRequest; created: boolean }> {
    const repo = this.#repo;
    const branch = repo.branch(input.head);
    const base = input.base ?? repo.defaultBranch;
    repo.branch(base);
    if (base === input.head) throw new ProviderError('invalid-request', 'head and base are the same branch');
    const existing = [...repo.threads.values()].find(
      (t) => t.kind === 'pr' && t.state === 'open' && t.head === input.head,
    );
    if (existing) {
      existing.title = input.title;
      existing.body = input.body;
      if (input.draft !== undefined) existing.draft = input.draft;
      if (input.labels) await this.addLabels(existing.number, input.labels);
      return { pr: repo.toPr(existing), created: false };
    }
    const { at } = repo.stamp();
    const thread: ThreadRecord = {
      number: repo.nextNumber(),
      kind: 'pr',
      title: input.title,
      body: input.body,
      state: 'open',
      labels: [],
      author: this.actor,
      createdAt: at,
      head: input.head,
      base,
      forkSha: branch.forkSha,
      draft: input.draft ?? false,
      autoMerge: false,
      mergeCommitSha: null,
    };
    repo.threads.set(thread.number, thread);
    if (input.labels) await this.addLabels(thread.number, input.labels);
    return { pr: repo.toPr(thread), created: true };
  }

  async getPr(number: number): Promise<PullRequest> {
    return this.#repo.toPr(this.#repo.thread(number, 'pr'));
  }

  async listPrs(filter: ListPrsFilter = {}): Promise<readonly PullRequest[]> {
    const state = filter.state ?? 'open';
    return [...this.#repo.threads.values()]
      .filter((t) => t.kind === 'pr')
      .filter((t) => state === 'all' || t.state === state)
      .filter((t) => filter.head === undefined || t.head === filter.head)
      .filter((t) => filter.label === undefined || t.labels.includes(filter.label))
      .sort((a, b) => a.number - b.number)
      .map((t) => this.#repo.toPr(t));
  }

  async getPrFiles(number: number): Promise<readonly PrFile[]> {
    const repo = this.#repo;
    const thread = repo.thread(number, 'pr');
    return diff(repo.getCommit(thread.forkSha).tree, repo.getCommit(repo.headOf(thread)).tree);
  }

  async addLabels(number: number, labels: readonly string[]): Promise<readonly string[]> {
    const thread = this.#repo.thread(number);
    for (const label of labels) {
      this.#repo.repoLabels.add(label);
      if (thread.labels.includes(label)) continue;
      thread.labels.push(label);
      this.#repo.event(number, 'labeled', this.actor, { label });
    }
    return [...thread.labels];
  }

  async removeLabels(number: number, labels: readonly string[]): Promise<readonly string[]> {
    const thread = this.#repo.thread(number);
    for (const label of labels) {
      const index = thread.labels.indexOf(label);
      if (index === -1) continue;
      thread.labels.splice(index, 1);
      this.#repo.event(number, 'unlabeled', this.actor, { label });
    }
    return [...thread.labels];
  }

  async upsertComment(
    number: number,
    marker: string,
    body: string,
  ): Promise<{ comment: IssueComment; created: boolean }> {
    const tag = markerComment(marker);
    const text = withMarker(marker, body);
    const existing = this.#repo.comments.find(
      (c) => c.number === number && c.author === this.actor && c.body.includes(tag),
    );
    if (existing) {
      existing.body = text;
      existing.updatedAt = this.#repo.stamp().at;
      return { comment: toComment(existing), created: false };
    }
    return { comment: await this.postComment(number, text), created: true };
  }

  async listComments(number: number): Promise<readonly IssueComment[]> {
    this.#repo.thread(number);
    return this.#repo.comments.filter((c) => c.number === number).map(toComment);
  }

  async listIssueEvents(number: number): Promise<readonly IssueEvent[]> {
    const repo = this.#repo;
    const thread = repo.thread(number);
    const events: (IssueEvent & { seq: number })[] = repo.events
      .filter((e) => e.number === number)
      .map(({ number: _number, ...event }) => ({ ...event, seq: event.id }));
    if (thread.kind === 'pr') {
      for (let commit = repo.getCommit(repo.headOf(thread)); commit.sha !== thread.forkSha;) {
        events.push({
          id: commit.seq,
          seq: commit.seq,
          event: 'committed',
          actor: commit.author,
          createdAt: commit.createdAt,
          sha: commit.sha,
        });
        // The fork point is a first-parent ancestor of every PR head.
        commit = repo.getCommit(commit.parents[0] as string);
      }
    }
    return events.sort((a, b) => a.seq - b.seq).map(({ seq: _seq, ...event }) => event);
  }

  async enableAutoMerge(number: number): Promise<void> {
    const thread = this.#repo.thread(number, 'pr');
    if (thread.state !== 'open') throw new ProviderError('conflict', `#${number} is not open`);
    if (thread.autoMerge) return;
    thread.autoMerge = true;
    this.#repo.event(number, 'auto_merge_enabled', this.actor);
  }

  async mergePr(
    number: number,
    options: { readonly matchHeadSha: string; readonly method?: 'squash' | 'merge' | 'rebase' },
  ): Promise<{ sha: string }> {
    const repo = this.#repo;
    const thread = repo.thread(number, 'pr');
    if (thread.state !== 'open') throw new ProviderError('conflict', `#${number} is not open`);
    const headSha = repo.branch(thread.head).head;
    if (headSha !== options.matchHeadSha) {
      throw new ProviderError('conflict', `#${number} head is ${headSha}, not ${options.matchHeadSha}`);
    }
    const base = repo.branch(thread.base);
    const tree = new Map(repo.getCommit(base.head).tree);
    const headTree = repo.getCommit(headSha).tree;
    for (const file of diff(repo.getCommit(thread.forkSha).tree, headTree)) {
      if (file.status === 'removed') tree.delete(file.path);
      else tree.set(file.path, headTree.get(file.path) as string);
    }
    const method = options.method ?? 'squash';
    const parents = method === 'merge' ? [base.head, headSha] : [base.head];
    const commit = repo.commit(parents, tree, `${thread.title} (#${number})`, this.actor, true);
    base.head = commit.sha;
    thread.state = 'merged';
    thread.mergeCommitSha = commit.sha;
    repo.merges.push({ number, headSha, sha: commit.sha, method, actor: this.actor, createdAt: commit.createdAt });
    repo.event(number, 'merged', this.actor, { sha: commit.sha });
    return { sha: commit.sha };
  }

  async waitForRequiredChecks(input: WaitForChecksInput): Promise<RequiredChecksResult> {
    const exclude = new Set(input.exclude ?? []);
    const bySha = this.#repo.checks.get(input.sha);
    const checks = this.#repo.requiredChecks
      .filter((name) => !exclude.has(name))
      .map((name): CheckRun => bySha?.get(name) ?? { name, headSha: input.sha, status: 'queued', conclusion: null });
    const pending = checks.filter((c) => c.status !== 'completed').map((c) => c.name);
    if (pending.length > 0) {
      throw new ProviderError('timeout', `required checks on ${input.sha} did not finish: ${pending.join(', ')}`);
    }
    return { sha: input.sha, ok: checks.every((c) => PASSING.has(c.conclusion)), checks };
  }

  async dispatchWorkflow(file: string, ref: string, inputs: Readonly<Record<string, string>> = {}): Promise<void> {
    const repo = this.#repo;
    const workflow = repo.workflows[file];
    if (!workflow) throw new ProviderError('not-found', `no workflow ${file}`);
    const sha = repo.branch(ref).head;
    const conclusion = workflow.conclusion ?? 'success';
    const run = this.addWorkflowRun({
      workflowFile: file,
      event: 'workflow_dispatch',
      headSha: sha,
      headBranch: ref,
      prNumbers: [],
      status: 'completed',
      conclusion,
      actor: this.actor,
    });
    for (const job of workflow.jobs ?? []) this.setCheck(sha, job, conclusion);
    repo.dispatches.push({
      file,
      ref,
      sha,
      inputs: { ...inputs },
      actor: this.actor,
      runId: run.id,
      createdAt: repo.stamp().at,
    });
  }

  async upsertIssue(marker: string, input: UpsertIssueInput): Promise<{ issue: Issue; created: boolean }> {
    const repo = this.#repo;
    const tag = markerComment(marker);
    const body = withMarker(marker, input.body);
    const state = input.state ?? 'open';
    let thread = [...repo.threads.values()].find((t) => t.kind === 'issue' && t.body.includes(tag));
    const created = thread === undefined;
    if (thread) {
      thread.title = input.title;
      thread.body = body;
      if (thread.state !== state) {
        thread.state = state;
        repo.event(thread.number, state === 'closed' ? 'closed' : 'reopened', this.actor);
      }
    } else {
      const { at } = repo.stamp();
      thread = {
        number: repo.nextNumber(),
        kind: 'issue',
        title: input.title,
        body,
        state,
        labels: [],
        author: this.actor,
        createdAt: at,
        head: '',
        base: '',
        forkSha: '',
        draft: false,
        autoMerge: false,
        mergeCommitSha: null,
      };
      repo.threads.set(thread.number, thread);
    }
    if (input.labels) await this.addLabels(thread.number, input.labels);
    return { issue: repo.toIssue(thread), created };
  }

  async getWorkflowRun(id: number): Promise<WorkflowRun> {
    const run = this.#repo.runs.get(id);
    if (!run) throw new ProviderError('not-found', `no workflow run ${id}`);
    return run;
  }
}
