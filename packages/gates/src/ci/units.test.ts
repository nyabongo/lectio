import { describe, expect, it } from 'vitest';

import type { LectioConfig } from '@lectio/config';
import { AnthropicLlmClient } from '@lectio/provider-anthropic';
import { LiveSourceFetcher } from '@lectio/provider-fetch';
import { OpenAiLlmClient } from '@lectio/provider-openai';
import { FakeGitHubClient, ProviderError } from '@lectio/providers';
import type { GitCommit, GitHubClient, IssueComment, IssueEvent } from '@lectio/providers';

import type { GateResult } from '../core/result.ts';
import {
  ApprovalCommitError,
  approvalMessage,
  approvedPassages,
  memoryReviewFs,
  toolPrettierJson,
  verifierSummaryFor,
  writeApprovalCommit,
} from './approval-commit.ts';
import { gitCheckout, parseRevList } from './checkout.ts';
import {
  ACTIONS_BOT,
  approvalCommitOf,
  isApprovalCommand,
  pickApproval,
  runName,
  runPrNumber,
  toPullRequestCommit,
} from './facts.ts';
import {
  AUTO_RESULTS,
  CONFIG,
  DETERMINISTIC_PASS,
  PASSAGE,
  PASSAGE_TEXT,
  REGISTRY,
  REPO_ROOT,
  REVIEWER,
  fakeCheckout,
  newRepo,
  openPr,
  plainJson,
  simulateRun,
} from './fixtures/content-gates.ts';
import { DEPLOY_WORKFLOW, runMergeJob } from './merge-job.ts';
import { labelFor, renderDecisionComment, runMergeRuleJob } from './merge-rule-job.ts';
import type { MergeRuleJobInput } from './merge-rule-job.ts';
import { fetcherNote, gateProviders, liveGateProviders } from './providers.ts';
import { parseRequiredChecks, readRequiredChecks } from './registry.ts';
import { relevantFiles, resolveTarget } from './target.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const quiet = (): void => undefined;

/** `client` with some methods replaced (the fake keeps private state, so methods stay bound to it). */
function override(client: GitHubClient, methods: Partial<Record<keyof GitHubClient, unknown>>): GitHubClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (Object.hasOwn(methods, prop)) return methods[prop as keyof GitHubClient];
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe('registry', () => {
  it('reads every workflow and check of the real registry, content-gates included', () => {
    expect(REGISTRY.workflows).toContain('content-gates.yml');
    expect(REGISTRY.checks).toEqual(expect.arrayContaining(['changes', 'deterministic', 'merge-rule']));
    expect(REGISTRY.checks).not.toContain('merge');
  });

  it('refuses malformed or empty registries', () => {
    expect(() => parseRequiredChecks([{ file: 'x.json', source: '{' }])).toThrow(/invalid required-check registry/);
    expect(() => parseRequiredChecks([])).toThrow(/is empty/);
    const fs = { list: () => ['a.json', 'notes.txt'], read: () => '{"workflow":"a.yml","jobs":["j","k"]}' };
    expect(readRequiredChecks('/repo', fs)).toEqual({ workflows: ['a.yml'], checks: ['j', 'k'] });
  });
});

describe('providers', () => {
  it('stays offline by default and says so', () => {
    const providers = gateProviders(
      CONFIG,
      { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' },
      { fetch: 'fixtures', llm: 'off' },
    );
    expect(providers.fakes.has('fetcher')).toBe(true);
    expect(providers.fakes.has('confirmer')).toBe(true);
    expect(fetcherNote(providers)).toMatch(/^Offline run/);
  });

  it('injects the live fetcher, the live verifiers whose keys are set, a real clock and its own meter', () => {
    const github = new FakeGitHubClient();
    const providers = gateProviders(
      CONFIG,
      { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' },
      { fetch: 'live', llm: 'live', github },
    );
    expect(providers.fetcher).toBeInstanceOf(LiveSourceFetcher);
    expect(providers.confirmer).toBeInstanceOf(AnthropicLlmClient);
    expect(providers.refuter).toBeInstanceOf(OpenAiLlmClient);
    expect(providers.github).toBe(github);
    expect([...providers.fakes].sort()).toEqual(['llm', 'storage', 'tts', 'webSearch']);
    expect(fetcherNote(providers)).toMatch(/fetched live/);
  });

  it('injects no verifier without its key or for another family', () => {
    expect(liveGateProviders(CONFIG, {}, { fetch: 'fixtures', llm: 'live' })).toEqual({});
    const other = {
      ...CONFIG,
      verifiers: { ...CONFIG.verifiers, confirmer: CONFIG.verifiers.refuter, refuter: CONFIG.verifiers.confirmer },
    } as LectioConfig;
    const live = liveGateProviders(
      other,
      { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' },
      { fetch: 'fixtures', llm: 'live' },
    );
    expect(live).toEqual({});
  });
});

describe('checkout', () => {
  it('parses rev-list output with parents', () => {
    expect(parseRevList(`${SHA_A} ${SHA_B}\n\n${SHA_B}\n`)).toEqual([
      { sha: SHA_A, parents: [SHA_B] },
      { sha: SHA_B, parents: [] },
    ]);
  });

  it('asks git for the diff, a base file, the commit list and reads the worktree', () => {
    const calls: string[][] = [];
    const exec = (args: readonly string[]): string => {
      calls.push([...args]);
      if (args[0] === 'diff') return `A\0${PASSAGE}\0`;
      if (args[0] === 'ls-tree') return '';
      return `${SHA_A} ${SHA_B}\n`;
    };
    const checkout = gitCheckout(REPO_ROOT, exec);
    expect(checkout.changedFiles('origin/main', 'HEAD')).toEqual([{ path: PASSAGE, status: 'added' }]);
    expect(checkout.show('origin/main', PASSAGE)).toBeNull();
    expect(checkout.revList('origin/main', 'HEAD')).toEqual([{ sha: SHA_A, parents: [SHA_B] }]);
    expect(calls.at(-1)).toEqual(['rev-list', '--parents', 'origin/main..HEAD']);
    expect(checkout.readFile('package.json')).toContain('"workspaces"');
    expect(checkout.readFile('no/such/file')).toBeNull();
  });
});

describe('facts', () => {
  it('ties runs to PRs by their PR list or their run-name', () => {
    expect(runPrNumber({ prNumbers: [3, 7], displayTitle: '' }, 7)).toBe(7);
    expect(runPrNumber({ prNumbers: [], displayTitle: runName(7) }, 7)).toBe(7);
    expect(runPrNumber({ prNumbers: [], displayTitle: runName(8) }, 7)).toBe(8);
    expect(runPrNumber({ prNumbers: [3], displayTitle: 'CI' }, 7)).toBe(3);
    expect(runPrNumber({ prNumbers: [], displayTitle: `${runName(0)}` }, 7)).toBe(0);
    expect(runPrNumber({ prNumbers: [], displayTitle: 'Content gates · PR #7 again' }, 7)).toBe(0);
  });

  it('recognises the approval command on the first line only', () => {
    expect(isApprovalCommand('  /Approve \nlooks good', '/approve')).toBe(true);
    expect(isApprovalCommand('lgtm\n/approve', '/approve')).toBe(false);
    expect(isApprovalCommand('/approved', '/approve')).toBe(false);
    expect(isApprovalCommand('', '/approve')).toBe(false);
  });

  const event = (actor: string, at: string, label = 'approved'): IssueEvent => ({
    id: 1,
    event: 'labeled',
    actor,
    createdAt: at,
    label,
  });
  const comment = (author: string, at: string, body = '/approve', updatedAt = at): IssueComment => ({
    id: 1,
    author,
    body,
    createdAt: at,
    updatedAt,
  });

  it('picks the latest approval by a configured reviewer, else the latest by anyone', () => {
    const t1 = '2026-10-05T10:00:00Z';
    const t2 = '2026-10-05T11:00:00Z';
    const t3 = '2026-10-05T12:00:00Z';
    expect(pickApproval([event(REVIEWER, t1)], [comment(REVIEWER, t2)], ['approved'], CONFIG)).toEqual({
      handle: REVIEWER,
      via: 'comment',
      at: t2,
    });
    expect(pickApproval([event(REVIEWER, t1)], [comment('x', t3)], ['approved'], CONFIG)).toMatchObject({
      via: 'label',
      at: t1,
    });
    // The label no longer on the PR, another label, an edited comment: none counts.
    expect(pickApproval([event(REVIEWER, t1)], [], [], CONFIG)).toBeNull();
    expect(pickApproval([event(REVIEWER, t1, 'bug')], [], ['approved', 'bug'], CONFIG)).toBeNull();
    expect(pickApproval([], [comment(REVIEWER, t1, '/approve', t2)], [], CONFIG)).toBeNull();
    expect(pickApproval([], [comment('x', t1), comment('y', t2)], [], CONFIG)).toMatchObject({ handle: 'y' });
  });

  const commit = (message: string, overrides: Partial<GitCommit> = {}): GitCommit => ({
    sha: SHA_B,
    parents: [SHA_A],
    message,
    author: ACTIONS_BOT,
    verified: true,
    createdAt: '2026-10-05T10:00:00Z',
    ...overrides,
  });

  it('maps commits for the merge rule', () => {
    expect(toPullRequestCommit(commit('x', { author: 'someone', verified: false }))).toEqual({
      sha: SHA_B,
      parents: [SHA_A],
      message: 'x',
      authorIsBot: false,
      signatureVerified: false,
    });
  });

  it('reads approval commits, a missing run and a merge commit as invalid, and rethrows other errors', async () => {
    const github = new FakeGitHubClient();
    expect(await approvalCommitOf(commit('no trailer'), github, 7)).toBeNull();
    const trailer = `Lectio-Approval: human run=55 head=${SHA_A}`;
    expect(await approvalCommitOf(commit(trailer, { parents: [SHA_A, SHA_B] }), github, 7)).toMatchObject({
      parentSha: `${SHA_A},${SHA_B}`,
      run: { workflow: '(no such run)', prNumber: 0 },
    });
    const broken = { getWorkflowRun: () => Promise.reject(new ProviderError('timeout', 'slow')) };
    await expect(approvalCommitOf(commit(trailer), broken as unknown as GitHubClient, 7)).rejects.toThrow('slow');
  });
});

describe('target', () => {
  const github = newRepo();
  const prEvent = (action: string, headRepo = 'nyabongo/lectio') => ({
    action,
    pull_request: {
      number: 7,
      head: { sha: github.headOf('main'), ref: 'research/x', repo: { full_name: headRepo } },
      base: { sha: SHA_A, ref: 'main', repo: { full_name: 'nyabongo/lectio' } },
    },
  });

  it('reads pull_request events: verifiers only on a new head', async () => {
    expect(await resolveTarget('pull_request', prEvent('opened'), github, CONFIG)).toEqual({
      run: true,
      reason: 'pull_request opened on #7',
      prNumber: 7,
      headSha: github.headOf('main'),
      headRef: 'research/x',
      base: SHA_A,
      baseRef: 'main',
      fork: false,
      verifiers: true,
      approvalHead: false,
    });
    expect(await resolveTarget('pull_request', prEvent('labeled', 'someone/lectio'), github, CONFIG)).toMatchObject({
      fork: true,
      verifiers: false,
    });
    await expect(resolveTarget('pull_request', { pull_request: {} }, github, CONFIG)).rejects.toThrow(
      /without a PR number/,
    );
  });

  it('reads /approve comments and dispatches from the PR, and skips everything else', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER);
    const comment = (body: string) => ({ issue: { number, pull_request: {} }, comment: { body } });
    expect(await resolveTarget('issue_comment', comment('/approve'), bot, CONFIG)).toMatchObject({
      run: true,
      prNumber: number,
      base: 'origin/main',
      verifiers: false,
    });
    expect(await resolveTarget('issue_comment', comment('nice'), bot, CONFIG)).toMatchObject({ run: false });
    expect(
      await resolveTarget('issue_comment', { issue: { number }, comment: { body: '/approve' } }, bot, CONFIG),
    ).toMatchObject({ run: false, reason: 'a comment on an issue, not a PR' });
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: String(number) } }, bot, CONFIG)).toMatchObject({
      run: true,
      verifiers: true,
      approvalHead: false,
    });
    expect(await resolveTarget('push', {}, bot, CONFIG)).toMatchObject({ run: false });
    await expect(resolveTarget('workflow_dispatch', { inputs: { pr: 'x' } }, bot, CONFIG)).rejects.toThrow(
      /valid PR number/,
    );
    await expect(resolveTarget('workflow_dispatch', null, bot, CONFIG)).rejects.toThrow(/valid PR number/);

    await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: number } }, bot, CONFIG)).toMatchObject({
      approvalHead: true,
      verifiers: false,
    });
    await bot.closePr(number);
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: number } }, bot, CONFIG)).toMatchObject({
      run: false,
      reason: `#${String(number)} is closed`,
    });
  });

  it('keeps only paths under passages/, calendar/, corpus/ and config/', () => {
    expect(
      relevantFiles([
        'docs/a.md',
        'passages/x.json',
        './calendar/2026.json',
        'corpus/x',
        'config/c.json',
        'packages/a.ts',
      ]),
    ).toEqual(['passages/x.json', './calendar/2026.json', 'corpus/x', 'config/c.json']);
  });
});

describe('approval commit', () => {
  it('keeps writes in memory and refuses unknown files', () => {
    const fs = memoryReviewFs((path) => (path === 'a' ? 'A' : null));
    expect(fs.readFile('a')).toBe('A');
    expect(() => fs.readFile('b')).toThrow(/no such file/);
    fs.writeFile('a.tmp', 'B');
    fs.rename('a.tmp', 'a');
    expect(fs.readFile('a')).toBe('B');
    expect(() => fs.rename('x.tmp', 'x')).toThrow(/nothing to rename/);
    fs.writeFile('c.tmp', 'C');
    fs.remove('c.tmp');
    expect(() => fs.rename('c.tmp', 'c')).toThrow(/nothing to rename/);
    expect([...fs.written]).toEqual([['a', 'B']]);
  });

  it('formats with the tooling checkout’s Prettier config', async () => {
    expect(await toolPrettierJson(REPO_ROOT)({ a: [1, 2] }, PASSAGE)).toBe('{\n  "a": [1, 2]\n}\n');
  });

  it('lists approvable passages and reads verifier summaries defensively', () => {
    expect(
      approvedPassages([
        { path: 'passages/b.json', status: 'modified' },
        { path: 'passages/a.json', status: 'added' },
        { path: 'passages/i18n/sw/MT.20.1-16.json', status: 'added' },
        { path: 'passages/c.json', status: 'deleted' },
        { path: 'docs/x.md', status: 'added' },
      ]),
    ).toEqual(['passages/a.json', 'passages/b.json', 'passages/i18n/sw/MT.20.1-16.json']);
    const verifiers = (meta: Record<string, unknown>): GateResult[] => [
      { gate: 'verifiers', status: 'pass', items: [], meta },
    ];
    expect(verifierSummaryFor([], PASSAGE)).toBeNull();
    expect(verifierSummaryFor(verifiers({ files: null }), PASSAGE)).toBeNull();
    expect(verifierSummaryFor(verifiers({ files: {} }), PASSAGE)).toBeNull();
    expect(verifierSummaryFor(verifiers({ files: { [PASSAGE]: { verifierSummary: 1 } } }), PASSAGE)).toBeNull();
    expect(approvalMessage('auto', 7, '9', SHA_A)).toBe(
      `Record auto-merge approval for #7\n\nLectio-Approval: auto run=9 head=${SHA_A}\n`,
    );
  });

  async function setup(files: Record<string, string | null>) {
    const bot = newRepo({ 'README.md': '# Lectio\n', 'docs/old.md': 'old\n' });
    const number = await openPr(bot, REVIEWER, files);
    const checkout = await fakeCheckout(bot, number);
    const pr = await bot.getPr(number);
    const input = {
      github: bot,
      config: CONFIG,
      checkout,
      changedFiles: checkout.changedFiles('main', pr.headSha),
      prNumber: number,
      branch: pr.head,
      headSha: pr.headSha,
      runId: '77',
      format: plainJson,
    };
    return { bot, pr, input };
  }

  it('records the approval on a PR without passages by rewriting a changed file unchanged', async () => {
    const { bot, pr, input } = await setup({ 'calendar/2026.json': '{}\n' });
    const { commit, reviewed } = await writeApprovalCommit({
      ...input,
      write: { kind: 'auto', results: AUTO_RESULTS, now: new Date() },
    });
    expect(reviewed).toEqual([]);
    expect(commit.parents).toEqual([pr.headSha]);
    expect(bot.fileAt(commit.sha, 'calendar/2026.json')).toBe('{}\n');
  });

  it('refuses when nothing is left to sit on, or an auto approval has no verifier summary', async () => {
    const { input } = await setup({ 'docs/old.md': null });
    await expect(
      writeApprovalCommit({ ...input, write: { kind: 'auto', results: [], now: new Date() } }),
    ).rejects.toBeInstanceOf(ApprovalCommitError);
    const passage = await setup({ [PASSAGE]: PASSAGE_TEXT });
    await expect(
      writeApprovalCommit({ ...passage.input, write: { kind: 'auto', results: DETERMINISTIC_PASS, now: new Date() } }),
    ).rejects.toThrow(`${PASSAGE} has no verifierSummary from live verifiers`);
  });
});

describe('merge job', () => {
  it('refuses closed, fork and moved PRs and failed checks; notices a missing deploy.yml', async () => {
    const bot = newRepo();
    const logs: string[] = [];
    const log = (line: string): void => {
      logs.push(line);
    };
    const number = await openPr(bot, 'research-bot');
    const head = bot.headOf('research/mt-20');
    expect(await runMergeJob({ github: bot, prNumber: number, sha: SHA_A, log })).toMatchObject({ merged: false });
    expect(logs.at(-1)).toContain('not the approval commit');

    for (const check of REGISTRY.checks) bot.setCheck(head, check, check === 'lint' ? 'failure' : 'success');
    expect(await runMergeJob({ github: bot, prNumber: number, sha: head, log, timeoutMs: 1 })).toMatchObject({
      merged: false,
      exitCode: 1,
    });
    expect(logs.at(-1)).toBe(`merge: not merging: required checks failed on ${head}: lint`);

    bot.setCheck(head, 'lint', 'success');
    const noDeploy = new FakeGitHubClient({ actor: ACTIONS_BOT });
    const merged = await runMergeJob({
      github: override(bot, { dispatchWorkflow: (file: string, ref: string) => noDeploy.dispatchWorkflow(file, ref) }),
      prNumber: number,
      sha: head,
      log,
    });
    expect(merged).toMatchObject({ merged: true, exitCode: 0, deployed: false });
    expect(logs.at(-1)).toBe(`::notice::${DEPLOY_WORKFLOW} does not exist yet (L-062); nothing to deploy`);
    expect(await runMergeJob({ github: bot, prNumber: number, sha: head, log })).toMatchObject({ merged: false });
    expect(logs.at(-1)).toContain('is merged');

    const forkBot = newRepo();
    await forkBot.as('someone').createBranch({ name: 'fork-branch' });
    const fork = await forkBot
      .as('someone')
      .openForkPr({ head: 'fork-branch', title: 't', body: '', headRepo: 'someone/lectio' });
    expect(await runMergeJob({ github: forkBot, prNumber: fork.number, sha: fork.headSha, log })).toMatchObject({
      merged: false,
    });
    expect(logs.at(-1)).toContain('fork PR');
  });

  it('refuses a PR that renames a file out of .github/', async () => {
    const bot = newRepo({ '.github/x.yml': 'on: push\n' });
    const number = await openPr(bot, 'research-bot', { '.github/x.yml': null, 'docs/x.yml': 'on: push\n' });
    const head = bot.headOf('research/mt-20');
    expect((await bot.getPrFiles(number))[0]).toMatchObject({ status: 'renamed', previousPath: '.github/x.yml' });
    expect(await runMergeJob({ github: bot, prNumber: number, sha: head, log: quiet })).toMatchObject({
      merged: false,
    });
  });

  it('rethrows a deploy dispatch failure that is not a missing workflow', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const head = bot.headOf('research/mt-20');
    for (const check of REGISTRY.checks) bot.setCheck(head, check, 'success');
    const failing = override(bot, {
      dispatchWorkflow: () => Promise.reject(new ProviderError('rate-limited', 'slow down')),
    });
    await expect(runMergeJob({ github: failing, prNumber: number, sha: head, log: quiet })).rejects.toThrow(
      'slow down',
    );
  });
});

describe('merge-rule job', () => {
  it('maps decisions to exactly one label', () => {
    expect(labelFor('blocked', false)).toBe('gates-failed');
    expect(labelFor('needs-review', false)).toBe('needs-review');
    expect(labelFor('auto-merge', true)).toBe('needs-review');
    expect(labelFor('approved-commit', false)).toBe('auto-merge-candidate');
    expect(labelFor('human-approved', false)).toBe('auto-merge-candidate');
  });

  it('renders the gates and the decision in one comment', () => {
    const text = renderDecisionComment(
      DETERMINISTIC_PASS,
      { decision: 'needs-review', reasons: ['a\nb'] },
      ['note'],
      SHA_A,
    );
    expect(text).toMatch(/^<!-- lectio-gates -->\n## Lectio gates/);
    expect(text).toContain('### Merge rule: `needs-review` (waiting for human review)\n\n- a b\n- note\n');
  });

  async function input(bot: FakeGitHubClient, number: number, overrides: Partial<MergeRuleJobInput> = {}) {
    const pr = await bot.getPr(number);
    return {
      github: bot,
      config: CONFIG,
      checkout: await fakeCheckout(bot, number),
      registry: REGISTRY,
      prNumber: number,
      headSha: pr.headSha,
      base: 'main',
      runId: '5',
      results: AUTO_RESULTS,
      format: plainJson,
      now: () => new Date('2026-10-05T12:00:00Z'),
      log: quiet,
      ...overrides,
    } satisfies MergeRuleJobInput;
  }

  it('does nothing for a closed PR or a head that moved', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    expect(await runMergeRuleJob(await input(bot, number, { headSha: SHA_A }))).toMatchObject({
      decision: null,
      exitCode: 0,
    });
    await bot.closePr(number);
    expect((await runMergeRuleJob(await input(bot, number))).summary).toContain('is closed');
  });

  it('reports a fork PR in the summary only and ends red', async () => {
    const bot = newRepo();
    const person = bot.as('someone');
    await person.createBranch({ name: 'fork-branch' });
    await person.pushCommit({ branch: 'fork-branch', message: 'x', files: [{ path: PASSAGE, content: PASSAGE_TEXT }] });
    const fork = await person.openForkPr({ head: 'fork-branch', title: 't', body: '', headRepo: 'someone/lectio' });
    const outcome = await runMergeRuleJob(await input(bot, fork.number, { note: 'offline' }));
    expect(outcome).toMatchObject({ decision: 'needs-review', exitCode: 1, dispatched: [] });
    expect(outcome.summary).toContain('fork PR: report only');
    expect(outcome.summary).toContain('- offline');
    expect((await bot.getPr(fork.number)).labels).toEqual([]);
    expect(await bot.listComments(fork.number)).toEqual([]);
  });

  it('ends red when a dispatch fails or the head moved before the commit, and rethrows unknown errors', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    const registry = { ...REGISTRY, workflows: [...REGISTRY.workflows, 'missing.yml'] };
    const outcome = await runMergeRuleJob(await input(bot, number, { registry }));
    expect(outcome).toMatchObject({ decision: 'auto-merge', exitCode: 1 });
    expect(outcome.summary).toContain('could not dispatch missing.yml');

    const second = newRepo();
    const other = await openPr(second, 'research-bot');
    await simulateRun(second, other, { event: 'pull_request', results: DETERMINISTIC_PASS });
    const moved = override(second, {
      commitFiles: () => Promise.reject(new ProviderError('conflict', 'head moved')),
    });
    const conflict = await runMergeRuleJob(await input(second, other, { github: moved }));
    expect(conflict).toMatchObject({ decision: 'auto-merge', exitCode: 1, dispatched: [] });
    expect(conflict.summary).toContain('no approval commit: head moved');

    const broken = override(second, { commitFiles: () => Promise.reject(new TypeError('bug')) });
    await expect(runMergeRuleJob(await input(second, other, { github: broken }))).rejects.toThrow('bug');
  });

  it('approves a PR without passages with an approval commit that reviews nothing', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER, { 'calendar/2026.json': '{}\n' });
    await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    await bot.as(REVIEWER).addLabels(number, ['approved']);
    const outcome = await runMergeRuleJob(await input(bot, number, { results: DETERMINISTIC_PASS }));
    expect(outcome.decision).toBe('human-approved');
    expect(outcome.summary).toContain(`approval commit ${outcome.approvalCommitSha ?? ''}; dispatching`);
  });

  it('ignores a bot-signed approval commit below the head that is not valid', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    const parent = bot.headOf('research/mt-20');
    await bot.pushCommit({
      branch: 'research/mt-20',
      message: `x\n\nLectio-Approval: human run=999 head=${parent}\n`,
      files: [{ path: 'passages/notes.txt', content: 'x' }],
      verified: true,
    });
    await bot.as('research-bot').pushCommit({
      branch: 'research/mt-20',
      message: 'more',
      files: [{ path: 'passages/notes.txt', content: 'y' }],
    });
    await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    const outcome = await runMergeRuleJob(await input(bot, number, { results: DETERMINISTIC_PASS }));
    expect(outcome.decision).toBe('needs-review');
  });
});
