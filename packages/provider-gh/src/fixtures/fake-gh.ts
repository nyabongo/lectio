/**
 * A stand-in for the `gh` CLI in unit tests: an `Exec` that records every command and
 * answers it with the JSON (or text) real gh prints, from an in-memory repository.
 * It understands exactly the commands `GhGitHubClient` issues; anything else fails
 * loudly so a new command cannot slip past the tests unanswered.
 *
 * Output shapes follow gh 2.x: `gh pr/issue ... --json` (GraphQL field names, upper-case
 * states), `gh api` (REST field names; errors as `gh: <message> (HTTP <status>)` on stderr
 * with the error body on stdout), and the URLs `gh pr create` / `gh issue create` print.
 */
import { createHash } from 'node:crypto';

import type { ExecOptions, ExecResult } from '../exec.ts';

type Tree = ReadonlyMap<string, string>;

interface CommitRecord {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly author: string;
  readonly verified: boolean;
  readonly date: string;
  readonly seq: number;
  readonly tree: Tree;
}

interface ThreadRecord {
  readonly number: number;
  readonly kind: 'pr' | 'issue';
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  readonly labels: string[];
  readonly author: string;
  readonly createdAt: string;
  readonly head: string;
  readonly headOwner: string;
  base: string;
  forkSha: string;
  draft: boolean;
  autoMerge: boolean;
  mergeCommitSha: string | null;
  mergedHeadSha: string | null;
}

interface TimelineRecord {
  readonly number: number;
  readonly seq: number;
  readonly item: Record<string, unknown>;
}

interface CommentRecord {
  readonly id: number;
  readonly number: number;
  readonly author: string;
  body: string;
  readonly createdAt: string;
  updatedAt: string;
}

export interface FakeRun {
  readonly id: number;
  readonly path: string;
  readonly event: string;
  readonly head_sha: string;
  readonly head_branch: string;
  readonly pull_requests: readonly { readonly number: number }[];
  readonly status: string;
  readonly conclusion: string | null;
  readonly actor: { readonly login: string } | null;
}

export interface FakeGhOptions {
  /** Default `nyabongo/lectio`. */
  readonly repo?: string;
  /** Default `main`. */
  readonly defaultBranch?: string;
  /** Login gh is authenticated as. Default `lectio-bot`. */
  readonly viewer?: string;
  /** Workflow files that accept `workflow_dispatch`. */
  readonly workflows?: readonly string[];
  /** Check names `gh pr checks --required` reports (state from `setCheck`, else `PENDING`). */
  readonly requiredChecks?: readonly string[];
}

export interface RecordedCommand {
  readonly args: readonly string[];
  readonly input: string | undefined;
}

const BOOLEAN_FLAGS = new Set([
  '--paginate',
  '--slurp',
  '--draft',
  '--undo',
  '--auto',
  '--squash',
  '--merge',
  '--rebase',
  '--required',
]);

class Parsed {
  readonly positional: string[] = [];
  readonly flags = new Map<string, string[]>();

  constructor(args: readonly string[]) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string;
      if (!arg.startsWith('-')) this.positional.push(arg);
      else if (BOOLEAN_FLAGS.has(arg)) this.flags.set(arg, ['true']);
      else this.flags.set(arg, [...(this.flags.get(arg) ?? []), args[++i] as string]);
    }
  }

  get(flag: string): string | undefined {
    return this.flags.get(flag)?.[0];
  }

  all(flag: string): string[] {
    return this.flags.get(flag) ?? [];
  }

  has(flag: string): boolean {
    return this.flags.has(flag);
  }
}

class GhFailure extends Error {
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number;

  constructor(stderr: string, stdout = '', exitCode = 1) {
    super(stderr);
    this.stderr = stderr;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
}

function httpError(status: number, message: string): GhFailure {
  return new GhFailure(`gh: ${message} (HTTP ${status})\n`, JSON.stringify({ message, status: String(status) }));
}

function shaOf(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function diff(base: Tree, head: Tree): Record<string, unknown>[] {
  const changes = new Map<string, Record<string, unknown>>();
  const added: string[] = [];
  const removed: string[] = [];
  for (const [path, content] of head) {
    const before = base.get(path);
    if (before === undefined) added.push(path);
    else if (before !== content) changes.set(path, { filename: path, status: 'modified' });
  }
  for (const path of base.keys()) if (!head.has(path)) removed.push(path);
  removed.sort();
  for (const path of added.sort()) {
    const index = removed.findIndex((old) => base.get(old) === head.get(path));
    const previous = index === -1 ? undefined : removed.splice(index, 1)[0];
    changes.set(
      path,
      previous === undefined
        ? { filename: path, status: 'added' }
        : { filename: path, status: 'renamed', previous_filename: previous },
    );
  }
  for (const path of removed) changes.set(path, { filename: path, status: 'removed' });
  // GitHub does not sort the files endpoint by path; reverse so the client must.
  return [...changes.values()].reverse();
}

function pick(record: Record<string, unknown>, fields: string | undefined): Record<string, unknown> {
  if (fields === undefined) return record;
  return Object.fromEntries(fields.split(',').map((field) => [field, record[field]]));
}

export class FakeGh {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly viewer: string;
  readonly calls: RecordedCommand[] = [];
  readonly dispatches: { file: string; ref: string; inputs: Record<string, string> }[] = [];
  readonly #workflows: ReadonlySet<string>;
  readonly #requiredChecks: readonly string[];
  readonly #checks = new Map<string, string>();
  readonly #commits = new Map<string, CommitRecord>();
  readonly #trees = new Map<string, Tree>();
  readonly #branches = new Map<string, string>();
  readonly #threads = new Map<number, ThreadRecord>();
  readonly #timeline: TimelineRecord[] = [];
  readonly #comments: CommentRecord[] = [];
  readonly #labels = new Set<string>();
  readonly #runs = new Map<number, FakeRun>();
  #seq = 0;
  #nextNumber = 1;
  #nextRunId = 5000;

  constructor(options: FakeGhOptions = {}) {
    this.repo = options.repo ?? 'nyabongo/lectio';
    this.defaultBranch = options.defaultBranch ?? 'main';
    this.viewer = options.viewer ?? 'lectio-bot';
    this.#workflows = new Set(options.workflows ?? []);
    this.#requiredChecks = options.requiredChecks ?? [];
    const root = this.#commit([], new Map([['README.md', '# Lectio\n']]), 'Initial commit', 'lectio-owner', true);
    this.#branches.set(this.defaultBranch, root.sha);
  }

  /** The `Exec` to inject into `GhGitHubClient`. */
  readonly exec = async (args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> => {
    this.calls.push({ args: [...args], input: options.input });
    try {
      const stdout = this.#dispatch(args, new Parsed(args), options.input ?? '');
      return { exitCode: 0, stdout, stderr: '' };
    } catch (error) {
      if (error instanceof GhFailure) return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
      throw error;
    }
  };

  // -- test helpers ---------------------------------------------------------

  /** Sets the state `gh pr checks` reports for a check on a sha (`SUCCESS`, `FAILURE`, `IN_PROGRESS`, ...). */
  setCheck(sha: string, name: string, state: string): void {
    this.#checks.set(`${sha}:${name}`, state);
  }

  addRun(run: Omit<FakeRun, 'id'> & { readonly id?: number }): FakeRun {
    const stored = { ...run, id: run.id ?? this.#nextRunId++ };
    this.#runs.set(stored.id, stored);
    return stored;
  }

  /** A comment by someone else (for example a reviewer's `/approve`). */
  postComment(number: number, author: string, body: string): void {
    const at = this.#stamp().at;
    this.#comments.push({ id: this.#seq, number, author, body, createdAt: at, updatedAt: at });
  }

  /** A PR from a fork whose head branch has the same name as a branch here. */
  addForkPr(head: string, owner: string): number {
    const sha = this.#branch(head);
    return this.#newThread('pr', `Fork ${head}`, '', 'OPEN', owner, { head, headOwner: owner, forkSha: sha });
  }

  /** A plain (unsigned) human push of one file to `branch`; returns the new head sha. */
  pushUnsigned(branch: string, path: string, content: string, author: string): string {
    const head = this.#branch(branch);
    const tree = new Map(this.#getCommit(head).tree).set(path, content);
    const commit = this.#commit([head], tree, `Edit ${path}`, author, false);
    this.#branches.set(branch, commit.sha);
    return commit.sha;
  }

  // -- the model ------------------------------------------------------------

  #stamp(): { seq: number; at: string } {
    this.#seq += 1;
    return { seq: this.#seq, at: new Date(Date.UTC(2026, 0, 1) + this.#seq * 1000).toISOString().replace('.000', '') };
  }

  #commit(parents: string[], tree: Tree, message: string, author: string, verified: boolean): CommitRecord {
    const { seq, at } = this.#stamp();
    const sha = shaOf({ parents, tree: [...tree], message, author, seq });
    const record = { sha, parents, message, author, verified, date: at, seq, tree };
    this.#commits.set(sha, record);
    return record;
  }

  #getCommit(ref: string): CommitRecord {
    const commit = this.#commits.get(this.#branches.get(ref) ?? ref);
    if (commit) return commit;
    throw /^[0-9a-f]{40}$/.test(ref) ? httpError(422, `No commit found for SHA: ${ref}`) : httpError(404, 'Not Found');
  }

  #branch(name: string): string {
    const sha = this.#branches.get(name);
    if (sha === undefined) throw httpError(404, 'Not Found');
    return sha;
  }

  #thread(number: number, kind?: 'pr' | 'issue'): ThreadRecord {
    const thread = this.#threads.get(number);
    if (!thread || (kind !== undefined && thread.kind !== kind)) {
      throw kind === 'pr'
        ? new GhFailure(
            `GraphQL: Could not resolve to a PullRequest with the number of ${number}. (repository.pullRequest)\n`,
          )
        : kind === 'issue'
          ? new GhFailure(`GraphQL: Could not resolve to an issue or pull request with the number of ${number}.\n`)
          : httpError(404, 'Not Found');
    }
    return thread;
  }

  #event(number: number, event: string, extra: Record<string, unknown> = {}): void {
    const { seq, at } = this.#stamp();
    this.#timeline.push({
      number,
      seq,
      item: { id: seq, event, actor: { login: this.viewer }, created_at: at, ...extra },
    });
  }

  #mergeBase(head: string, base: string): string {
    const ancestors = new Set<string>();
    for (const pending = [base]; pending.length > 0;) {
      const sha = pending.pop() as string;
      if (ancestors.has(sha)) continue;
      ancestors.add(sha);
      pending.push(...this.#getCommit(sha).parents);
    }
    let commit = this.#getCommit(head);
    while (!ancestors.has(commit.sha)) commit = this.#getCommit(commit.parents[0] as string);
    return commit.sha;
  }

  #headOf(thread: ThreadRecord): string {
    return thread.mergedHeadSha ?? this.#branch(thread.head);
  }

  #newThread(
    kind: 'pr' | 'issue',
    title: string,
    body: string,
    state: ThreadRecord['state'],
    author: string,
    pr: { head: string; headOwner: string; forkSha: string; base?: string; draft?: boolean } = {
      head: '',
      headOwner: '',
      forkSha: '',
    },
  ): number {
    const number = this.#nextNumber++;
    this.#threads.set(number, {
      number,
      kind,
      title,
      body,
      state,
      labels: [],
      author,
      createdAt: this.#stamp().at,
      head: pr.head,
      headOwner: pr.headOwner,
      base: pr.base ?? this.defaultBranch,
      forkSha: pr.forkSha,
      draft: pr.draft ?? false,
      autoMerge: false,
      mergeCommitSha: null,
      mergedHeadSha: null,
    });
    return number;
  }

  #labelJson(name: string): Record<string, unknown> {
    return { id: `LA_${name}`, name, description: '', color: 'ededed' };
  }

  #prJson(thread: ThreadRecord): Record<string, unknown> {
    const [owner = '', name = ''] = this.repo.split('/');
    return {
      number: thread.number,
      url: `https://github.com/${this.repo}/pull/${thread.number}`,
      title: thread.title,
      body: thread.body,
      headRefName: thread.head,
      headRepository: { id: 'R_head', name },
      headRepositoryOwner: { id: 'U_head', login: thread.headOwner },
      isCrossRepository: thread.headOwner !== owner,
      baseRefName: thread.base,
      headRefOid: this.#headOf(thread),
      state: thread.state,
      isDraft: thread.draft,
      labels: thread.labels.map((label) => this.#labelJson(label)),
      author: { login: thread.author, is_bot: false },
      autoMergeRequest: thread.autoMerge ? { mergeMethod: 'SQUASH', enabledBy: { login: this.viewer } } : null,
      mergeCommit: thread.mergeCommitSha === null ? null : { oid: thread.mergeCommitSha },
      createdAt: thread.createdAt,
    };
  }

  #issueJson(thread: ThreadRecord): Record<string, unknown> {
    return {
      number: thread.number,
      url: `https://github.com/${this.repo}/issues/${thread.number}`,
      title: thread.title,
      body: thread.body,
      state: thread.state,
      labels: thread.labels.map((label) => this.#labelJson(label)),
      author: { login: thread.author, is_bot: false },
    };
  }

  #commentJson(comment: CommentRecord): Record<string, unknown> {
    return {
      id: comment.id,
      user: { login: comment.author },
      body: comment.body,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
    };
  }

  #commitJson(commit: CommitRecord): Record<string, unknown> {
    const signature = { name: commit.author, email: `${commit.author}@users.noreply.github.com`, date: commit.date };
    return {
      sha: commit.sha,
      parents: commit.parents.map((sha) => ({ sha })),
      commit: {
        message: commit.message,
        author: signature,
        committer: signature,
        tree: { sha: shaOf([...commit.tree]) },
        verification: { verified: commit.verified, reason: commit.verified ? 'valid' : 'unsigned' },
      },
      author: { login: commit.author },
    };
  }

  // -- commands -------------------------------------------------------------

  #dispatch(args: readonly string[], parsed: Parsed, input: string): string {
    const [group, command] = parsed.positional;
    if (group === 'api') return JSON.stringify(this.#api(parsed, input));
    const repo = parsed.get('-R');
    if (repo !== this.repo) throw new Error(`fake gh: expected -R ${this.repo} in ${args.join(' ')}`);
    const json = (value: unknown) => JSON.stringify(value);
    const fields = parsed.get('--json');
    const number = Number(parsed.positional[2]);
    switch (`${group} ${command}`) {
      case 'pr view':
        return json(pick(this.#prJson(this.#thread(number, 'pr')), fields));
      case 'pr list':
        return json(this.#prList(parsed).map((thread) => pick(this.#prJson(thread), fields)));
      case 'pr create':
        return this.#prCreate(parsed, input);
      case 'pr edit':
        return this.#prEdit(number, parsed, input);
      case 'pr ready':
        this.#thread(number, 'pr').draft = parsed.has('--undo');
        return '';
      case 'pr merge':
        return this.#prMerge(number, parsed);
      case 'pr checks':
        return this.#prChecks(number);
      case 'label list':
        return json([...this.#labels].map((label) => pick(this.#labelJson(label), fields)));
      case 'label create':
        return this.#labelCreate(parsed.positional[2] as string);
      case 'workflow run':
        return this.#workflowRun(parsed);
      case 'issue list':
        return json(
          [...this.#threads.values()]
            .filter((thread) => thread.kind === 'issue')
            .reverse()
            .map((thread) => pick(this.#issueJson(thread), fields)),
        );
      case 'issue view':
        return json(pick(this.#issueJson(this.#thread(number, 'issue')), fields));
      case 'issue create': {
        const created = this.#newThread('issue', parsed.get('--title') as string, input, 'OPEN', this.viewer);
        return `https://github.com/${this.repo}/issues/${created}\n`;
      }
      case 'issue edit': {
        const thread = this.#thread(number, 'issue');
        thread.title = parsed.get('--title') as string;
        thread.body = input;
        return `https://github.com/${this.repo}/issues/${number}\n`;
      }
      case 'issue close':
      case 'issue reopen': {
        const thread = this.#thread(number, 'issue');
        thread.state = command === 'close' ? 'CLOSED' : 'OPEN';
        this.#event(number, command === 'close' ? 'closed' : 'reopened');
        return '';
      }
      default:
        throw new Error(`fake gh: unsupported command: gh ${args.join(' ')}`);
    }
  }

  #prList(parsed: Parsed): ThreadRecord[] {
    const state = parsed.get('--state');
    const wanted = state === 'all' ? null : state === 'closed' ? ['CLOSED', 'MERGED'] : [state?.toUpperCase()];
    const head = parsed.get('--head');
    const label = parsed.get('--label');
    return [...this.#threads.values()]
      .filter((t) => t.kind === 'pr')
      .filter((t) => wanted === null || wanted.includes(t.state))
      .filter((t) => head === undefined || t.head === head)
      .filter((t) => label === undefined || t.labels.includes(label))
      .reverse();
  }

  #prCreate(parsed: Parsed, body: string): string {
    const head = parsed.get('--head') as string;
    const base = parsed.get('--base') as string;
    const [owner = ''] = this.repo.split('/');
    const headSha = this.#branches.get(head);
    if (headSha === undefined) throw new GhFailure(`pull request create failed: GraphQL: Head sha can't be blank\n`);
    const open = [...this.#threads.values()].find(
      (t) => t.kind === 'pr' && t.state === 'OPEN' && t.head === head && t.headOwner === owner,
    );
    if (open) throw new GhFailure(`a pull request for branch "${head}" into branch "${base}" already exists:\n`);
    const forkSha = this.#mergeBase(headSha, this.#branch(base));
    const draft = parsed.has('--draft');
    const number = this.#newThread('pr', parsed.get('--title') as string, body, 'OPEN', this.viewer, {
      head,
      headOwner: owner,
      forkSha,
      base,
      draft,
    });
    return `https://github.com/${this.repo}/pull/${number}\n`;
  }

  #prEdit(number: number, parsed: Parsed, body: string): string {
    const thread = this.#thread(number, 'pr');
    thread.title = parsed.get('--title') as string;
    thread.body = body;
    const base = parsed.get('--base');
    if (base !== undefined) {
      thread.base = base;
      thread.forkSha = this.#mergeBase(this.#headOf(thread), this.#branch(base));
    }
    return `https://github.com/${this.repo}/pull/${number}\n`;
  }

  #prMerge(number: number, parsed: Parsed): string {
    const thread = this.#thread(number, 'pr');
    if (thread.state !== 'OPEN') throw new GhFailure(`X Pull request #${number} is ${thread.state.toLowerCase()}\n`);
    if (parsed.has('--auto')) {
      if (!thread.autoMerge) this.#event(number, 'auto_merge_enabled');
      thread.autoMerge = true;
      return '';
    }
    if (thread.draft) throw new GhFailure(`X Pull request #${number} is still a draft\n`);
    const headSha = this.#branch(thread.head);
    if (parsed.get('--match-head-commit') !== headSha) {
      throw new GhFailure('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)\n');
    }
    const baseSha = this.#branch(thread.base);
    const tree = new Map(this.#getCommit(baseSha).tree);
    const headTree = this.#getCommit(headSha).tree;
    for (const file of diff(this.#getCommit(thread.forkSha).tree, headTree)) {
      const path = file['filename'] as string;
      if (typeof file['previous_filename'] === 'string') tree.delete(file['previous_filename']);
      if (file['status'] === 'removed') tree.delete(path);
      else tree.set(path, headTree.get(path) as string);
    }
    const parents = parsed.has('--merge') ? [baseSha, headSha] : [baseSha];
    const commit = this.#commit(parents, tree, `${thread.title} (#${number})`, this.viewer, true);
    this.#branches.set(thread.base, commit.sha);
    thread.state = 'MERGED';
    thread.mergeCommitSha = commit.sha;
    thread.mergedHeadSha = headSha;
    this.#event(number, 'merged', { commit_id: commit.sha });
    return '';
  }

  #prChecks(number: number): string {
    const thread = this.#thread(number, 'pr');
    if (this.#requiredChecks.length === 0) {
      throw new GhFailure(`no required checks reported on the '${thread.head}' branch\n`);
    }
    const sha = this.#headOf(thread);
    const checks = this.#requiredChecks.map((name) => ({
      name,
      state: this.#checks.get(`${sha}:${name}`) ?? 'PENDING',
    }));
    const stdout = JSON.stringify(checks);
    if (checks.some((check) => ['PENDING', 'QUEUED', 'IN_PROGRESS'].includes(check.state))) {
      // gh exits 8 while checks are pending, still printing the JSON.
      throw new GhFailure('', stdout, 8);
    }
    return stdout;
  }

  #labelCreate(name: string): string {
    if (this.#labels.has(name))
      throw new GhFailure(
        `label with name "${name}" already exists; use \`--force\` to update its color and description\n`,
      );
    this.#labels.add(name);
    return `✓ Label "${name}" created in ${this.repo}\n`;
  }

  #workflowRun(parsed: Parsed): string {
    const file = parsed.positional[2] as string;
    const ref = parsed.get('--ref') as string;
    if (!this.#workflows.has(file)) throw new GhFailure(`could not find any workflows named ${file}\n`);
    const sha = this.#branches.get(ref);
    if (sha === undefined)
      throw new GhFailure(`could not create workflow dispatch event: HTTP 422: No ref found for: ${ref}\n`);
    const inputs = Object.fromEntries(
      parsed.all('-f').map((pair) => pair.split(/=(.*)/s).slice(0, 2) as [string, string]),
    );
    this.dispatches.push({ file, ref, inputs });
    this.addRun({
      path: `.github/workflows/${file}`,
      event: 'workflow_dispatch',
      head_sha: sha,
      head_branch: ref,
      pull_requests: [],
      status: 'queued',
      conclusion: null,
      actor: { login: this.viewer },
    });
    return `✓ Created workflow_dispatch event for ${file} at ${ref}\n`;
  }

  // -- gh api ---------------------------------------------------------------

  #api(parsed: Parsed, input: string): unknown {
    const method = parsed.get('-X') ?? 'GET';
    const path = parsed.positional[1] as string;
    const body = (input === '' ? {} : JSON.parse(input)) as Record<string, unknown>;
    if (path === 'user') return { login: this.viewer, id: 1, type: 'Bot' };
    const prefix = `repos/${this.repo}`;
    if (!path.startsWith(prefix)) throw new Error(`fake gh: unexpected api path ${path}`);
    const route = `${method} ${path.slice(prefix.length)}`;
    const paged = (items: unknown[]) => (parsed.has('--slurp') ? [items] : items);
    let match: RegExpExecArray | null;

    if (route === 'GET ') return { full_name: this.repo, default_branch: this.defaultBranch };
    if ((match = /^GET \/commits\/(.+)$/.exec(route))) {
      return this.#commitJson(this.#getCommit(decodeURIComponent(match[1] as string)));
    }
    if (route === 'POST /git/refs') {
      const name = (body['ref'] as string).replace(/^refs\/heads\//, '');
      if (this.#branches.has(name)) throw httpError(422, 'Reference already exists');
      this.#getCommit(body['sha'] as string);
      this.#branches.set(name, body['sha'] as string);
      return { ref: body['ref'], object: { sha: body['sha'], type: 'commit' } };
    }
    if ((match = /^GET \/git\/ref\/heads\/(.+)$/.exec(route))) {
      const name = decodeURIComponent(match[1] as string);
      return { ref: `refs/heads/${name}`, object: { sha: this.#branch(name), type: 'commit' } };
    }
    if (route === 'POST /git/trees') {
      const baseSha = body['base_tree'] as string;
      const base = [...this.#commits.values()].find((c) => shaOf([...c.tree]) === baseSha);
      if (!base) throw httpError(422, 'base_tree is not a valid tree');
      const tree = new Map(base.tree);
      for (const entry of body['tree'] as { path: string; content?: string; sha?: null }[]) {
        if (entry.sha === null) tree.delete(entry.path);
        else tree.set(entry.path, entry.content as string);
      }
      const sha = shaOf([...tree]);
      this.#trees.set(sha, tree);
      return { sha, truncated: false };
    }
    if (route === 'POST /git/commits') {
      const tree = this.#trees.get(body['tree'] as string);
      if (!tree) throw httpError(422, 'Tree SHA does not exist');
      const commit = this.#commit(body['parents'] as string[], tree, body['message'] as string, this.viewer, true);
      return { sha: commit.sha, verification: { verified: true } };
    }
    if ((match = /^PATCH \/git\/refs\/heads\/(.+)$/.exec(route))) {
      const name = decodeURIComponent(match[1] as string);
      const current = this.#branch(name);
      const next = this.#getCommit(body['sha'] as string);
      if (!next.parents.includes(current) && body['force'] !== true)
        throw httpError(422, 'Update is not a fast forward');
      this.#branches.set(name, next.sha);
      return { ref: `refs/heads/${name}`, object: { sha: next.sha } };
    }
    if ((match = /^GET \/pulls\/(\d+)\/files$/.exec(route))) {
      const thread = this.#threads.get(Number(match[1]));
      if (thread?.kind !== 'pr') throw httpError(404, 'Not Found');
      return paged(diff(this.#getCommit(thread.forkSha).tree, this.#getCommit(this.#headOf(thread)).tree));
    }
    if ((match = /^(GET|POST) \/issues\/(\d+)\/labels$/.exec(route))) {
      const number = Number(match[2]);
      const thread = this.#thread(number);
      if (match[1] === 'POST') {
        for (const label of body['labels'] as string[]) {
          this.#labels.add(label);
          if (thread.labels.includes(label)) continue;
          thread.labels.push(label);
          this.#event(number, 'labeled', { label: { name: label, color: 'ededed' } });
        }
      }
      return thread.labels.map((label) => this.#labelJson(label));
    }
    if ((match = /^DELETE \/issues\/(\d+)\/labels\/(.+)$/.exec(route))) {
      const number = Number(match[1]);
      const thread = this.#thread(number);
      const label = decodeURIComponent(match[2] as string);
      const index = thread.labels.indexOf(label);
      if (index === -1) throw httpError(404, 'Label does not exist');
      thread.labels.splice(index, 1);
      this.#event(number, 'unlabeled', { label: { name: label, color: 'ededed' } });
      return thread.labels.map((name) => this.#labelJson(name));
    }
    if ((match = /^(GET|POST) \/issues\/(\d+)\/comments$/.exec(route))) {
      const number = Number(match[2]);
      this.#thread(number);
      if (match[1] === 'POST') {
        const at = this.#stamp().at;
        const comment = {
          id: this.#seq,
          number,
          author: this.viewer,
          body: body['body'] as string,
          createdAt: at,
          updatedAt: at,
        };
        this.#comments.push(comment);
        return this.#commentJson(comment);
      }
      return paged(this.#comments.filter((c) => c.number === number).map((c) => this.#commentJson(c)));
    }
    if ((match = /^PATCH \/issues\/comments\/(\d+)$/.exec(route))) {
      const comment = this.#comments.find((c) => c.id === Number(match?.[1]));
      if (!comment) throw httpError(404, 'Not Found');
      if (comment.author !== this.viewer) throw httpError(403, 'Resource not accessible by integration');
      comment.body = body['body'] as string;
      comment.updatedAt = this.#stamp().at;
      return this.#commentJson(comment);
    }
    if ((match = /^GET \/issues\/(\d+)\/timeline$/.exec(route))) {
      return paged(this.#timelineOf(this.#thread(Number(match[1]))));
    }
    if ((match = /^GET \/actions\/runs\/(\d+)$/.exec(route))) {
      const run = this.#runs.get(Number(match[1]));
      if (!run) throw httpError(404, 'Not Found');
      return run;
    }
    throw new Error(`fake gh: unsupported api route ${route}`);
  }

  #timelineOf(thread: ThreadRecord): unknown[] {
    const entries = this.#timeline.filter((e) => e.number === thread.number).map((e) => ({ seq: e.seq, item: e.item }));
    if (thread.kind === 'pr') {
      for (let commit = this.#getCommit(this.#headOf(thread)); commit.sha !== thread.forkSha;) {
        const signature = { name: commit.author, email: `${commit.author}@example.com`, date: commit.date };
        // Like GitHub: no `id`, `actor` or `created_at` on committed events.
        entries.push({
          seq: commit.seq,
          item: {
            event: 'committed',
            sha: commit.sha,
            author: signature,
            committer: signature,
            message: commit.message,
          },
        });
        commit = this.#getCommit(commit.parents[0] as string);
      }
      // Events the client ignores.
      entries.push({
        seq: 0,
        item: {
          id: 1,
          event: 'head_ref_force_pushed',
          actor: { login: this.viewer },
          created_at: '2026-01-01T00:00:00Z',
        },
      });
    }
    return entries.sort((a, b) => a.seq - b.seq).map((e) => e.item);
  }
}
