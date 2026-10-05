import { markerComment, ProviderError, withMarker } from '@lectio/providers';
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
  PrState,
  PullRequest,
  RequiredChecksResult,
  UpsertIssueInput,
  WaitForChecksInput,
  WorkflowRun,
} from '@lectio/providers';

import type { Exec, ExecResult, GitRunner } from './exec.ts';
import { createGitRunner, createProcessExec } from './exec.ts';
import type { Json, JsonObject } from './output.ts';
import {
  arr,
  asArray,
  asObject,
  bool,
  flattenPages,
  ghError,
  labelNames,
  login,
  num,
  obj,
  optObj,
  optStr,
  parseJson,
  str,
} from './output.ts';

export interface GhGitHubClientOptions {
  /** `owner/name`. Default: the `origin` remote of the local checkout, read through `git`. */
  readonly repo?: string;
  /** Runs `gh`. Default: spawns the `gh` on PATH. */
  readonly exec?: Exec;
  /** Local git operations. Default: the `git` on PATH. */
  readonly git?: GitRunner;
  /**
   * Login this client acts as. Pass `github-actions[bot]` under the Actions `GITHUB_TOKEN`,
   * which cannot read `GET /user`. Default: asked from gh (`/user`, then GraphQL `viewer`,
   * then `github-actions[bot]` when `GITHUB_ACTIONS=true`).
   */
  readonly viewer?: string;
  /**
   * Required check names, for example from the `.github/required-checks` registry. Default:
   * read from the base branch's rulesets and branch protection on every `waitForRequiredChecks`.
   */
  readonly requiredChecks?: readonly string[];
  /** Environment, for `GITHUB_ACTIONS`. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How long `waitForRequiredChecks` waits without its own `timeoutMs`. Default 30 minutes. */
  readonly checksTimeoutMs?: number;
  /** Delay between check-run polls. Default 10 seconds. */
  readonly pollIntervalMs?: number;
  /** Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests (epoch milliseconds). */
  readonly now?: () => number;
}

/** Fields `gh pr view/list --json` returns for a `PullRequest`. */
export const PR_FIELDS = [
  'number',
  'url',
  'title',
  'body',
  'headRefName',
  'headRepository',
  'headRepositoryOwner',
  'isCrossRepository',
  'baseRefName',
  'headRefOid',
  'state',
  'isDraft',
  'labels',
  'author',
  'autoMergeRequest',
  'mergeCommit',
  'createdAt',
].join(',');

/** Fields `gh issue view/list --json` returns for an `Issue`. */
export const ISSUE_FIELDS = 'number,url,title,body,state,labels,author';

/** `gh ... list --limit`: gh pages through everything up to this many. */
const LIST_LIMIT = '100000';
const ISSUE_EVENTS: ReadonlySet<string> = new Set<IssueEventType>([
  'labeled',
  'unlabeled',
  'committed',
  'merged',
  'closed',
  'reopened',
  'auto_merge_enabled',
]);

const RUN_CONCLUSIONS: ReadonlySet<string> = new Set<CheckConclusion>([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
]);

const PASSING: ReadonlySet<CheckConclusion | null> = new Set(['success', 'neutral', 'skipped']);

/** A REST conclusion as a `CheckConclusion` (`action_required`, `stale`, `startup_failure` count as failure). */
function conclusionOf(value: string | undefined): CheckConclusion | null {
  if (value === undefined) return null;
  return RUN_CONCLUSIONS.has(value) ? (value as CheckConclusion) : 'failure';
}

/** A REST run or check status (`waiting`, `requested`, `pending` count as queued). */
function statusOf(value: string): CheckRun['status'] {
  return value === 'completed' || value === 'in_progress' ? value : 'queued';
}

/**
 * A path segment per ref segment, so `a/b` stays `a/b` and `#` is escaped. Empty, `.` and
 * `..` segments are refused so a ref cannot move the request to another API path.
 */
function refPath(ref: string): string {
  const segments = ref.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ProviderError('invalid-request', `invalid ref: "${ref}"`);
  }
  return segments.map(encodeURIComponent).join('/');
}

/** The trailing number of a URL gh printed (`.../pull/12`, `.../issues/7`). */
function numberFromUrl(stdout: string, kind: 'pull' | 'issues'): number {
  const match = new RegExp(`/${kind}/(\\d+)\\s*$`).exec(stdout.trim());
  if (!match) throw new ProviderError('malformed-output', `gh did not print a ${kind} URL: ${stdout.trim()}`);
  return Number(match[1]);
}

function toPr(value: Json): PullRequest {
  const pr = asObject(value, 'pull request');
  const owner = login(pr, 'headRepositoryOwner');
  const headRepository = optObj(pr, 'headRepository');
  const mergeCommit = optObj(pr, 'mergeCommit');
  const state = str(pr, 'state').toLowerCase();
  return {
    number: num(pr, 'number'),
    url: str(pr, 'url'),
    title: str(pr, 'title'),
    body: str(pr, 'body'),
    head: str(pr, 'headRefName'),
    // A deleted fork has no head repository; keep the owner so the PR still reads as a fork.
    headRepo: `${owner}/${headRepository ? str(headRepository, 'name') : 'unknown'}`,
    fork: bool(pr, 'isCrossRepository'),
    base: str(pr, 'baseRefName'),
    headSha: str(pr, 'headRefOid'),
    state: (state === 'merged' || state === 'closed' ? state : 'open') satisfies PrState,
    draft: bool(pr, 'isDraft'),
    labels: labelNames(pr['labels']),
    author: login(pr, 'author'),
    autoMerge: optObj(pr, 'autoMergeRequest') !== undefined,
    mergeCommitSha: mergeCommit ? str(mergeCommit, 'oid') : null,
    createdAt: str(pr, 'createdAt'),
  };
}

function toIssue(value: Json): Issue {
  const issue = asObject(value, 'issue');
  return {
    number: num(issue, 'number'),
    url: str(issue, 'url'),
    title: str(issue, 'title'),
    body: str(issue, 'body'),
    state: str(issue, 'state').toLowerCase() === 'closed' ? 'closed' : 'open',
    labels: labelNames(issue['labels']),
    author: login(issue, 'author'),
  };
}

function toComment(value: Json): IssueComment {
  const comment = asObject(value, 'comment');
  return {
    id: num(comment, 'id'),
    author: login(comment, 'user'),
    body: str(comment, 'body'),
    createdAt: str(comment, 'created_at'),
    updatedAt: str(comment, 'updated_at'),
  };
}

function toPrFile(value: Json): PrFile {
  const file = asObject(value, 'file');
  const path = str(file, 'filename');
  const status = str(file, 'status');
  if (status === 'renamed') return { path, status, previousPath: str(file, 'previous_filename') };
  if (status === 'added' || status === 'copied') return { path, status: 'added' };
  return { path, status: status === 'removed' ? 'removed' : 'modified' };
}

function toWorkflowRun(value: Json): WorkflowRun {
  const run = asObject(value, 'workflow run');
  return {
    id: num(run, 'id'),
    workflowFile: str(run, 'path').replace(/@.*$/, '').split('/').pop() as string,
    event: str(run, 'event'),
    headSha: str(run, 'head_sha'),
    headBranch: str(run, 'head_branch'),
    prNumbers: arr(run, 'pull_requests').map((pr) => num(asObject(pr, 'pull request'), 'number')),
    status: statusOf(str(run, 'status')),
    conclusion: conclusionOf(optStr(run, 'conclusion')),
    actor: login(run, 'actor'),
  };
}

/** A stable numeric id for a timeline `committed` event, which has none of its own. */
function commitEventId(sha: string): number {
  return Number.parseInt(sha.slice(0, 12), 16);
}

/**
 * `GitHubClient` on the gh CLI. Every call shells out through the injected `exec`
 * (`gh pr ...`, `gh issue ...`, `gh label ...`, `gh workflow run`, and `gh api` for the
 * Git Data API, comments, timeline events and workflow runs), so it works on the owner's
 * machine with `gh auth login` and in Actions with `GH_TOKEN`.
 *
 * `listIssueEvents` dates a `committed` event with the commit's committer date, which whoever
 * creates the commit chooses (the timeline has no push time); order approvals against
 * commits by sha, not by that date alone.
 *
 * Not registered in `createProviders`: the research CLI (L-038), the merge-rule job (L-031)
 * and the runway monitor (L-073) construct and inject it.
 */
export class GhGitHubClient implements GitHubClient {
  readonly #exec: Exec;
  readonly #git: GitRunner;
  readonly #repoOption: string | undefined;
  readonly #viewerOption: string | undefined;
  readonly #requiredChecksOption: readonly string[] | undefined;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #checksTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #repo: Promise<string> | undefined;
  #viewer: Promise<string> | undefined;
  #defaultBranch: Promise<string> | undefined;
  #labels: Promise<Set<string>> | undefined;

  constructor(options: GhGitHubClientOptions = {}) {
    this.#exec = options.exec ?? createProcessExec('gh');
    this.#git = options.git ?? createGitRunner();
    this.#repoOption = options.repo;
    this.#viewerOption = options.viewer;
    this.#requiredChecksOption = options.requiredChecks;
    this.#env = options.env ?? process.env;
    this.#checksTimeoutMs = options.checksTimeoutMs ?? 30 * 60_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
  }

  /** `owner/name` this client works on. */
  repo(): Promise<string> {
    this.#repo ??= this.#repoOption === undefined ? this.#git.originRepo() : Promise.resolve(this.#repoOption);
    return this.#repo;
  }

  // -- running gh -----------------------------------------------------------

  #run(args: readonly string[], input?: string): Promise<ExecResult> {
    return this.#exec(args, input === undefined ? undefined : { input });
  }

  async #gh(args: readonly string[], input?: string): Promise<string> {
    const result = await this.#run(args, input);
    if (result.exitCode !== 0) throw ghError(args, result);
    return result.stdout;
  }

  async #apiRaw(
    method: string,
    path: string,
    body?: unknown,
    flags: readonly string[] = [],
  ): Promise<{ args: string[]; result: ExecResult }> {
    const repo = await this.repo();
    const args = ['api', '-X', method, `repos/${repo}${path}`, ...flags];
    if (body !== undefined) args.push('--input', '-');
    const result = await this.#run(args, body === undefined ? undefined : JSON.stringify(body));
    return { args, result };
  }

  /** `gh api` on a path under `repos/<repo>`, parsed as JSON. */
  async #api(method: string, path: string, body?: unknown, flags: readonly string[] = []): Promise<Json> {
    const { args, result } = await this.#apiRaw(method, path, body, flags);
    if (result.exitCode !== 0) throw ghError(args, result);
    return parseJson(result.stdout, `${method} ${path}`);
  }

  /** Every page of a list endpoint. */
  async #apiList(path: string): Promise<readonly Json[]> {
    return flattenPages(await this.#api('GET', path, undefined, ['--paginate', '--slurp']), path);
  }

  async #ghJson(args: readonly string[]): Promise<Json> {
    return parseJson(await this.#gh(args), args.slice(0, 2).join(' '));
  }

  #defaultBranchName(): Promise<string> {
    this.#defaultBranch ??= this.#api('GET', '').then((repo) => str(asObject(repo, 'repo'), 'default_branch'));
    return this.#defaultBranch;
  }

  // -- GitHubClient ---------------------------------------------------------

  viewer(): Promise<string> {
    this.#viewer ??= this.#viewerOption === undefined ? this.#askViewer() : Promise.resolve(this.#viewerOption);
    return this.#viewer;
  }

  async #askViewer(): Promise<string> {
    const args = ['api', 'user'];
    const user = await this.#run(args);
    if (user.exitCode === 0) return str(asObject(parseJson(user.stdout, 'user'), 'user'), 'login');
    // Installation tokens (the Actions GITHUB_TOKEN, app tokens) cannot read /user.
    const graphql = await this.#run(['api', 'graphql', '-f', 'query={viewer{login}}']);
    if (graphql.exitCode === 0) {
      return str(obj(obj(asObject(parseJson(graphql.stdout, 'viewer'), 'graphql'), 'data'), 'viewer'), 'login');
    }
    if (this.#env['GITHUB_ACTIONS'] === 'true') return 'github-actions[bot]';
    throw ghError(args, user);
  }

  async createBranch(input: CreateBranchInput): Promise<{ name: string; sha: string }> {
    const from = input.from ?? (await this.#defaultBranchName());
    const { sha } = await this.getCommit(from);
    const { args, result } = await this.#apiRaw('POST', '/git/refs', { ref: `refs/heads/${input.name}`, sha });
    if (result.exitCode !== 0) {
      const exists = /already exists/i.test(result.stdout + result.stderr);
      throw ghError(args, result, exists ? 'conflict' : undefined);
    }
    return { name: input.name, sha };
  }

  async commitFiles(input: CommitFilesInput): Promise<GitCommit> {
    if (input.files.length === 0) throw new ProviderError('invalid-request', 'a commit needs at least one file');
    const ref = asObject(await this.#api('GET', `/git/ref/heads/${refPath(input.branch)}`), 'ref');
    const head = str(obj(ref, 'object'), 'sha');
    if (input.expectedHeadSha !== undefined && input.expectedHeadSha !== head) {
      throw new ProviderError('conflict', `${input.branch} is at ${head}, not ${input.expectedHeadSha}`);
    }
    const headCommit = asObject(await this.#api('GET', `/commits/${head}`), 'commit');
    const baseTree = str(obj(obj(headCommit, 'commit'), 'tree'), 'sha');
    const modes = await this.#blobModes(baseTree);
    const tree = asObject(
      await this.#api('POST', '/git/trees', {
        base_tree: baseTree,
        tree: input.files.map((file) => {
          // Keep an existing file's mode (an executable stays executable).
          const mode = modes.get(file.path) ?? '100644';
          return file.content === null
            ? { path: file.path, mode, type: 'blob', sha: null }
            : { path: file.path, mode, type: 'blob', content: file.content };
        }),
      }),
      'tree',
    );
    const commit = asObject(
      await this.#api('POST', '/git/commits', { message: input.message, tree: str(tree, 'sha'), parents: [head] }),
      'commit',
    );
    const sha = str(commit, 'sha');
    const { args, result } = await this.#apiRaw('PATCH', `/git/refs/heads/${refPath(input.branch)}`, {
      sha,
      force: false,
    });
    if (result.exitCode !== 0) {
      // Someone pushed between reading the head and moving the ref.
      const moved = /fast.forward/i.test(result.stdout + result.stderr);
      throw ghError(args, result, moved ? 'conflict' : undefined);
    }
    return this.getCommit(sha);
  }

  /** Path to mode of every blob in a tree (a truncated listing of a huge tree falls back to `100644`). */
  async #blobModes(tree: string): Promise<Map<string, string>> {
    const listing = asObject(await this.#api('GET', `/git/trees/${tree}?recursive=1`), 'tree');
    const modes = new Map<string, string>();
    for (const entry of arr(listing, 'tree').map((value) => asObject(value, 'tree entry'))) {
      if (entry['type'] === 'blob') modes.set(str(entry, 'path'), str(entry, 'mode'));
    }
    return modes;
  }

  async getCommit(sha: string): Promise<GitCommit> {
    const { args, result } = await this.#apiRaw('GET', `/commits/${refPath(sha)}`);
    // An unknown sha is a 422 ("No commit found"), an unknown branch a 404.
    if (result.exitCode !== 0)
      throw ghError(args, result, /HTTP 4(04|22)/.test(result.stderr) ? 'not-found' : undefined);
    const data = asObject(parseJson(result.stdout, 'commit'), 'commit');
    const commit = obj(data, 'commit');
    const author = optObj(data, 'author');
    return {
      sha: str(data, 'sha'),
      parents: arr(data, 'parents').map((parent) => str(asObject(parent, 'parent'), 'sha')),
      message: str(commit, 'message'),
      author: author ? str(author, 'login') : str(obj(commit, 'author'), 'name'),
      verified: bool(obj(commit, 'verification'), 'verified'),
      createdAt: str(obj(commit, 'committer'), 'date'),
    };
  }

  async openOrUpdatePr(input: OpenOrUpdatePrInput): Promise<{ pr: PullRequest; created: boolean }> {
    const repo = await this.repo();
    const existing = (await this.#listPrs('open', ['--head', input.head])).find((pr) => !pr.fork);
    let number: number;
    if (existing) {
      number = existing.number;
      const args = ['pr', 'edit', String(number), '-R', repo, '--title', input.title, '--body-file', '-'];
      if (input.base !== undefined && input.base !== existing.base) args.push('--base', input.base);
      await this.#gh(args, input.body);
      if (input.draft !== undefined && input.draft !== existing.draft) {
        await this.#gh(['pr', 'ready', String(number), '-R', repo, ...(input.draft ? ['--undo'] : [])]);
      }
    } else {
      const base = input.base ?? (await this.#defaultBranchName());
      const args = ['pr', 'create', '-R', repo, '--head', input.head, '--base', base, '--title', input.title];
      args.push('--body-file', '-', ...(input.draft === true ? ['--draft'] : []));
      number = numberFromUrl(await this.#gh(args, input.body), 'pull');
    }
    if (input.labels !== undefined && input.labels.length > 0) await this.addLabels(number, input.labels);
    return { pr: await this.getPr(number), created: existing === undefined };
  }

  async getPr(number: number): Promise<PullRequest> {
    const repo = await this.repo();
    return toPr(await this.#ghJson(['pr', 'view', String(number), '-R', repo, '--json', PR_FIELDS]));
  }

  async #listPrs(state: PrState | 'all', flags: readonly string[]): Promise<PullRequest[]> {
    const repo = await this.repo();
    const args = ['pr', 'list', '-R', repo, '--state', state, '--limit', LIST_LIMIT, '--json', PR_FIELDS, ...flags];
    return asArray(await this.#ghJson(args), 'pull requests')
      .map(toPr)
      .filter((pr) => state === 'all' || pr.state === state)
      .sort((a, b) => a.number - b.number);
  }

  listPrs(filter: ListPrsFilter = {}): Promise<readonly PullRequest[]> {
    const flags = [
      ...(filter.head === undefined ? [] : ['--head', filter.head]),
      ...(filter.label === undefined ? [] : ['--label', filter.label]),
    ];
    return this.#listPrs(filter.state ?? 'open', flags);
  }

  async getPrFiles(number: number): Promise<readonly PrFile[]> {
    const files = (await this.#apiList(`/pulls/${number}/files`)).map(toPrFile);
    // Paths are unique within a PR.
    return files.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  /** Creates the labels the repository does not have yet. */
  async #ensureLabels(labels: readonly string[]): Promise<void> {
    const repo = await this.repo();
    this.#labels ??= this.#ghJson(['label', 'list', '-R', repo, '--limit', LIST_LIMIT, '--json', 'name']).then(
      (out) => new Set(labelNames(out)),
    );
    const known = await this.#labels;
    for (const label of labels) {
      if (known.has(label)) continue;
      const args = ['label', 'create', '-R', repo, '--', label];
      const result = await this.#run(args);
      // Another run may have created it since the list was read.
      if (result.exitCode !== 0 && !/already exists/i.test(result.stderr)) throw ghError(args, result);
      known.add(label);
    }
  }

  async #labelsOf(number: number): Promise<string[]> {
    return labelNames(await this.#api('GET', `/issues/${number}/labels`));
  }

  async addLabels(number: number, labels: readonly string[]): Promise<readonly string[]> {
    if (labels.length === 0) return this.#labelsOf(number);
    await this.#ensureLabels(labels);
    return labelNames(await this.#api('POST', `/issues/${number}/labels`, { labels }));
  }

  async removeLabels(number: number, labels: readonly string[]): Promise<readonly string[]> {
    for (const label of labels) {
      const { args, result } = await this.#apiRaw('DELETE', `/issues/${number}/labels/${encodeURIComponent(label)}`);
      // 404: the label is not on the issue (or the issue is missing, which the read below reports).
      if (result.exitCode !== 0 && !/HTTP 404/.test(result.stderr)) throw ghError(args, result);
    }
    return this.#labelsOf(number);
  }

  async upsertComment(
    number: number,
    marker: string,
    body: string,
  ): Promise<{ comment: IssueComment; created: boolean }> {
    const tag = markerComment(marker);
    const text = withMarker(marker, body);
    const me = await this.viewer();
    const existing = (await this.listComments(number)).find((c) => c.author === me && c.body.includes(tag));
    if (existing) {
      return {
        comment: toComment(await this.#api('PATCH', `/issues/comments/${existing.id}`, { body: text })),
        created: false,
      };
    }
    return { comment: toComment(await this.#api('POST', `/issues/${number}/comments`, { body: text })), created: true };
  }

  async listComments(number: number): Promise<readonly IssueComment[]> {
    return (await this.#apiList(`/issues/${number}/comments`)).map(toComment);
  }

  async listIssueEvents(number: number): Promise<readonly IssueEvent[]> {
    const items = (await this.#apiList(`/issues/${number}/timeline`)).map((item) => asObject(item, 'event'));
    const events: IssueEvent[] = [];
    // One at a time: each `committed` event costs a gh process.
    for (const item of items) if (ISSUE_EVENTS.has(String(item['event']))) events.push(await this.#toEvent(item));
    // Stable: events at the same second keep the timeline's order.
    return events.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async #toEvent(item: JsonObject): Promise<IssueEvent> {
    const event = str(item, 'event') as IssueEventType;
    if (event === 'committed') {
      // Timeline commits carry the git author's name, not a login: read the commit for that.
      const sha = str(item, 'sha');
      const commit = await this.getCommit(sha);
      return { id: commitEventId(sha), event, actor: commit.author, createdAt: commit.createdAt, sha };
    }
    const label = optObj(item, 'label');
    const sha = optStr(item, 'commit_id');
    return {
      id: num(item, 'id'),
      event,
      actor: login(item, 'actor'),
      createdAt: str(item, 'created_at'),
      ...(label ? { label: str(label, 'name') } : {}),
      ...(event === 'merged' && sha !== undefined ? { sha } : {}),
    };
  }

  async enableAutoMerge(
    number: number,
    options: { readonly method?: 'squash' | 'merge' | 'rebase' } = {},
  ): Promise<void> {
    const repo = await this.repo();
    await this.#gh(['pr', 'merge', String(number), '-R', repo, '--auto', `--${options.method ?? 'squash'}`]);
  }

  async mergePr(
    number: number,
    options: { readonly matchHeadSha: string; readonly method?: 'squash' | 'merge' | 'rebase' },
  ): Promise<{ sha: string }> {
    const repo = await this.repo();
    const pr = await this.getPr(number);
    if (pr.state !== 'open') throw new ProviderError('conflict', `#${number} is ${pr.state}`);
    if (pr.draft) throw new ProviderError('conflict', `#${number} is a draft`);
    if (pr.headSha !== options.matchHeadSha) {
      throw new ProviderError('conflict', `#${number} head is ${pr.headSha}, not ${options.matchHeadSha}`);
    }
    const args = ['pr', 'merge', String(number), '-R', repo, `--${options.method ?? 'squash'}`];
    args.push('--match-head-commit', options.matchHeadSha);
    const result = await this.#run(args);
    if (result.exitCode !== 0) {
      const refused = /head branch was modified|not mergeable|HTTP 40[59]/i.test(result.stderr);
      throw ghError(args, result, refused ? 'conflict' : undefined);
    }
    const merged = await this.getPr(number);
    if (merged.mergeCommitSha === null) {
      throw new ProviderError('malformed-output', `gh merged #${number} but it has no merge commit`);
    }
    return { sha: merged.mergeCommitSha };
  }

  /**
   * Required check names for `sha`: the client's `requiredChecks`, else the union of the
   * base branch's ruleset checks and branch-protection contexts. The base is that of the open
   * PR at `sha`, or the default branch.
   */
  async #requiredCheckNames(sha: string): Promise<string[]> {
    if (this.#requiredChecksOption !== undefined) return [...this.#requiredChecksOption];
    const pr = (await this.#listPrs('open', [])).find((p) => p.headSha === sha);
    const base = refPath(pr?.base ?? (await this.#defaultBranchName()));
    const names = new Set<string>();
    for (const rule of (await this.#apiList(`/rules/branches/${base}`)).map((value) => asObject(value, 'rule'))) {
      if (rule['type'] !== 'required_status_checks') continue;
      for (const check of arr(obj(rule, 'parameters'), 'required_status_checks')) {
        names.add(str(asObject(check, 'check'), 'context'));
      }
    }
    const protection = optObj(asObject(await this.#api('GET', `/branches/${base}`), 'branch'), 'protection');
    const contexts = protection === undefined ? undefined : optObj(protection, 'required_status_checks');
    for (const context of contexts === undefined ? [] : arr(contexts, 'contexts')) {
      names.add(str({ context }, 'context'));
    }
    return [...names];
  }

  /** The newest check run (or else commit status) per name on exactly `sha`; missing ones are queued. */
  async #checksOn(sha: string, names: readonly string[]): Promise<CheckRun[]> {
    const path = `/commits/${encodeURIComponent(sha)}`;
    const pages = asArray(await this.#api('GET', `${path}/check-runs`, undefined, ['--paginate', '--slurp']), 'pages');
    const runs = pages
      .flatMap((page) => arr(asObject(page, 'check runs page'), 'check_runs'))
      .map((value) => asObject(value, 'check run'))
      .sort((a, b) => num(b, 'id') - num(a, 'id'));
    const statuses = arr(asObject(await this.#api('GET', `${path}/status`), 'status'), 'statuses').map((value) =>
      asObject(value, 'status'),
    );
    return names.map((name): CheckRun => {
      const run = runs.find((r) => str(r, 'name') === name);
      if (run) {
        const status = statusOf(str(run, 'status'));
        return { name, headSha: sha, status, conclusion: conclusionOf(optStr(run, 'conclusion')) };
      }
      const state = statuses.find((s) => str(s, 'context') === name)?.['state'];
      if (state === undefined) return { name, headSha: sha, status: 'queued', conclusion: null };
      if (state === 'pending') return { name, headSha: sha, status: 'in_progress', conclusion: null };
      return { name, headSha: sha, status: 'completed', conclusion: state === 'success' ? 'success' : 'failure' };
    });
  }

  /**
   * Polls the check runs and commit statuses on exactly `sha` until every required check has
   * completed. A required check that has not reported yet (for example a workflow that was just
   * dispatched) counts as pending until the timeout.
   */
  async waitForRequiredChecks(input: WaitForChecksInput): Promise<RequiredChecksResult> {
    const deadline = this.#now() + (input.timeoutMs ?? this.#checksTimeoutMs);
    const exclude = new Set(input.exclude ?? []);
    const names = (await this.#requiredCheckNames(input.sha)).filter((name) => !exclude.has(name));
    for (;;) {
      const checks = names.length === 0 ? [] : await this.#checksOn(input.sha, names);
      const pending = checks.filter((check) => check.status !== 'completed').map((check) => check.name);
      if (pending.length === 0) {
        return { sha: input.sha, ok: checks.every((check) => PASSING.has(check.conclusion)), checks };
      }
      const left = deadline - this.#now();
      if (left <= 0) {
        throw new ProviderError('timeout', `required checks on ${input.sha} did not finish: ${pending.join(', ')}`);
      }
      await this.#sleep(Math.min(this.#pollIntervalMs, left));
    }
  }

  async dispatchWorkflow(file: string, ref: string, inputs: Readonly<Record<string, string>> = {}): Promise<void> {
    const repo = await this.repo();
    const args = ['workflow', 'run', '-R', repo, '--ref', ref];
    for (const [key, value] of Object.entries(inputs)) args.push('-f', `${key}=${value}`);
    args.push('--', file);
    const result = await this.#run(args);
    if (result.exitCode !== 0) {
      throw ghError(args, result, /no ref found/i.test(result.stderr) ? 'not-found' : undefined);
    }
  }

  async #getIssue(number: number): Promise<Issue> {
    const repo = await this.repo();
    return toIssue(await this.#ghJson(['issue', 'view', String(number), '-R', repo, '--json', ISSUE_FIELDS]));
  }

  async upsertIssue(marker: string, input: UpsertIssueInput): Promise<{ issue: Issue; created: boolean }> {
    const repo = await this.repo();
    const tag = markerComment(marker);
    const body = withMarker(marker, input.body);
    // Only issues this viewer opened, so nobody else's issue that quotes the marker is adopted.
    const me = await this.viewer();
    const matches = (await this.#apiList(`/issues?state=all&creator=${encodeURIComponent(me)}&per_page=100`))
      .map((value) => asObject(value, 'issue'))
      .filter((issue) => issue['pull_request'] === undefined && login(issue, 'user') === me)
      .filter((issue) => (optStr(issue, 'body') ?? '').includes(tag))
      .map((issue) => ({ number: num(issue, 'number'), state: str(issue, 'state') === 'closed' ? 'closed' : 'open' }))
      .sort((a, b) => b.number - a.number);
    // Prefer the open one; otherwise reuse the newest closed one.
    const existing = matches.find((issue) => issue.state === 'open') ?? matches[0];
    let number: number;
    if (existing) {
      number = existing.number;
      await this.#gh(['issue', 'edit', String(number), '-R', repo, '--title', input.title, '--body-file', '-'], body);
    } else {
      const created = await this.#gh(['issue', 'create', '-R', repo, '--title', input.title, '--body-file', '-'], body);
      number = numberFromUrl(created, 'issues');
    }
    const state = input.state ?? 'open';
    if (state !== (existing?.state ?? 'open')) {
      await this.#gh(['issue', state === 'closed' ? 'close' : 'reopen', String(number), '-R', repo]);
    }
    if (input.labels !== undefined && input.labels.length > 0) await this.addLabels(number, input.labels);
    return { issue: await this.#getIssue(number), created: existing === undefined };
  }

  async getWorkflowRun(id: number): Promise<WorkflowRun> {
    return toWorkflowRun(await this.#api('GET', `/actions/runs/${id}`));
  }
}
