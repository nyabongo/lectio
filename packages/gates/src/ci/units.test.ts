import { describe, expect, it } from 'vitest';

import type { LectioConfig } from '@lectio/config';
import { AnthropicLlmClient } from '@lectio/provider-anthropic';
import { LiveSourceFetcher } from '@lectio/provider-fetch';
import { OpenAiLlmClient } from '@lectio/provider-openai';
import { FakeGitHubClient, ProviderError } from '@lectio/providers';
import type { GitCommit, GitHubClient, IssueComment, IssueEvent, WorkflowRun } from '@lectio/providers';

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
  approvalArtifactName,
  runPrNumber,
  runsMainCopy,
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
  REQUIRED_CHECKS,
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
  it('reads every workflow and check of the real registry, content-checks included', () => {
    expect(REGISTRY.workflows).toContain('content-checks.yml');
    // The trusted workflow publishes merge-rule through the Checks API: it is not a registered job.
    expect(REGISTRY.workflows).not.toContain('content-gates.yml');
    expect(REGISTRY.checks).toEqual(expect.arrayContaining(['changes', 'deterministic']));
    expect(REGISTRY.checks).not.toContain('merge-rule');
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

  it('reads regular-file blobs at the head only, never a symbolic link or submodule', () => {
    const calls: string[][] = [];
    const exec = (args: readonly string[]): string => {
      calls.push([...args]);
      if (args[0] === 'diff' && args[1] === '--raw')
        return `:000000 120000 ${'0'.repeat(40)} ${SHA_A} A\0calendar/2026.json\0`;
      if (args[0] === 'diff') return `A\0${PASSAGE}\0A\0calendar/2026.json\0`;
      if (args[0] === 'ls-tree')
        return args[3] === PASSAGE
          ? `100644 blob ${SHA_B}\t${PASSAGE}\n`
          : `120000 blob ${SHA_A}\tcalendar/2026.json\n`;
      if (args[0] === 'cat-file') return '{"blob":true}';
      return `${SHA_A} ${SHA_B}\n`;
    };
    const checkout = gitCheckout(REPO_ROOT, SHA_A, exec);
    expect(checkout.changedFiles('origin/main', SHA_A)).toEqual([
      { path: 'calendar/2026.json', status: 'added' },
      { path: PASSAGE, status: 'added' },
    ]);
    expect(checkout.nonRegular('origin/main', SHA_A)).toEqual(['calendar/2026.json']);
    expect(checkout.readFile(PASSAGE)).toBe('{"blob":true}');
    expect(calls.at(-2)).toEqual(['ls-tree', SHA_A, '--', PASSAGE]);
    expect(calls.at(-1)).toEqual(['cat-file', 'blob', SHA_B]);
    // A symlink to /proc/self/environ reads as absent: its target is never read.
    expect(checkout.readFile('calendar/2026.json')).toBeNull();
    expect(calls.at(-1)).toEqual(['ls-tree', SHA_A, '--', 'calendar/2026.json']);
    expect(checkout.show('origin/main', PASSAGE)).toBe('{"blob":true}');
    expect(checkout.revList('origin/main', SHA_A)).toEqual([{ sha: SHA_A, parents: [SHA_B] }]);
    expect(calls.at(-1)).toEqual(['rev-list', '--parents', `origin/main..${SHA_A}`]);
  });
});

describe('facts', () => {
  const run = (overrides: Partial<WorkflowRun>): WorkflowRun => ({
    id: 77,
    workflowFile: 'content-gates.yml',
    event: 'workflow_run',
    headSha: SHA_B,
    headBranch: 'main',
    prNumbers: [],
    status: 'completed',
    conclusion: 'success',
    actor: 'x',
    displayTitle: '',
    createdAt: '2026-10-05T10:00:00Z',
    ...overrides,
  });

  it('trusts only runs of main’s copy', () => {
    expect(runsMainCopy(run({}), 'main')).toBe(true);
    expect(runsMainCopy(run({ event: 'issue_comment' }), 'main')).toBe(true);
    expect(runsMainCopy(run({ event: 'workflow_dispatch' }), 'main')).toBe(true);
    expect(runsMainCopy(run({ event: 'workflow_dispatch', headBranch: 'feature' }), 'main')).toBe(false);
    expect(runsMainCopy(run({ event: 'pull_request', prNumbers: [7] }), 'main')).toBe(false);
  });

  it('ties a run to a PR only through its approval artifact, never its title or PR list', async () => {
    const artifacts = (names: string[]) =>
      ({ listRunArtifacts: () => Promise.resolve(names) }) as unknown as GitHubClient;
    const named = artifacts([approvalArtifactName(7, SHA_A)]);
    expect(await runPrNumber(run({}), named, 7, SHA_A, 'main')).toBe(7);
    expect(await runPrNumber(run({}), named, 8, SHA_A, 'main')).toBe(0);
    expect(await runPrNumber(run({}), named, 7, SHA_B, 'main')).toBe(0);
    expect(await runPrNumber(run({ displayTitle: 'Content gates · PR #7' }), artifacts([]), 7, SHA_A, 'main')).toBe(0);
    expect(await runPrNumber(run({ event: 'pull_request', prNumbers: [7] }), named, 7, SHA_A, 'main')).toBe(0);
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
    expect(pickApproval([event(REVIEWER, t3)], [comment(REVIEWER, t1)], ['approved'], CONFIG)).toMatchObject({
      via: 'label',
      at: t3,
    });
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
    expect(await approvalCommitOf(commit('no trailer'), github, 7, 'main')).toBeNull();
    const trailer = `Lectio-Approval: human run=55 head=${SHA_A}`;
    expect(await approvalCommitOf(commit(trailer, { parents: [SHA_A, SHA_B] }), github, 7, 'main')).toMatchObject({
      parentSha: `${SHA_A},${SHA_B}`,
      run: { workflow: '(no such run)', prNumber: 0 },
    });
    const broken = { getWorkflowRun: () => Promise.reject(new ProviderError('timeout', 'slow')) };
    await expect(approvalCommitOf(commit(trailer), broken as unknown as GitHubClient, 7, 'main')).rejects.toThrow(
      'slow',
    );
  });
});

describe('target', () => {
  const context = (github: GitHubClient, onDefaultBranch = true) => ({ github, config: CONFIG, onDefaultBranch });
  const runEvent = (headSha: string, pullRequests?: unknown[], event = 'pull_request') => ({
    workflow_run: { head_sha: headSha, event, ...(pullRequests === undefined ? {} : { pull_requests: pullRequests }) },
  });

  it('resolves a workflow_run from the PRs GitHub lists, else by head sha, and only while that is the head', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER);
    const head = bot.headOf('research/mt-20');
    expect(await resolveTarget('workflow_run', runEvent(head, [{ number }]), context(bot))).toEqual({
      run: true,
      reason: `workflow_run (pull_request) on #${String(number)} at ${head}`,
      prNumber: number,
      headSha: head,
      base: 'origin/main',
      baseRef: 'main',
      fork: false,
      verifiers: true,
      approvalHead: false,
    });
    // A fork PR or a dispatched run lists no PR: found by head sha. No verifiers off a pull_request run.
    expect(await resolveTarget('workflow_run', runEvent(head, [], 'workflow_dispatch'), context(bot))).toMatchObject({
      prNumber: number,
      verifiers: false,
    });
    expect(await resolveTarget('workflow_run', runEvent(head), context(bot))).toMatchObject({ prNumber: number });
    // A label brings no content: the verifiers are not run again.
    const labeled = {
      workflow_run: { ...runEvent(head, [{ number }]).workflow_run, display_title: 'Content checks (labeled)' },
    };
    expect(await resolveTarget('workflow_run', labeled, context(bot))).toMatchObject({ run: true, verifiers: false });
    // The head moved on, or the listed PR is not at this head: nothing to do here.
    expect(
      await resolveTarget('workflow_run', runEvent(SHA_A, [{ number }, { number: 'x' }]), context(bot)),
    ).toMatchObject({
      run: false,
      reason: `no open PR has head ${SHA_A} any more; a newer run decides`,
    });
    expect(await resolveTarget('workflow_run', null, context(bot))).toMatchObject({ run: false });
  });

  it('never runs the verifiers for a fork PR', async () => {
    const bot = newRepo();
    const person = bot.as('someone');
    await person.createBranch({ name: 'fork-branch' });
    await person.pushCommit({ branch: 'fork-branch', message: 'x', files: [{ path: PASSAGE, content: PASSAGE_TEXT }] });
    const fork = await person.openForkPr({ head: 'fork-branch', title: 't', body: '', headRepo: 'someone/lectio' });
    expect(await resolveTarget('workflow_run', runEvent(fork.headSha, []), context(bot))).toMatchObject({
      fork: true,
      verifiers: false,
    });
  });

  it('reads /approve comments and dispatches on main from the PR, and skips everything else', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER);
    const comment = (body: string) => ({ issue: { number, pull_request: {} }, comment: { body } });
    expect(await resolveTarget('issue_comment', comment('/approve'), context(bot))).toMatchObject({
      run: true,
      prNumber: number,
      base: 'origin/main',
      verifiers: false,
    });
    expect(await resolveTarget('issue_comment', comment('nice'), context(bot))).toMatchObject({ run: false });
    expect(
      await resolveTarget('issue_comment', { issue: { number }, comment: { body: '/approve' } }, context(bot)),
    ).toMatchObject({ run: false, reason: 'a comment on an issue, not a PR' });
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: String(number) } }, context(bot))).toMatchObject({
      run: true,
      verifiers: true,
      approvalHead: false,
    });
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: number } }, context(bot, false))).toMatchObject({
      run: false,
      reason: 'a dispatch off the default branch runs nothing (not main’s copy)',
    });
    expect(await resolveTarget('push', {}, context(bot))).toMatchObject({ run: false });
    await expect(resolveTarget('workflow_dispatch', { inputs: { pr: 'x' } }, context(bot))).rejects.toThrow(
      /valid PR number/,
    );
    await expect(resolveTarget('workflow_dispatch', null, context(bot))).rejects.toThrow(/valid PR number/);

    await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: number } }, context(bot))).toMatchObject({
      approvalHead: true,
      verifiers: false,
    });
    await bot.closePr(number);
    expect(await resolveTarget('workflow_dispatch', { inputs: { pr: number } }, context(bot))).toMatchObject({
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

  it('records the approval on a PR without passages with a commit that changes no file', async () => {
    const { bot, pr, input } = await setup({ 'calendar/2026.json': '{}\n' });
    const { commit, reviewed } = await writeApprovalCommit({
      ...input,
      write: { kind: 'auto', results: AUTO_RESULTS, now: new Date() },
    });
    expect(reviewed).toEqual([]);
    expect(commit.parents).toEqual([pr.headSha]);
    expect(await bot.getPrFiles(input.prNumber)).toEqual([{ path: 'calendar/2026.json', status: 'added' }]);
    expect(bot.fileAt(commit.sha, 'calendar/2026.json')).toBe('{}\n');
  });

  it('refuses an auto approval without a verifier summary', async () => {
    const passage = await setup({ [PASSAGE]: PASSAGE_TEXT });
    await expect(
      writeApprovalCommit({ ...passage.input, write: { kind: 'auto', results: DETERMINISTIC_PASS, now: new Date() } }),
    ).rejects.toThrow(`${PASSAGE} has no verifierSummary from live verifiers`);
    await expect(
      writeApprovalCommit({ ...passage.input, write: { kind: 'auto', results: [], now: new Date() } }),
    ).rejects.toBeInstanceOf(ApprovalCommitError);
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

    for (const check of REQUIRED_CHECKS) bot.setCheck(head, check, check === 'lint' ? 'failure' : 'success');
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
    expect(logs.at(-1)).toContain('is already merged');
    const closedBot = newRepo();
    const closed = await openPr(closedBot, 'research-bot');
    await closedBot.closePr(closed);
    expect(await runMergeJob({ github: closedBot, prNumber: closed, sha: SHA_A, log })).toMatchObject({ exitCode: 1 });
    expect(logs.at(-1)).toBe(`merge: not merging: #${String(closed)} is closed`);

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
    for (const check of REQUIRED_CHECKS) bot.setCheck(head, check, 'success');
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
    const place = { results: DETERMINISTIC_PASS, head: SHA_A, base: SHA_B, changedFiles: [PASSAGE] };
    const text = renderDecisionComment(place, { decision: 'needs-review', reasons: ['a\nb'] }, ['note']);
    expect(text).toMatch(/^<!-- lectio-gates -->\n## Lectio gates/);
    expect(text).toContain('| Schema tests (`schema`) | Pass | no findings |');
    expect(text).toContain(`Base \`${SHA_B}\` · head \`${SHA_A}\` · 1 changed file`);
    expect(text).toContain('### Merge rule: `needs-review` (waiting for human review)\n\n- a b\n- note\n');
  });

  async function input(bot: FakeGitHubClient, number: number, overrides: Partial<MergeRuleJobInput> = {}) {
    const pr = await bot.getPr(number);
    const base: MergeRuleJobInput = {
      phase: 'decide',
      github: bot,
      config: CONFIG,
      checkout: await fakeCheckout(bot, number),
      registry: REGISTRY,
      prNumber: number,
      headSha: pr.headSha,
      base: 'main',
      defaultBranch: 'main',
      runId: '5',
      results: AUTO_RESULTS,
      format: plainJson,
      now: () => new Date('2026-10-05T12:00:00Z'),
      log: quiet,
    };
    return { ...base, ...overrides };
  }

  it('does nothing for a closed PR or a head that moved', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    expect(await runMergeRuleJob(await input(bot, number, { headSha: SHA_A }))).toMatchObject({
      decision: null,
      exitCode: 0,
      write: false,
    });
    await bot.closePr(number);
    expect((await runMergeRuleJob(await input(bot, number))).summary).toContain('is closed');
    expect(bot.publishedChecks).toEqual([]);
  });

  it('reports a fork PR as a red check and the summary only', async () => {
    const bot = newRepo();
    const person = bot.as('someone');
    await person.createBranch({ name: 'fork-branch' });
    await person.pushCommit({ branch: 'fork-branch', message: 'x', files: [{ path: PASSAGE, content: PASSAGE_TEXT }] });
    const fork = await person.openForkPr({ head: 'fork-branch', title: 't', body: '', headRepo: 'someone/lectio' });
    const outcome = await runMergeRuleJob(await input(bot, fork.number, { note: 'offline' }));
    expect(outcome).toMatchObject({ decision: 'needs-review', exitCode: 1, write: false, dispatched: [] });
    expect(outcome.summary).toContain('fork PR: report only');
    expect(outcome.summary).toContain('- offline');
    expect(bot.publishedChecks).toEqual([expect.objectContaining({ headSha: fork.headSha, conclusion: 'failure' })]);
    expect((await bot.getPr(fork.number)).labels).toEqual([]);
    expect(await bot.listComments(fork.number)).toEqual([]);
  });

  it('commits only in phase approve, names the artifact after the commit, and dispatches only in phase dispatch', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const head = bot.headOf('research/mt-20');
    await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    const decided = await runMergeRuleJob(await input(bot, number));
    expect(decided).toMatchObject({ decision: 'auto-merge', exitCode: 0, write: true });
    expect(decided.approvalArtifact).toBeUndefined();
    expect(bot.headOf('research/mt-20')).toBe(head);
    expect(bot.publishedChecks.filter((check) => check.headSha === head && check.conclusion === 'success')).toEqual([]);

    // The decision changed before phase approve: no commit, red check.
    const changed = await runMergeRuleJob(await input(bot, number, { phase: 'approve', results: DETERMINISTIC_PASS }));
    expect(changed).toMatchObject({ decision: 'needs-review', exitCode: 1, write: false });
    expect(changed.summary).toContain('no approval commit: the decision changed');
    expect(bot.headOf('research/mt-20')).toBe(head);

    const approved = await runMergeRuleJob(await input(bot, number, { phase: 'approve' }));
    const commit = bot.headOf('research/mt-20');
    expect(approved).toMatchObject({ exitCode: 0, approvalCommitSha: commit, dispatched: [] });
    expect(approved.approvalArtifact).toBe(`lectio-approval-pr${String(number)}-${commit}`);
    expect(bot.dispatches).toEqual([]);

    // Phase dispatch, with one workflow that cannot be dispatched: red, the others still go.
    const registry = { ...REGISTRY, workflows: [...REGISTRY.workflows, 'missing.yml'] };
    const dispatch = { phase: 'dispatch' as const, approvalCommitSha: commit, registry };
    const outcome = await runMergeRuleJob(await input(bot, number, { ...dispatch, headSha: head }));
    expect(outcome).toMatchObject({ exitCode: 1, approvalCommitSha: commit });
    expect(outcome.summary).toContain('could not dispatch missing.yml');
    expect(outcome.dispatched).toEqual([...REGISTRY.workflows, 'content-gates.yml']);
    expect(bot.publishedChecks.at(-1)).toMatchObject({ headSha: head, conclusion: 'failure' });

    // A head that moved off the approval commit dispatches nothing.
    await bot.as('research-bot').pushCommit({
      branch: 'research/mt-20',
      message: 'more',
      files: [{ path: 'passages/notes.txt', content: 'y' }],
    });
    const moved = await runMergeRuleJob(await input(bot, number, { ...dispatch, headSha: head }));
    expect(moved).toMatchObject({ exitCode: 1, dispatched: [] });
    expect(moved.summary).toContain(`not the approval commit ${commit}`);
    await expect(runMergeRuleJob(await input(bot, number, { phase: 'dispatch' }))).rejects.toThrow(
      'phase dispatch needs the approval commit sha',
    );
  });

  it('ends red when the head moved before the commit, and rethrows unknown errors', async () => {
    const second = newRepo();
    const other = await openPr(second, 'research-bot');
    await simulateRun(second, other, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    const moved = override(second, {
      commitFiles: () => Promise.reject(new ProviderError('conflict', 'head moved')),
    });
    const conflict = await runMergeRuleJob(await input(second, other, { github: moved, phase: 'approve' }));
    expect(conflict).toMatchObject({ decision: 'auto-merge', exitCode: 1, dispatched: [] });
    expect(conflict.summary).toContain('no approval commit: head moved');

    const broken = override(second, { commitFiles: () => Promise.reject(new TypeError('bug')) });
    await expect(runMergeRuleJob(await input(second, other, { github: broken, phase: 'approve' }))).rejects.toThrow(
      'bug',
    );
  });

  it('approves a PR without passages with an approval commit that only records the approval', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER, { 'calendar/2026.json': '{}\n' });
    await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    await bot.as(REVIEWER).addLabels(number, ['approved']);
    const outcome = await runMergeRuleJob(await input(bot, number, { results: DETERMINISTIC_PASS, phase: 'approve' }));
    expect(outcome.decision).toBe('human-approved');
    expect(outcome.summary).toContain(`approval commit ${outcome.approvalCommitSha ?? ''} records the approval`);
  });

  it('ignores a bot-signed approval commit below the head that is not valid', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
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
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    expect(outcome.mergeRule.decision).toBe('needs-review');
  });
});
