import { describe, expect, it } from 'vitest';

import { ProviderError } from '../errors.ts';
import type { GitHubClient, WorkflowRun } from '../github.ts';
import { markerComment } from '../github.ts';

export interface GitHubContractSubject {
  readonly client: GitHubClient;
  /** The repository's default branch. */
  readonly defaultBranch: string;
  /** A workflow file that accepts `workflow_dispatch` on the default branch. */
  readonly workflowFile: string;
  /** Prefix for branch names and markers, unique per run so live runs do not collide. */
  readonly prefix: string;
  /** A workflow run that exists, with the fields `getWorkflowRun` must return for it. */
  readonly knownRun: Pick<WorkflowRun, 'id' | 'workflowFile' | 'event' | 'headSha' | 'headBranch'>;
}

export interface GitHubContractOptions {
  readonly name?: string;
  readonly timeoutMs?: number;
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

/**
 * The behaviour every `GitHubClient` must have. `provider-gh` (L-029) runs it with a
 * fake `exec` replaying recorded gh JSON; L-212 runs it against a throwaway repository.
 */
export function describeGitHubContract(
  factory: () => GitHubContractSubject | Promise<GitHubContractSubject>,
  options: GitHubContractOptions = {},
): void {
  const timeout = options.timeoutMs;

  /** A branch with one commit and an open PR for it. */
  async function openPr(subject: GitHubContractSubject, slug: string) {
    const { client, prefix } = subject;
    const branch = `${prefix}${slug}`;
    await client.createBranch({ name: branch });
    const commit = await client.commitFiles({
      branch,
      message: `Add ${slug}`,
      files: [{ path: `passages/${slug}.json`, content: '{"status":"pending"}\n' }],
    });
    const { pr, created } = await client.openOrUpdatePr({ head: branch, title: `Research ${slug}`, body: 'Body' });
    return { branch, commit, pr, created };
  }

  describe(`GitHubClient contract${options.name ? ` (${options.name})` : ''}`, () => {
    it('names the viewer', { timeout }, async () => {
      const { client } = await factory();
      expect((await client.viewer()).length).toBeGreaterThan(0);
    });

    it('creates branches and commits, and refuses to recreate a branch', { timeout }, async () => {
      const subject = await factory();
      const { client, prefix } = subject;
      const branch = `${prefix}branch`;
      const created = await client.createBranch({ name: branch });
      const commit = await client.commitFiles({
        branch,
        message: 'Add a file',
        files: [{ path: 'notes/a.md', content: 'a\n' }],
        expectedHeadSha: created.sha,
      });
      expect(commit.parents).toEqual([created.sha]);
      // Created through the API, so GitHub signs it: the approval commit depends on this.
      expect(commit.verified).toBe(true);
      expect(await client.getCommit(commit.sha)).toEqual(commit);
      expect((await rejection(client.createBranch({ name: branch }))).code).toBe('conflict');
      const stale = client.commitFiles({
        branch,
        message: 'Stale',
        files: [{ path: 'notes/b.md', content: 'b\n' }],
        expectedHeadSha: created.sha,
      });
      expect((await rejection(stale)).code).toBe('conflict');
    });

    it('opens a PR once and updates it on the next call', { timeout }, async () => {
      const subject = await factory();
      const { client } = subject;
      const { branch, commit, pr, created } = await openPr(subject, 'open-update');
      expect(created).toBe(true);
      expect(pr).toMatchObject({
        head: branch,
        base: subject.defaultBranch,
        state: 'open',
        headSha: commit.sha,
        fork: false,
      });
      expect(pr.headRepo).toMatch(/^[^/\s]+\/[^/\s]+$/);
      const again = await client.openOrUpdatePr({
        head: branch,
        title: 'Renamed',
        body: 'New body',
        labels: ['research'],
      });
      expect(again.created).toBe(false);
      expect(again.pr.number).toBe(pr.number);
      expect(again.pr.title).toBe('Renamed');
      expect(again.pr.labels).toContain('research');
      expect((await client.listPrs({ head: branch })).map((p) => p.number)).toEqual([pr.number]);
      expect((await client.listPrs({ label: 'research' })).map((p) => p.number)).toContain(pr.number);
      expect(await client.getPrFiles(pr.number)).toEqual([{ path: 'passages/open-update.json', status: 'added' }]);
      expect((await rejection(client.getPr(987654321))).code).toBe('not-found');
    });

    it('retargets an open PR to a new base', { timeout }, async () => {
      const subject = await factory();
      const { client, prefix } = subject;
      const { branch, pr } = await openPr(subject, 'retarget');
      const base = `${prefix}retarget-base`;
      await client.createBranch({ name: base });
      const moved = await client.openOrUpdatePr({ head: branch, base, title: pr.title, body: pr.body });
      expect(moved.created).toBe(false);
      expect(moved.pr.base).toBe(base);
      expect((await client.getPr(pr.number)).base).toBe(base);
      expect(await client.getPrFiles(pr.number)).toEqual([{ path: 'passages/retarget.json', status: 'added' }]);
    });

    it('reports a moved file as one rename with its previous path', { timeout }, async () => {
      const subject = await factory();
      const { client, prefix } = subject;
      const { pr, commit } = await openPr(subject, 'rename-seed');
      await client.mergePr(pr.number, { matchHeadSha: commit.sha });
      const branch = `${prefix}rename`;
      await client.createBranch({ name: branch });
      await client.commitFiles({
        branch,
        message: 'Move a file',
        files: [
          { path: 'passages/rename-seed.json', content: null },
          { path: 'archive/rename-seed.json', content: '{"status":"pending"}\n' },
        ],
      });
      const moved = await client.openOrUpdatePr({ head: branch, title: 'Move', body: '' });
      expect(await client.getPrFiles(moved.pr.number)).toEqual([
        { path: 'archive/rename-seed.json', status: 'renamed', previousPath: 'passages/rename-seed.json' },
      ]);
    });

    it('adds and removes labels idempotently and records who did it', { timeout }, async () => {
      const subject = await factory();
      const { client } = subject;
      const viewer = await client.viewer();
      const { pr } = await openPr(subject, 'labels');
      await client.addLabels(pr.number, ['needs-review']);
      expect(await client.addLabels(pr.number, ['needs-review', 'research'])).toEqual(['needs-review', 'research']);
      expect(await client.removeLabels(pr.number, ['needs-review', 'absent'])).toEqual(['research']);
      const events = await client.listIssueEvents(pr.number);
      const labelEvents = events.filter((e) => e.event === 'labeled' || e.event === 'unlabeled');
      expect(labelEvents.map((e) => [e.event, e.label, e.actor])).toEqual([
        ['labeled', 'needs-review', viewer],
        ['labeled', 'research', viewer],
        ['unlabeled', 'needs-review', viewer],
      ]);
      expect(events.some((e) => e.event === 'committed')).toBe(true);
      const times = events.map((e) => Date.parse(e.createdAt));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('keeps one sticky comment per marker', { timeout }, async () => {
      const subject = await factory();
      const { client, prefix } = subject;
      const { pr } = await openPr(subject, 'comments');
      const marker = `${prefix}gates`;
      const first = await client.upsertComment(pr.number, marker, 'first');
      const second = await client.upsertComment(pr.number, marker, 'second');
      expect([first.created, second.created]).toEqual([true, false]);
      expect(second.comment.id).toBe(first.comment.id);
      const sticky = (await client.listComments(pr.number)).filter((c) => c.body.includes(markerComment(marker)));
      expect(sticky).toHaveLength(1);
      expect(sticky[0]?.body).toContain('second');
      expect(sticky[0]?.author).toBe(await client.viewer());
    });

    it('keeps one issue per marker', { timeout }, async () => {
      const { client, prefix } = await factory();
      const marker = `${prefix}runway`;
      const first = await client.upsertIssue(marker, {
        title: 'Runway low',
        body: '5 days missing',
        labels: ['runway'],
      });
      const second = await client.upsertIssue(marker, { title: 'Runway low', body: '3 days missing' });
      expect([first.created, second.created]).toEqual([true, false]);
      expect(second.issue.number).toBe(first.issue.number);
      expect(second.issue.body).toContain('3 days missing');
      expect(second.issue.labels).toContain('runway');
      const closed = await client.upsertIssue(marker, { title: 'Runway ok', body: 'ok', state: 'closed' });
      expect(closed.issue.state).toBe('closed');
    });

    it('merges only at the expected head sha', { timeout }, async () => {
      const subject = await factory();
      const { client } = subject;
      const { pr, commit } = await openPr(subject, 'merge');
      await client.enableAutoMerge(pr.number, { method: 'squash' });
      expect((await client.getPr(pr.number)).autoMerge).toBe(true);
      const draft = await openPr(subject, 'draft');
      await client.openOrUpdatePr({ head: draft.branch, title: 'Draft', body: '', draft: true });
      expect((await rejection(client.mergePr(draft.pr.number, { matchHeadSha: draft.commit.sha }))).code).toBe(
        'conflict',
      );
      const wrong = client.mergePr(pr.number, { matchHeadSha: '0'.repeat(40) });
      expect((await rejection(wrong)).code).toBe('conflict');
      const merged = await client.mergePr(pr.number, { matchHeadSha: commit.sha, method: 'squash' });
      const after = await client.getPr(pr.number);
      expect(after.state).toBe('merged');
      expect(after.mergeCommitSha).toBe(merged.sha);
      expect((await client.listIssueEvents(pr.number)).some((e) => e.event === 'merged')).toBe(true);
      expect((await client.listPrs({ state: 'merged' })).map((p) => p.number)).toContain(pr.number);
    });

    it('dispatches workflows and reads workflow runs', { timeout }, async () => {
      const { client, defaultBranch, workflowFile } = await factory();
      await client.dispatchWorkflow(workflowFile, defaultBranch, { reason: 'contract' });
      expect((await rejection(client.dispatchWorkflow('no-such-workflow.yml', defaultBranch))).code).toBe('not-found');
      expect((await rejection(client.getWorkflowRun(1))).code).toBe('not-found');
    });

    it('reads a known workflow run', { timeout }, async () => {
      const { client, knownRun } = await factory();
      const run = await client.getWorkflowRun(knownRun.id);
      expect(run).toMatchObject(knownRun);
      expect(Array.isArray(run.prNumbers)).toBe(true);
      expect(typeof run.actor).toBe('string');
    });

    it('reports required checks on a sha', { timeout }, async () => {
      const subject = await factory();
      const { client } = subject;
      const { commit } = await openPr(subject, 'checks');
      const result = await client
        .waitForRequiredChecks({ sha: commit.sha, exclude: ['merge-rule'], timeoutMs: 1000 })
        .catch((error: unknown) => error);
      if (result instanceof ProviderError) {
        expect(result.code).toBe('timeout');
      } else {
        expect(result).toMatchObject({ sha: commit.sha });
        expect(Array.isArray((result as { checks: unknown }).checks)).toBe(true);
      }
    });
  });
}
