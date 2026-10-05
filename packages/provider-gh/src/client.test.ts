import { markerComment, ProviderError } from '@lectio/providers';
import { describeGitHubContract } from '@lectio/providers/contracts';
import { describe, expect, it } from 'vitest';

import { GhGitHubClient } from './client.ts';
import type { GhGitHubClientOptions } from './client.ts';
import type { Exec, ExecResult } from './exec.ts';
import type { FakeGhOptions } from './fixtures/fake-gh.ts';
import { FakeGh } from './fixtures/fake-gh.ts';
import { packageName } from './index.ts';

const REPO = 'nyabongo/lectio';

/** A fake clock: `sleep` advances `now`. */
function clock() {
  let ms = Date.UTC(2026, 9, 1);
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => ms,
    sleep: async (delay: number) => {
      sleeps.push(delay);
      ms += delay;
    },
  };
}

function setup(fakeOptions: FakeGhOptions = {}, options: Omit<GhGitHubClientOptions, 'exec'> = {}) {
  const fake = new FakeGh({ workflows: ['ci.yml'], ...fakeOptions });
  const time = clock();
  const client = new GhGitHubClient({ repo: REPO, exec: fake.exec, ...time, ...options });
  return { fake, client, time };
}

/** The fake gh, except that commands `override` answers fail or print what it returns. */
function overriding(fake: FakeGh, override: (args: readonly string[]) => Partial<ExecResult> | undefined): Exec {
  return async (args, options) => {
    const result = override(args);
    if (result === undefined) return fake.exec(args, options);
    return { exitCode: 1, stdout: '', stderr: '', ...result };
  };
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

let run = 0;
function contractSubject(fakeOptions: FakeGhOptions = {}) {
  const { fake, client } = setup(fakeOptions);
  const knownRun = fake.addRun({
    id: 42,
    path: '.github/workflows/content-gates.yml',
    event: 'pull_request',
    head_sha: 'a'.repeat(40),
    head_branch: 'research/mt-1',
    pull_requests: [{ number: 7 }],
    status: 'completed',
    conclusion: 'success',
    actor: { login: 'lectio-owner' },
  });
  return {
    client,
    defaultBranch: 'main',
    workflowFile: 'ci.yml',
    prefix: `contract-${++run}/`,
    knownRun: {
      id: knownRun.id,
      workflowFile: 'content-gates.yml',
      event: 'pull_request',
      headSha: knownRun.head_sha,
      headBranch: knownRun.head_branch,
    },
  };
}

describeGitHubContract(() => contractSubject(), { name: 'gh (fake exec, no required checks)' });
describeGitHubContract(() => contractSubject({ requiredChecks: ['lint', 'merge-rule'] }), {
  name: 'gh (fake exec, pending required checks)',
});

describe('GhGitHubClient', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/provider-gh');
  });

  it('names the repo on every gh command and sends bodies on stdin', async () => {
    const { fake, client } = setup();
    await client.createBranch({ name: 'research/a' });
    await client.commitFiles({ branch: 'research/a', message: 'Add', files: [{ path: 'a.md', content: 'a\n' }] });
    await client.openOrUpdatePr({ head: 'research/a', title: 'T', body: 'Body text', labels: ['research'] });
    for (const { args } of fake.calls) {
      if (args[0] === 'api') expect(args[3] === 'user' || args[3]?.startsWith(`repos/${REPO}`)).toBe(true);
      else expect(args).toContain('-R');
    }
    const create = fake.calls.find((call) => call.args[1] === 'create' && call.args[0] === 'pr');
    expect(create?.args).toEqual(
      expect.arrayContaining(['--head', 'research/a', '--base', 'main', '--title', 'T', '--body-file', '-']),
    );
    expect(create?.input).toBe('Body text');
    expect(fake.calls.some((call) => call.args.join(' ') === `label create research -R ${REPO}`)).toBe(true);
  });

  it('merges with --squash --match-head-commit and caches viewer, repo and labels', async () => {
    const { fake, client } = setup();
    await client.createBranch({ name: 'b' });
    const commit = await client.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'x', content: '1' }] });
    const { pr } = await client.openOrUpdatePr({ head: 'b', title: 't', body: '', draft: true, labels: ['x'] });
    expect(pr.draft).toBe(true);
    await client.openOrUpdatePr({ head: 'b', title: 't', body: '', draft: false, labels: ['x', 'y'] });
    await client.mergePr(pr.number, { matchHeadSha: commit.sha });
    expect(fake.calls.map((c) => c.args.join(' '))).toContain(
      `pr merge ${pr.number} -R ${REPO} --squash --match-head-commit ${commit.sha}`,
    );
    expect(fake.calls.filter((c) => c.args[0] === 'label' && c.args[1] === 'list')).toHaveLength(1);
    await client.viewer();
    await client.viewer();
    expect(fake.calls.filter((c) => c.args[1] === 'user')).toHaveLength(1);
  });

  it('reads the repository from the git origin when none is given', async () => {
    const fake = new FakeGh();
    let asked = 0;
    const client = new GhGitHubClient({
      exec: fake.exec,
      git: { originRepo: async () => (asked++, REPO) },
    });
    expect(await client.repo()).toBe(REPO);
    expect((await client.getCommit('main')).author).toBe('lectio-owner');
    expect(asked).toBe(1);
  });

  it('constructs with the real gh and git runners without running them', () => {
    expect(new GhGitHubClient()).toBeInstanceOf(GhGitHubClient);
  });

  it('creates branches from a branch or sha and maps unknown refs to not-found', async () => {
    const { client } = setup();
    const main = await client.getCommit('main');
    expect(await client.createBranch({ name: 'from-sha', from: main.sha })).toEqual({
      name: 'from-sha',
      sha: main.sha,
    });
    expect(await client.createBranch({ name: 'nested/from-branch', from: 'from-sha' })).toEqual({
      name: 'nested/from-branch',
      sha: main.sha,
    });
    expect((await rejection(client.createBranch({ name: 'x', from: 'f'.repeat(40) }))).code).toBe('not-found');
    expect((await rejection(client.createBranch({ name: 'x', from: 'nope' }))).code).toBe('not-found');
    expect((await rejection(client.getCommit('0'.repeat(40)))).code).toBe('not-found');
  });

  it('reports unsigned human commits and the commit author as the committed actor', async () => {
    const { fake, client } = setup();
    await client.createBranch({ name: 'b' });
    await client.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'x', content: '1' }] });
    const { pr } = await client.openOrUpdatePr({ head: 'b', title: 't', body: '' });
    const pushed = fake.pushUnsigned('b', 'y', '2', 'someone');
    expect(await client.getCommit(pushed)).toMatchObject({ verified: false, author: 'someone' });
    const committed = (await client.listIssueEvents(pr.number)).filter((e) => e.event === 'committed');
    expect(committed.map((e) => [e.actor, e.sha])).toEqual([
      ['lectio-bot', expect.any(String)],
      ['someone', pushed],
    ]);
    expect(committed.every((e) => Number.isSafeInteger(e.id))).toBe(true);
  });

  it('deletes files and refuses empty commits and moved heads', async () => {
    const { fake, client } = setup();
    await client.createBranch({ name: 'b' });
    const commit = await client.commitFiles({
      branch: 'b',
      message: 'rm',
      files: [{ path: 'README.md', content: null }],
    });
    expect(commit.parents).toHaveLength(1);
    const empty = client.commitFiles({ branch: 'b', message: 'm', files: [] });
    expect((await rejection(empty)).code).toBe('invalid-request');
    expect(
      (await rejection(client.commitFiles({ branch: 'nope', message: 'm', files: [{ path: 'a', content: 'a' }] })))
        .code,
    ).toBe('not-found');
    // Someone pushes between the client reading the head and moving the ref.
    const racing = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[2] === 'PATCH' ? { stderr: 'gh: Update is not a fast forward (HTTP 422)' } : undefined,
      ),
    });
    const race = racing.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'a', content: 'a' }] });
    expect((await rejection(race)).code).toBe('conflict');
    const failing = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) => (args[2] === 'PATCH' ? { stderr: 'gh: Server Error (HTTP 502)' } : undefined)),
    });
    const outage = await rejection(
      failing.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'a', content: 'a' }] }),
    );
    expect([outage.code, outage.retryable]).toEqual(['unavailable', true]);
  });

  it('maps a failed branch creation that is not a duplicate through the status code', async () => {
    const { fake } = setup();
    const client = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[2] === 'POST' && args[3]?.endsWith('/git/refs')
          ? { stderr: 'gh: API rate limit exceeded (HTTP 403)' }
          : undefined,
      ),
    });
    expect((await rejection(client.createBranch({ name: 'b' }))).code).toBe('rate-limited');
  });

  it('opens its own PR next to a fork PR with the same head branch name', async () => {
    const { fake, client } = setup();
    await client.createBranch({ name: 'patch-1' });
    await client.commitFiles({ branch: 'patch-1', message: 'm', files: [{ path: 'x', content: '1' }] });
    const forkNumber = fake.addForkPr('patch-1', 'someone');
    const fork = await client.getPr(forkNumber);
    expect(fork).toMatchObject({ fork: true, headRepo: 'someone/lectio', author: 'someone' });
    const { pr, created } = await client.openOrUpdatePr({ head: 'patch-1', title: 'Ours', body: '' });
    expect(created).toBe(true);
    expect(pr).toMatchObject({ fork: false, headRepo: REPO });
    expect((await client.listPrs({ head: 'patch-1', state: 'all' })).map((p) => p.number)).toEqual([
      forkNumber,
      pr.number,
    ]);
  });

  it('lists PRs by state, keeping closed and merged apart', async () => {
    const { client } = setup();
    for (const name of ['a', 'b']) {
      await client.createBranch({ name });
      await client.commitFiles({ branch: name, message: name, files: [{ path: `${name}.md`, content: name }] });
    }
    const a = await client.openOrUpdatePr({ head: 'a', title: 'a', body: '' });
    const b = await client.openOrUpdatePr({ head: 'b', title: 'b', body: '' });
    await client.mergePr(a.pr.number, { matchHeadSha: a.pr.headSha, method: 'merge' });
    expect((await client.listPrs({ state: 'closed' })).map((p) => p.number)).toEqual([]);
    expect((await client.listPrs({ state: 'merged' })).map((p) => p.number)).toEqual([a.pr.number]);
    expect((await client.listPrs()).map((p) => p.number)).toEqual([b.pr.number]);
    expect((await client.listPrs({ state: 'all' })).map((p) => p.number)).toEqual([a.pr.number, b.pr.number]);
    expect((await rejection(client.mergePr(a.pr.number, { matchHeadSha: a.pr.headSha }))).code).toBe('conflict');
    expect((await client.getPr(a.pr.number)).headSha).toBe(a.pr.headSha);
  });

  it('maps gh merge refusals to conflict and reports a merge without a merge commit', async () => {
    const { fake, client: setupClient } = setup();
    await setupClient.createBranch({ name: 'b' });
    const commit = await setupClient.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'x', content: '1' }] });
    const { pr } = await setupClient.openOrUpdatePr({ head: 'b', title: 't', body: '' });
    const refusing = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[1] === 'merge'
          ? { stderr: 'X Pull request #1 is not mergeable: the base branch policy prohibits the merge.' }
          : undefined,
      ),
    });
    expect((await rejection(refusing.mergePr(pr.number, { matchHeadSha: commit.sha }))).code).toBe('conflict');
    const broken = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) => (args[1] === 'merge' ? { stderr: 'HTTP 401: Bad credentials' } : undefined)),
    });
    expect((await rejection(broken.mergePr(pr.number, { matchHeadSha: commit.sha }))).code).toBe('invalid-request');
    const silent = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) => (args[1] === 'merge' ? { exitCode: 0 } : undefined)),
    });
    expect((await rejection(silent.mergePr(pr.number, { matchHeadSha: commit.sha }))).code).toBe('malformed-output');
  });

  it('enables auto-merge with the requested method', async () => {
    const { fake, client } = setup();
    await client.createBranch({ name: 'b' });
    await client.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'x', content: '1' }] });
    const { pr } = await client.openOrUpdatePr({ head: 'b', title: 't', body: '' });
    await client.enableAutoMerge(pr.number, { method: 'rebase' });
    await client.enableAutoMerge(pr.number);
    expect(fake.calls.filter((c) => c.args.includes('--auto')).map((c) => c.args.at(-1))).toEqual([
      '--rebase',
      '--squash',
    ]);
    const events = await client.listIssueEvents(pr.number);
    expect(events.filter((e) => e.event === 'auto_merge_enabled')).toHaveLength(1);
  });

  it('adds no labels as a read, and tolerates labels created concurrently', async () => {
    const { fake, client } = setup();
    const { issue } = await client.upsertIssue('m', { title: 't', body: 'b' });
    expect(await client.addLabels(issue.number, [])).toEqual([]);
    await client.addLabels(issue.number, ['a']);
    // A second client whose label list is stale: `gh label create` reports the label exists.
    const other = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[0] === 'label' && args[1] === 'list' ? { exitCode: 0, stdout: '[]' } : undefined,
      ),
    });
    expect(await other.addLabels(issue.number, ['a', 'b'])).toEqual(['a', 'b']);
    const failing = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[0] === 'label' && args[1] === 'create' ? { stderr: 'HTTP 403: Must have admin rights' } : undefined,
      ),
    });
    expect((await rejection(failing.addLabels(issue.number, ['c']))).code).toBe('invalid-request');
  });

  it('removes labels with names that need escaping and reports other failures', async () => {
    const { fake, client } = setup();
    const { issue } = await client.upsertIssue('m', { title: 't', body: 'b', labels: ['needs review/2', 'keep'] });
    expect(await client.removeLabels(issue.number, ['needs review/2'])).toEqual(['keep']);
    expect((await rejection(client.removeLabels(999, ['keep']))).code).toBe('not-found');
    const failing = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) => (args[2] === 'DELETE' ? { stderr: 'gh: Server Error (HTTP 500)' } : undefined)),
    });
    expect((await rejection(failing.removeLabels(issue.number, ['keep']))).code).toBe('unavailable');
  });

  it('updates only its own sticky comment', async () => {
    const { fake, client } = setup();
    const { issue } = await client.upsertIssue('runway', { title: 't', body: 'b' });
    fake.postComment(issue.number, 'reviewer', `quoted ${markerComment('gates')}`);
    const first = await client.upsertComment(issue.number, 'gates', 'mine');
    expect(first.created).toBe(true);
    const second = await client.upsertComment(issue.number, 'gates', `again ${markerComment('gates')}`);
    expect(second).toMatchObject({
      created: false,
      comment: { id: first.comment.id, body: `again ${markerComment('gates')}` },
    });
    expect((await client.listComments(issue.number)).map((c) => c.author)).toEqual(['reviewer', 'lectio-bot']);
    await expect(client.upsertComment(issue.number, 'bad marker', 'x')).rejects.toThrow(RangeError);
  });

  it('upserts issues: reopens a closed one and prefers the open one', async () => {
    const { fake, client } = setup();
    const first = await client.upsertIssue('runway', { title: 'Low', body: 'b', state: 'closed' });
    expect(first).toMatchObject({ created: true, issue: { state: 'closed', author: 'lectio-bot' } });
    const reopened = await client.upsertIssue('runway', { title: 'Low again', body: 'c' });
    expect(reopened).toMatchObject({
      created: false,
      issue: { number: first.issue.number, state: 'open', title: 'Low again' },
    });
    const events = await client.listIssueEvents(first.issue.number);
    expect(events.map((e) => e.event)).toEqual(['closed', 'reopened']);
    expect(fake.calls.some((c) => c.args[0] === 'issue' && c.args[1] === 'reopen')).toBe(true);
  });

  it('reuses the open issue when an older closed one has the same marker', async () => {
    const { fake, client } = setup();
    const closed = await client.upsertIssue('runway', { title: 'Old', body: 'b', state: 'closed' });
    // A client that did not see the closed issue opens a second one.
    const blind = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[0] === 'issue' && args[1] === 'list' ? { exitCode: 0, stdout: '[]' } : undefined,
      ),
    });
    const open = await blind.upsertIssue('runway', { title: 'New', body: 'b' });
    expect(open.issue.number).not.toBe(closed.issue.number);
    const again = await client.upsertIssue('runway', { title: 'Newer', body: 'c' });
    expect(again).toMatchObject({ created: false, issue: { number: open.issue.number, state: 'open' } });
  });

  it('reads commits without a GitHub author and maps other commit failures', async () => {
    const { fake } = setup();
    const commit = {
      sha: 'e'.repeat(40),
      parents: [],
      commit: {
        message: 'm',
        author: { name: 'Jane Doe', date: '2026-01-01T00:00:00Z' },
        committer: { name: 'Jane Doe', date: '2026-01-01T00:00:00Z' },
        verification: { verified: false },
      },
      author: null,
    };
    const client = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) => {
        if (args[3]?.endsWith(`/commits/${'e'.repeat(40)}`)) return { exitCode: 0, stdout: JSON.stringify(commit) };
        if (args[3]?.endsWith('/commits/broken')) return { stderr: 'gh: Server Error (HTTP 500)' };
        return undefined;
      }),
    });
    expect((await client.getCommit('e'.repeat(40))).author).toBe('Jane Doe');
    expect((await rejection(client.getCommit('broken'))).code).toBe('unavailable');
  });

  it('reports malformed gh output', async () => {
    const { fake } = setup();
    const garbled = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) => {
        if (args[1] === 'create') return { exitCode: 0, stdout: 'Creating pull request... done\n' };
        if (args[1] === 'view') return { exitCode: 0, stdout: 'not json' };
        return undefined;
      }),
    });
    await garbled.createBranch({ name: 'b' });
    await garbled.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'x', content: '1' }] });
    expect((await rejection(garbled.openOrUpdatePr({ head: 'b', title: 't', body: '' }))).code).toBe(
      'malformed-output',
    );
    expect((await rejection(garbled.getPr(1))).code).toBe('malformed-output');
    expect((await rejection(garbled.upsertIssue('m', { title: 't', body: '' }))).code).toBe('malformed-output');
  });

  it('reads PRs from deleted forks and deleted accounts', async () => {
    const { fake } = setup();
    const ghostPr = {
      number: 3,
      url: `https://github.com/${REPO}/pull/3`,
      title: 't',
      body: '',
      headRefName: 'patch-1',
      headRepository: null,
      headRepositoryOwner: { login: 'gone' },
      isCrossRepository: true,
      baseRefName: 'main',
      headRefOid: 'c'.repeat(40),
      state: 'CLOSED',
      isDraft: false,
      labels: [],
      author: null,
      autoMergeRequest: null,
      mergeCommit: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const client = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[1] === 'view' ? { exitCode: 0, stdout: JSON.stringify(ghostPr) } : undefined,
      ),
    });
    expect(await client.getPr(3)).toMatchObject({
      headRepo: 'gone/unknown',
      fork: true,
      author: 'ghost',
      state: 'closed',
    });
  });

  it('maps every PR file status and sorts by path', async () => {
    const { fake } = setup();
    const files = [
      { filename: 'z.md', status: 'copied' },
      { filename: 'c.md', status: 'changed' },
      { filename: 'b.md', status: 'removed' },
      { filename: 'a.md', status: 'modified' },
      { filename: 'a.md.bak', status: 'unchanged' },
    ];
    const client = new GhGitHubClient({
      repo: REPO,
      exec: overriding(fake, (args) =>
        args[3]?.endsWith('/files')
          ? { exitCode: 0, stdout: JSON.stringify([files.slice(0, 2), files.slice(2)]) }
          : undefined,
      ),
    });
    expect(await client.getPrFiles(1)).toEqual([
      { path: 'a.md', status: 'modified' },
      { path: 'a.md.bak', status: 'modified' },
      { path: 'b.md', status: 'removed' },
      { path: 'c.md', status: 'modified' },
      { path: 'z.md', status: 'added' },
    ]);
    expect((await rejection(setup().client.getPrFiles(99))).code).toBe('not-found');
  });

  it('reads workflow runs, mapping statuses and conclusions', async () => {
    const { fake, client } = setup();
    const base = { event: 'workflow_dispatch', head_sha: 'b'.repeat(40), head_branch: 'main', pull_requests: [] };
    const queued = fake.addRun({
      ...base,
      path: '.github/workflows/a.yml',
      status: 'waiting',
      conclusion: null,
      actor: null,
    });
    const running = fake.addRun({
      ...base,
      path: '.github/workflows/b.yml@refs/heads/main',
      status: 'in_progress',
      conclusion: null,
      actor: { login: 'x' },
    });
    const odd = fake.addRun({
      ...base,
      path: 'c.yml',
      status: 'completed',
      conclusion: 'startup_failure',
      actor: { login: 'x' },
    });
    expect(await client.getWorkflowRun(queued.id)).toMatchObject({
      workflowFile: 'a.yml',
      status: 'queued',
      conclusion: null,
      actor: 'ghost',
    });
    expect(await client.getWorkflowRun(running.id)).toMatchObject({ workflowFile: 'b.yml', status: 'in_progress' });
    expect(await client.getWorkflowRun(odd.id)).toMatchObject({
      workflowFile: 'c.yml',
      status: 'completed',
      conclusion: 'failure',
    });
  });

  it('dispatches with inputs and maps unknown workflows and refs to not-found', async () => {
    const { fake, client } = setup();
    await client.dispatchWorkflow('ci.yml', 'main', { reason: 'a=b' });
    expect(fake.dispatches).toEqual([{ file: 'ci.yml', ref: 'main', inputs: { reason: 'a=b' } }]);
    expect((await rejection(client.dispatchWorkflow('ci.yml', 'no-such-ref'))).code).toBe('not-found');
    expect((await rejection(client.dispatchWorkflow('other.yml', 'main'))).code).toBe('not-found');
  });

  describe('waitForRequiredChecks', () => {
    async function prWithChecks(requiredChecks: string[], options: Omit<GhGitHubClientOptions, 'exec'> = {}) {
      const ctx = setup({ requiredChecks }, options);
      await ctx.client.createBranch({ name: 'b' });
      const commit = await ctx.client.commitFiles({ branch: 'b', message: 'm', files: [{ path: 'x', content: '1' }] });
      await ctx.client.openOrUpdatePr({ head: 'b', title: 't', body: '' });
      return { ...ctx, sha: commit.sha };
    }

    it('polls until the required checks complete, leaving out excluded ones', async () => {
      const { fake, sha } = await prWithChecks(['lint', 'test', 'merge-rule']);
      let polls = 0;
      const client = new GhGitHubClient({
        repo: REPO,
        exec: fake.exec,
        pollIntervalMs: 5,
        sleep: async () => {
          polls += 1;
          fake.setCheck(sha, 'lint', 'SUCCESS');
          if (polls === 2) fake.setCheck(sha, 'test', 'SKIPPED');
        },
      });
      fake.setCheck(sha, 'test', 'IN_PROGRESS');
      const result = await client.waitForRequiredChecks({ sha, exclude: ['merge-rule'] });
      expect(polls).toBe(2);
      expect(result).toEqual({
        sha,
        ok: true,
        checks: [
          { name: 'lint', headSha: sha, status: 'completed', conclusion: 'success' },
          { name: 'test', headSha: sha, status: 'completed', conclusion: 'skipped' },
        ],
      });
    });

    it('reports failed checks as not ok', async () => {
      const { fake, client, sha } = await prWithChecks(['lint', 'odd']);
      fake.setCheck(sha, 'lint', 'FAILURE');
      fake.setCheck(sha, 'odd', 'STALE');
      const result = await client.waitForRequiredChecks({ sha });
      expect(result.ok).toBe(false);
      expect(result.checks.map((c) => c.conclusion)).toEqual(['failure', 'failure']);
    });

    it('times out with the pending check names, sleeping no later than the deadline', async () => {
      const { client, sha, time } = await prWithChecks(['lint', 'unknown'], { pollIntervalMs: 400 });
      const error = await rejection(client.waitForRequiredChecks({ sha, timeoutMs: 1000 }));
      expect(error.code).toBe('timeout');
      expect(error.message).toContain('lint, unknown');
      expect(time.sleeps).toEqual([400, 400, 200]);
    });

    it('uses the default timeout and real sleep', async () => {
      const { fake, sha } = await prWithChecks(['lint']);
      let calls = 0;
      const start = Date.now();
      const client = new GhGitHubClient({
        repo: REPO,
        exec: fake.exec,
        pollIntervalMs: 1,
        checksTimeoutMs: 1_000_000,
        now: () => (calls++ < 2 ? start : start + 2_000_000),
      });
      expect((await rejection(client.waitForRequiredChecks({ sha }))).code).toBe('timeout');
    });

    it('needs an open PR at the sha and reports gh failures', async () => {
      const { fake, client, sha } = await prWithChecks(['lint']);
      expect((await rejection(client.waitForRequiredChecks({ sha: 'd'.repeat(40) }))).code).toBe('not-found');
      const failing = new GhGitHubClient({
        repo: REPO,
        exec: overriding(fake, (args) => (args[1] === 'checks' ? { stderr: 'HTTP 502: Bad Gateway' } : undefined)),
      });
      expect((await rejection(failing.waitForRequiredChecks({ sha }))).code).toBe('unavailable');
    });
  });
});
