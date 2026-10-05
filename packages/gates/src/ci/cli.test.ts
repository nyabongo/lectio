import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeGitHubClient } from '@lectio/providers';

import { APPROVAL_RECORD, CI_USAGE, REPORT_FILE, runCiCli } from './cli.ts';
import type { CiCliOptions } from './cli.ts';
import {
  AUTO_RESULTS,
  CONFIG,
  DETERMINISTIC_PASS,
  PASSAGE,
  REGISTRY,
  REPO_ROOT,
  fakeCheckout,
  newRepo,
  openPr,
  plainJson,
  simulateRun,
} from './fixtures/content-gates.ts';

let dir: string;
let logs: string[];
let errors: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lectio-gates-ci-'));
  logs = [];
  errors = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<CiCliOptions> = {}): CiCliOptions {
  return {
    cwd: dir,
    env: { GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary'), GITHUB_RUN_ID: '4242' },
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    config: CONFIG,
    registry: REGISTRY,
    format: plainJson,
    now: () => new Date('2026-10-05T12:00:00Z'),
    ...overrides,
  };
}

const read = (name: string): string => readFileSync(join(dir, name), 'utf8');

function writeJson(name: string, value: unknown): string {
  mkdirSync(join(dir, name, '..'), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value));
  return name;
}

describe('lectio-gates ci', () => {
  it('prints usage for a missing or unknown command and bad arguments', async () => {
    expect(await runCiCli([], options())).toBe(2);
    expect(errors).toEqual(['lectio-gates ci: missing ci command', CI_USAGE]);
    expect(await runCiCli(['resolve', '--x'], options())).toBe(2);
    expect(errors[2]).toMatch(/^lectio-gates ci: Unknown option '--x'/);
    expect(await runCiCli(['toString'], options())).toBe(2);
  });

  describe('resolve', () => {
    it('writes the target of a workflow_run to $GITHUB_OUTPUT', async () => {
      const github = newRepo();
      const number = await openPr(github, 'research-bot');
      const head = github.headOf('research/mt-20');
      const event = writeJson('event.json', {
        workflow_run: { head_sha: head, event: 'pull_request', pull_requests: [{ number }] },
      });
      const env = { ...options().env, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: join(dir, event) };
      expect(await runCiCli(['resolve'], options({ env, github }))).toBe(0);
      const reason = `workflow_run (pull_request) on #${String(number)} at ${head}`;
      expect(read('output').split('\n')).toEqual([
        'run=true',
        `reason=${reason}`,
        `pr=${String(number)}`,
        `head-sha=${head}`,
        'base=origin/main',
        'base-ref=main',
        'fork=false',
        'verifiers=true',
        'approval-head=false',
        '',
      ]);
      expect(logs[0]).toBe(`resolve: ${reason}`);
    });

    it('runs a dispatch only on the default branch', async () => {
      const github = newRepo();
      const number = await openPr(github, 'research-bot');
      const event = writeJson('event.json', { inputs: { pr: String(number) } });
      const base = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_PATH: join(dir, event) };
      await runCiCli(['resolve'], options({ env: { ...base, GITHUB_REF: 'refs/heads/attacker' }, github }));
      expect(logs).toContain('output run=false');
      await runCiCli(
        ['resolve'],
        options({ env: { ...base, GITHUB_REF: 'refs/heads/trunk', DEFAULT_BRANCH: 'trunk' }, github }),
      );
      expect(logs).toContain('output run=true');
    });

    it('needs the event, and builds provider-gh itself when no client is injected', async () => {
      expect(await runCiCli(['resolve'], options())).toBe(2);
      expect(errors[0]).toBe('lectio-gates ci: resolve needs GITHUB_EVENT_NAME and GITHUB_EVENT_PATH');
      const env = { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: 'event.json', GITHUB_REPOSITORY: 'nyabongo/lectio' };
      const code = await runCiCli(
        ['resolve'],
        options({ cwd: REPO_ROOT, env, registry: undefined, config: undefined, readFile: () => '{}' }),
      );
      expect(code).toBe(0);
      expect(logs).toContain('output run=false');
      const bare = await runCiCli(
        ['resolve'],
        options({ cwd: REPO_ROOT, env: { ...env, GITHUB_REPOSITORY: '' }, readFile: () => '{}' }),
      );
      expect(bare).toBe(0);
    });
  });

  describe('changes', () => {
    const checkout = (paths: string[], nonRegular: string[] = []) => ({
      changedFiles: () => paths.map((path) => ({ path, status: 'modified' as const })),
      nonRegular: () => nonRegular,
      show: () => null,
      revList: () => [],
      readFile: () => null,
    });

    it('exits green with relevant=false for a docs-only PR, so no gate runs', async () => {
      const args = ['changes', '--root', 'pr-head', '--base', 'origin/main'];
      expect(await runCiCli(args, options({ checkout: checkout(['docs/a.md', 'README.md']) }))).toBe(0);
      expect(read('output')).toBe('relevant=false\n');
      expect(read('summary')).toContain('Nothing relevant to the content gates changed');
    });

    it('fails for a changed symbolic link or submodule, before any gate reads the tree', async () => {
      const args = ['changes', '--root', 'pr-head', '--base', 'origin/main', '--head', 'a'.repeat(40)];
      const links = checkout(['calendar/2026.json', 'corpus/x'], ['calendar/2026.json', 'corpus/x']);
      expect(await runCiCli(args, options({ checkout: links }))).toBe(1);
      expect(errors[0]).toBe(
        '::error file=calendar/2026.json::calendar/2026.json is not a regular file (symbolic link or submodule)',
      );
      expect(read('summary')).toContain('Refused: calendar/2026.json, corpus/x are not regular files.');
      expect(read('output')).toBe('relevant=true\n');
      expect(await runCiCli(args, options({ checkout: checkout(['a'], ['a']) }))).toBe(1);
      expect(read('summary')).toContain('Refused: a is not a regular file.');
    });

    it('marks content changes relevant, from git by default', async () => {
      const gitExec = (gitArgs: readonly string[]): string =>
        gitArgs[0] === 'diff' ? `M\0${PASSAGE}\0M\0docs/a.md\0` : '';
      const env = {};
      expect(await runCiCli(['changes', '--root', 'pr-head', '--base', 'x'], options({ env, gitExec }))).toBe(0);
      expect(logs).toEqual([
        'changes: 2 changed, 1 relevant',
        '    docs/a.md',
        `  * ${PASSAGE}`,
        'output relevant=true',
      ]);
      expect(await runCiCli(['changes', '--base', 'x'], options())).toBe(2);
      expect(errors[0]).toBe('lectio-gates ci: --root is required');
    });
  });

  describe('merge-rule and merge', () => {
    async function prepared(): Promise<{ bot: FakeGitHubClient; number: number; head: string }> {
      const bot = newRepo();
      const number = await openPr(bot, 'research-bot');
      await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
      bot.addWorkflowRun({
        id: 4242,
        workflowFile: 'content-gates.yml',
        event: 'workflow_run',
        headSha: bot.headOf('main'),
        headBranch: 'main',
        prNumbers: [],
        status: 'in_progress',
        conclusion: null,
        actor: 'x',
      });
      return { bot, number, head: bot.headOf('research/mt-20') };
    }

    const reports = () => [
      '--results',
      writeJson('out/deterministic/gates.json', {
        results: AUTO_RESULTS.filter((r) => r.gate !== 'verifiers'),
        fetcher: 'offline-fake',
      }),
      '--results',
      writeJson('out/verifiers/gates.json', { results: AUTO_RESULTS.filter((r) => r.gate === 'verifiers') }),
      '--results',
      'out/missing/gates.json',
    ];

    it('decides, records the approval artifact, writes the approval commit; the run on it merges', async () => {
      const { bot, number, head } = await prepared();
      const checkout = await fakeCheckout(bot, number);
      const args = ['merge-rule', '--pr', String(number), '--head-sha', head, '--base', 'main', '--root', 'pr-head'];
      const run = (extra: string[]) =>
        runCiCli(
          [...args, ...extra, ...reports()],
          options({ github: bot, checkout, format: undefined, now: undefined }),
        );
      expect(await run([])).toBe(0);
      const artifact = `lectio-approval-pr${String(number)}-${head}`;
      expect(read('output')).toBe(
        `decision=auto-merge\nmanual-merge=false\nwrite=true\napproval-artifact=${artifact}\napproval-commit=\n`,
      );
      expect(JSON.parse(read(APPROVAL_RECORD))).toEqual({ pr: number, head, run: '4242', decision: 'auto-merge' });
      expect(JSON.parse(read(REPORT_FILE))).toMatchObject({
        reportVersion: 1,
        head,
        base: 'main',
        changedFiles: ['passages/MT.20.1-16.json'],
        decision: { decision: 'auto-merge' },
        results: AUTO_RESULTS,
      });
      expect(bot.headOf('research/mt-20')).toBe(head);

      bot.addRunArtifact(4242, artifact);
      expect(await run(['--phase', 'approve'])).toBe(0);
      const approval = bot.headOf('research/mt-20');
      expect(read('output')).toContain(`write=false\napproval-artifact=\napproval-commit=${approval}\n`);
      expect(read('summary')).toContain('the deterministic gates ran with the offline fake fetcher');
      expect(logs).toContain('merge-rule: out/missing/gates.json is missing (that job did not run)');

      for (const check of REGISTRY.checks) bot.setCheck(approval, check, 'success');
      expect(await runCiCli(['merge', '--pr', String(number), '--sha', approval], options({ github: bot }))).toBe(0);
      expect(bot.merges).toHaveLength(1);
      expect(await runCiCli(['merge-rule', ...args.slice(1), '--phase', 'later'], options())).toBe(2);
      expect(errors.at(-2)).toBe('lectio-gates ci: --phase must be decide or approve (got "later")');
    });

    it('publishes a green merge-rule check when nothing relevant changed', async () => {
      const bot = newRepo();
      const sha = bot.headOf('main');
      expect(await runCiCli(['skip', '--head-sha', sha, '--reason', 'docs only'], options({ github: bot }))).toBe(0);
      expect(bot.publishedChecks).toEqual([
        {
          name: 'merge-rule',
          headSha: sha,
          conclusion: 'success',
          title: 'nothing to decide',
          summary: 'docs only',
          actor: bot.actor,
        },
      ]);
      expect(await runCiCli(['skip', '--head-sha', sha], options({ github: bot }))).toBe(2);
    });

    it('reads injected report files and ends red while waiting for review', async () => {
      const { bot, number, head } = await prepared();
      const files: Record<string, string> = {
        [join(dir, 'g.json')]: JSON.stringify({ results: DETERMINISTIC_PASS }),
      };
      const readFile = (path: string): string => files[path] as string;
      const args = ['merge-rule', '--pr', String(number), '--head-sha', head, '--base', 'main', '--root', 'pr-head'];
      const code = await runCiCli(
        [...args, '--results', 'g.json'],
        options({ github: bot, checkout: await fakeCheckout(bot, number), readFile, env: { GITHUB_RUN_ID: '1' } }),
      );
      expect(code).toBe(1);
      expect(logs).toContain('output decision=needs-review');
    });

    it.each([
      [['--head-sha', 'a'.repeat(40), '--base', 'main', '--root', 'r'], '--pr is required'],
      [
        ['--pr', 'seven', '--head-sha', 'a'.repeat(40), '--base', 'main', '--root', 'r'],
        '--pr must be a PR number (got "seven")',
      ],
      [
        ['--pr', '7', '--head-sha', 'abc', '--base', 'main', '--root', 'r'],
        '--head-sha must be a full commit sha (got "abc")',
      ],
    ])('refuses bad arguments %#', async (args, message) => {
      expect(await runCiCli(['merge-rule', ...args], options())).toBe(2);
      expect(errors[0]).toBe(`lectio-gates ci: ${message}`);
    });

    it('reports nothing decided for a closed PR, and rethrows errors that are not usage errors', async () => {
      const { bot, number, head } = await prepared();
      await bot.closePr(number);
      const args = ['merge-rule', '--pr', String(number), '--head-sha', head, '--base', 'main', '--root', 'pr-head'];
      expect(await runCiCli(args, options({ github: bot }))).toBe(0);
      expect(read('output')).toContain('decision=none');
      const broken = { getPr: () => Promise.reject(new TypeError('boom')) } as unknown as FakeGitHubClient;
      await expect(runCiCli(['merge', '--pr', '1', '--sha', head], options({ github: broken }))).rejects.toThrow(
        'boom',
      );
    });

    it('refuses a run without GITHUB_RUN_ID and malformed reports', async () => {
      const base = ['merge-rule', '--pr', '7', '--head-sha', 'a'.repeat(40), '--base', 'main', '--root', 'r'];
      expect(await runCiCli(base, options({ env: {} }))).toBe(2);
      expect(errors[0]).toBe('lectio-gates ci: merge-rule needs GITHUB_RUN_ID');
      expect(await runCiCli([...base, '--results', writeJson('a.json', { nope: 1 })], options())).toBe(2);
      expect(errors[2]).toBe('lectio-gates ci: a.json: expected a gate report with "results"');
      expect(await runCiCli([...base, '--results', writeJson('b.json', { results: [{ gate: 1 }] })], options())).toBe(
        2,
      );
      expect(errors[4]).toBe('lectio-gates ci: b.json: results/0 is not a gate result');
      expect(await runCiCli([...base, '--results', writeJson('c.json', null)], options())).toBe(2);
    });
  });
});
