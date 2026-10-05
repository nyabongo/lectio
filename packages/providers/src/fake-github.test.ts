import { describe, expect, it } from 'vitest';

import { FakeClock } from './clock.ts';
import { ProviderError } from './errors.ts';
import { FakeGitHubClient } from './fake-github.ts';
import type { FakeGitHubOptions } from './fake-github.ts';
import type { IssueComment, IssueEvent } from './github.ts';
import { markerComment, withMarker } from './github.ts';

const OWNER = 'angello';

function setup(options: FakeGitHubOptions = {}) {
  const bot = new FakeGitHubClient({
    files: { 'README.md': 'hello\n', 'passages/old.json': '{}\n' },
    requiredChecks: ['lint', 'unit', 'merge-rule'],
    workflows: {
      'ci.yml': { jobs: ['lint', 'unit'] },
      'deploy.yml': {},
      'broken.yml': { jobs: ['x'], conclusion: 'failure' },
    },
    ...options,
  });
  return { bot, owner: bot.as(OWNER) };
}

async function researchPr(bot: FakeGitHubClient, slug = 'mt-20-1-16') {
  await bot.createBranch({ name: `research/${slug}` });
  const commit = await bot.commitFiles({
    branch: `research/${slug}`,
    message: `Research ${slug}`,
    files: [{ path: `passages/${slug}.json`, content: '{"review":{"status":"pending"}}\n' }],
  });
  const { pr } = await bot.openOrUpdatePr({
    head: `research/${slug}`,
    title: `Research ${slug}`,
    body: 'Notes',
    labels: ['research'],
  });
  return { pr, commit };
}

/** The approval rule L-031 implements, written against the fake's data to prove it is testable. */
function approvedBy(events: readonly IssueEvent[], reviewers: readonly string[]): string | undefined {
  const lastCommit = events.filter((e) => e.event === 'committed').at(-1);
  return events.find(
    (e) =>
      e.event === 'labeled' &&
      e.label === 'approved' &&
      reviewers.includes(e.actor) &&
      lastCommit !== undefined &&
      e.createdAt > lastCommit.createdAt,
  )?.actor;
}

describe('FakeGitHubClient actors', () => {
  it('records who added a label, so approval by label can be verified', async () => {
    const { bot, owner } = setup();
    const { pr } = await researchPr(bot);
    await bot.addLabels(pr.number, ['needs-review']);
    await bot.as('stranger').addLabels(pr.number, ['approved']);
    expect(approvedBy(await bot.listIssueEvents(pr.number), [OWNER])).toBeUndefined();

    await bot.as('stranger').removeLabels(pr.number, ['approved']);
    await owner.addLabels(pr.number, ['approved']);
    const events = await bot.listIssueEvents(pr.number);
    expect(events.map((e) => [e.event, e.label ?? e.sha?.slice(0, 0) ?? '', e.actor])).toEqual([
      ['committed', '', 'lectio-bot'],
      ['labeled', 'research', 'lectio-bot'],
      ['labeled', 'needs-review', 'lectio-bot'],
      ['labeled', 'approved', 'stranger'],
      ['unlabeled', 'approved', 'stranger'],
      ['labeled', 'approved', OWNER],
    ]);
    expect(approvedBy(events, [OWNER])).toBe(OWNER);
  });

  it('orders a later content commit after the approval, which invalidates it', async () => {
    const { bot, owner } = setup();
    const { pr } = await researchPr(bot);
    await owner.addLabels(pr.number, ['approved']);
    await owner.pushCommit({
      branch: pr.head,
      message: 'Tweak',
      files: [{ path: 'passages/mt-20-1-16.json', content: '{}\n' }],
    });
    const events = await bot.listIssueEvents(pr.number);
    expect(events.at(-1)).toMatchObject({ event: 'committed', actor: OWNER });
    expect(approvedBy(events, [OWNER])).toBeUndefined();
    const head = await bot.getCommit((await bot.getPr(pr.number)).headSha);
    expect(head).toMatchObject({ author: OWNER, verified: false });
  });

  it('records /approve comments with their author next to sticky bot comments', async () => {
    const { bot, owner } = setup();
    const { pr } = await researchPr(bot);
    await bot.upsertComment(pr.number, 'lectio-gates', 'Gates: needs review');
    await owner.postComment(pr.number, '/approve');
    // A reviewer quoting the marker does not hijack the bot's sticky comment.
    await owner.upsertComment(pr.number, 'lectio-gates', 'quoted');
    const updated = await bot.upsertComment(
      pr.number,
      'lectio-gates',
      `Gates: approved\n\n${markerComment('lectio-gates')}`,
    );
    expect(updated.created).toBe(false);
    const comments = await bot.listComments(pr.number);
    expect(comments.map((c) => [c.author, c.body])).toEqual([
      ['lectio-bot', withMarker('lectio-gates', 'Gates: approved')],
      [OWNER, '/approve'],
      [OWNER, withMarker('lectio-gates', 'quoted')],
    ]);
    const [sticky, approve] = comments as [IssueComment, IssueComment];
    expect(sticky.updatedAt > sticky.createdAt).toBe(true);
    expect(approve.createdAt > sticky.createdAt).toBe(true);
  });

  it('stamps every change at least a second after the previous one, from the clock', async () => {
    const { bot } = setup({ clock: new FakeClock({ start: '2026-10-05T08:00:00Z' }) });
    const { pr } = await researchPr(bot);
    const events = await bot.listIssueEvents(pr.number);
    expect(events.map((e) => e.createdAt)).toEqual(['2026-10-05T08:00:01.000Z', '2026-10-05T08:00:03.000Z']);
    expect(pr.createdAt).toBe('2026-10-05T08:00:02.000Z');
  });
});

describe('FakeGitHubClient repository', () => {
  it('lists added, modified and removed files and merges them onto the base', async () => {
    const { bot } = setup();
    await bot.createBranch({ name: 'edit' });
    await bot.commitFiles({
      branch: 'edit',
      message: 'Edit',
      files: [
        { path: 'README.md', content: 'changed\n' },
        { path: 'passages/old.json', content: null },
        { path: 'passages/new.json', content: '{}\n' },
      ],
    });
    // main moves on independently
    await bot.commitFiles({ branch: 'main', message: 'Docs', files: [{ path: 'docs/a.md', content: 'a\n' }] });
    const { pr } = await bot.openOrUpdatePr({ head: 'edit', title: 'Edit', body: '', draft: true });
    expect(pr.draft).toBe(true);
    expect(await bot.getPrFiles(pr.number)).toEqual([
      { path: 'README.md', status: 'modified' },
      { path: 'passages/new.json', status: 'added' },
      { path: 'passages/old.json', status: 'removed' },
    ]);
    const updated = await bot.openOrUpdatePr({ head: 'edit', title: 'Edit', body: 'b', draft: false });
    expect(updated.pr.draft).toBe(false);
    const { sha } = await bot.mergePr(pr.number, { matchHeadSha: pr.headSha });
    expect(bot.headOf('main')).toBe(sha);
    expect(bot.fileAt('main', 'README.md')).toBe('changed\n');
    expect(bot.fileAt('main', 'passages/old.json')).toBeUndefined();
    expect(bot.fileAt('main', 'docs/a.md')).toBe('a\n');
    expect(bot.fileAt(sha, 'passages/new.json')).toBe('{}\n');
    expect((await bot.getCommit(sha)).message).toBe('Edit (#1)');
    expect(bot.merges).toEqual([
      {
        number: 1,
        headSha: pr.headSha,
        sha,
        method: 'squash',
        actor: 'lectio-bot',
        createdAt: expect.any(String) as string,
      },
    ]);
    // A merged PR keeps its files and head even if the branch moves on.
    await bot.commitFiles({ branch: 'edit', message: 'Later', files: [{ path: 'x', content: 'x' }] });
    expect((await bot.getPr(pr.number)).headSha).toBe(pr.headSha);
    expect(await bot.getPrFiles(pr.number)).toHaveLength(3);
    // A new PR can be opened for the same branch once the old one is merged.
    expect((await bot.openOrUpdatePr({ head: 'edit', title: 'Again', body: '' })).created).toBe(true);
  });

  it('records a two-parent commit for merge-method merges', async () => {
    const { bot } = setup();
    const { pr, commit } = await researchPr(bot);
    const { sha } = await bot.mergePr(pr.number, { matchHeadSha: commit.sha, method: 'merge' });
    expect((await bot.getCommit(sha)).parents).toHaveLength(2);
  });

  it('branches from a sha and rejects unknown refs', async () => {
    const { bot } = setup();
    const root = bot.headOf('main');
    await bot.commitFiles({ branch: 'main', message: 'More', files: [{ path: 'b', content: 'b' }] });
    expect(await bot.createBranch({ name: 'old', from: root })).toEqual({ name: 'old', sha: root });
    expect(bot.defaultBranch).toBe('main');
    await expect(bot.createBranch({ name: 'x', from: 'nope' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(bot.commitFiles({ branch: 'nope', message: 'm', files: [] })).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(bot.commitFiles({ branch: 'old', message: 'm', files: [] })).rejects.toMatchObject({
      code: 'invalid-request',
    });
    await expect(bot.openOrUpdatePr({ head: 'main', title: 't', body: '' })).rejects.toMatchObject({
      code: 'invalid-request',
    });
    await expect(bot.openOrUpdatePr({ head: 'old', base: 'gone', title: 't', body: '' })).rejects.toThrow(
      'no branch gone',
    );
  });

  it('filters PRs by state, head and label', async () => {
    const { bot } = setup();
    const a = await researchPr(bot, 'a');
    const b = await researchPr(bot, 'b');
    await bot.closePr(b.pr.number);
    await bot.addLabels(a.pr.number, ['needs-review']);
    expect((await bot.listPrs()).map((p) => p.number)).toEqual([a.pr.number]);
    expect((await bot.listPrs({ state: 'closed' })).map((p) => p.number)).toEqual([b.pr.number]);
    expect((await bot.listPrs({ state: 'all', label: 'research' })).map((p) => p.number)).toEqual([1, 2]);
    expect(await bot.listPrs({ state: 'all', label: 'needs-review', head: 'research/b' })).toEqual([]);
    expect((await bot.listIssueEvents(b.pr.number)).at(-1)).toMatchObject({ event: 'closed' });
    await expect(bot.mergePr(b.pr.number, { matchHeadSha: b.commit.sha })).rejects.toMatchObject({ code: 'conflict' });
    await expect(bot.enableAutoMerge(b.pr.number)).rejects.toMatchObject({ code: 'conflict' });
    expect(bot.repoLabels).toEqual(['needs-review', 'research']);
  });

  it('enables auto-merge once', async () => {
    const { bot } = setup();
    const { pr } = await researchPr(bot);
    await bot.enableAutoMerge(pr.number);
    await bot.enableAutoMerge(pr.number);
    const events = (await bot.listIssueEvents(pr.number)).filter((e) => e.event === 'auto_merge_enabled');
    expect(events).toHaveLength(1);
  });

  it('separates issues from PRs', async () => {
    const { bot } = setup();
    const { issue } = await bot.upsertIssue('runway', { title: 'Runway', body: 'low' });
    await expect(bot.getPr(issue.number)).rejects.toThrow(`no pr #${issue.number}`);
    await expect(bot.listComments(99)).rejects.toThrow('no issue or pr #99');
    expect(issue.url).toBe('https://github.com/nyabongo/lectio/issues/1');
    const reopened = await bot.upsertIssue('runway', { title: 'Runway', body: 'low', state: 'closed' });
    expect(reopened.issue.state).toBe('closed');
    const again = await bot.upsertIssue('runway', { title: 'Runway', body: 'low again' });
    expect(again.issue.state).toBe('open');
    expect((await bot.listIssueEvents(issue.number)).map((e) => e.event)).toEqual(['closed', 'reopened']);
    expect(() => markerComment('has space')).toThrow(RangeError);
  });
});

describe('FakeGitHubClient checks and workflows', () => {
  it('dispatches workflows, creating runs and their check runs on the ref head', async () => {
    const { bot } = setup();
    const { pr, commit } = await researchPr(bot);
    await bot.dispatchWorkflow('ci.yml', pr.head, { pr: String(pr.number) });
    const [dispatch] = bot.dispatches;
    expect(dispatch).toMatchObject({
      file: 'ci.yml',
      ref: pr.head,
      sha: commit.sha,
      inputs: { pr: '1' },
      actor: 'lectio-bot',
    });
    const run = await bot.getWorkflowRun(dispatch?.runId ?? 0);
    expect(run).toMatchObject({
      workflowFile: 'ci.yml',
      event: 'workflow_dispatch',
      headSha: commit.sha,
      conclusion: 'success',
    });
    const result = await bot.waitForRequiredChecks({ sha: commit.sha, exclude: ['merge-rule'] });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual(['lint', 'unit']);
  });

  it('times out on pending checks and reports failures', async () => {
    const { bot } = setup();
    const { commit } = await researchPr(bot);
    bot.setCheck(commit.sha, 'lint', null);
    await expect(bot.waitForRequiredChecks({ sha: commit.sha })).rejects.toThrow(
      /did not finish: lint, unit, merge-rule/,
    );
    bot.setCheck(commit.sha, 'lint', 'success');
    bot.setCheck(commit.sha, 'unit', 'skipped');
    bot.setCheck(commit.sha, 'merge-rule', 'failure');
    const result = await bot.waitForRequiredChecks({ sha: commit.sha });
    expect(result.ok).toBe(false);
    await expect(bot.dispatchWorkflow('ci.yml', 'missing-branch')).rejects.toBeInstanceOf(ProviderError);
  });

  it('records failing workflows and externally triggered runs', async () => {
    const { bot } = setup();
    await bot.dispatchWorkflow('broken.yml', 'main');
    const run = await bot.getWorkflowRun(bot.dispatches[0]?.runId ?? 0);
    expect(run.conclusion).toBe('failure');
    const added = bot.addWorkflowRun({
      workflowFile: 'content-gates.yml',
      event: 'pull_request',
      headSha: 'abc',
      headBranch: 'research/x',
      prNumbers: [1],
      status: 'completed',
      conclusion: 'success',
      actor: OWNER,
    });
    expect(await bot.getWorkflowRun(added.id)).toEqual(added);
    const pinned = bot.addWorkflowRun({ ...added, id: 42 });
    expect(pinned.id).toBe(42);
  });

  it('produces identical histories across runs', async () => {
    const history = async () => {
      const { bot, owner } = setup();
      const { pr, commit } = await researchPr(bot);
      await owner.addLabels(pr.number, ['approved']);
      await bot.mergePr(pr.number, { matchHeadSha: commit.sha });
      return { events: await bot.listIssueEvents(pr.number), pr: await bot.getPr(pr.number) };
    };
    expect(await history()).toEqual(await history());
  });
});
