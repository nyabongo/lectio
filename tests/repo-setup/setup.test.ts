/**
 * scripts/repo/setup.sh (L-032) against a fake `gh` (fixtures/fake-gh.sh). Nothing here talks to
 * GitHub: the fake records every call and answers the two reads the script makes.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const script = join(repoRoot, 'scripts/repo/setup.sh');
const registry = join(repoRoot, '.github/required-checks');
const fakeGh = fileURLToPath(new URL('fixtures/fake-gh.sh', import.meta.url));
const extraRegistry = fileURLToPath(new URL('fixtures/extra-registry', import.meta.url));

interface Call {
  args: string[];
  stdin: string | null;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: Call[];
}

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'lectio-setup-'));
  mkdirSync(join(work, 'bin'));
  writeFileSync(join(work, 'bin/gh'), `#!/bin/sh\nexec bash ${JSON.stringify(fakeGh)} "$@"\n`, { mode: 0o755 });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}): Run {
  const log = join(work, 'gh.log');
  writeFileSync(log, '');
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_REPO: '',
      PATH: `${join(work, 'bin')}:${process.env['PATH'] ?? ''}`,
      FAKE_GH_LOG: log,
      ...env,
    },
  });
  // Records end in \x1d; arguments are \x1f-terminated; \x1e introduces the stdin (fixtures/fake-gh.sh).
  const calls = readFileSync(log, 'utf8')
    .split('\x1d')
    .filter((record) => record !== '')
    .map((record): Call => {
      const [argText = '', stdin] = record.split('\x1e');
      return { args: argText.split('\x1f').slice(0, -1), stdin: stdin ?? null };
    });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

/** The real registry's job names, read independently of the script. */
function registryChecks(dir = registry): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { jobs: string[] }).jobs);
}

function listedChecks(stdout: string): string[] {
  const start = stdout.indexOf('Required checks on main');
  const block = stdout.slice(start).split('\n\n')[0] ?? '';
  return block
    .split('\n')
    .filter((line) => line.startsWith('  - '))
    .map((line) => line.slice(4));
}

const isWrite = (call: Call) => call.args.includes('--method') || call.args[0] === 'label';

describe('setup.sh --dry-run', () => {
  it('prints the required checks from the registry plus merge-rule, sorted and unique', () => {
    const { status, stdout } = run(['--dry-run']);
    expect(status).toBe(0);
    const expected = [...new Set([...registryChecks(), 'merge-rule'])].sort();
    expect(listedChecks(stdout)).toEqual(expected);
    expect(listedChecks(stdout)).toEqual(expect.arrayContaining(['changes', 'deterministic', 'merge-rule']));
    expect(listedChecks(stdout)).not.toContain('merge');
    expect(stdout).toContain('Repository: nyabongo/lectio');
    expect(stdout).toContain('Dry run: nothing was changed.');
  });

  it('makes no writes, only the two reads', () => {
    const { calls } = run(['--dry-run']);
    expect(calls.filter(isWrite)).toEqual([]);
    expect(calls.map((call) => call.args)).toEqual([
      ['api', 'repos/nyabongo/lectio', '--jq', '.owner.type'],
      ['api', 'repos/nyabongo/lectio/pages', '--silent'],
    ]);
  });

  it('prints every API call with its body', () => {
    const { stdout } = run(['--dry-run']);
    expect(stdout).toContain('+ gh api --method PUT repos/nyabongo/lectio/branches/main/protection --input -');
    expect(stdout).toContain(
      '+ gh api --method PATCH repos/nyabongo/lectio -F allow_auto_merge=true -F delete_branch_on_merge=true',
    );
    expect(stdout).toContain('+ gh api --method PUT repos/nyabongo/lectio/pages -f build_type=workflow');
    expect(stdout).toContain('+ gh api --method PUT repos/nyabongo/lectio/environments/llm-verifiers --input -');
    expect(stdout).toContain('"protected_branches":true');
    for (const label of ['approved', 'ios-build', 'needs-review', 'auto-merge-candidate', 'type:infra', 'area:ci']) {
      expect(stdout).toContain(`+ gh label create ${label} --repo nyabongo/lectio`);
    }
    expect(stdout).toMatch(/"context": "merge-rule",\s+"app_id": 15368/);
  });

  it('changes the list when a registry file is added, with no script edit', () => {
    const dir = join(work, 'registry');
    mkdirSync(dir);
    for (const file of readdirSync(registry)) copyFileSync(join(registry, file), join(dir, file));
    const before = listedChecks(run(['--dry-run', '--registry', dir]).stdout);
    copyFileSync(join(extraRegistry, 'release.json'), join(dir, 'release.json'));
    const after = listedChecks(run(['--dry-run', '--registry', dir]).stdout);
    expect(after).toEqual([...new Set([...before, 'release-dry-run'])].sort());
    expect(after.filter((name) => name === 'lint')).toHaveLength(1);
  });

  it('targets --repo, then $GH_REPO', () => {
    expect(run(['--dry-run', '--repo', 'someone/fork']).stdout).toContain('Repository: someone/fork');
    expect(run(['--dry-run'], { GH_REPO: 'other/repo' }).calls[0]?.args[1]).toBe('repos/other/repo');
  });
});

describe('setup.sh (applying, against the fake gh)', () => {
  function protectionBody(calls: Call[]): Record<string, unknown> {
    const call = calls.find((c) => c.args.includes('repos/nyabongo/lectio/branches/main/protection'));
    return JSON.parse(call?.stdin ?? 'null') as Record<string, unknown>;
  }

  it('protects main with pinned checks, linear history, no force pushes and a required PR', () => {
    const { status, calls, stdout } = run([]);
    expect(status).toBe(0);
    expect(stdout).toContain('Done. Settings applied to nyabongo/lectio.');
    const body = protectionBody(calls);
    const checks = (
      body['required_status_checks'] as { strict: boolean; checks: { context: string; app_id: number }[] }
    ).checks;
    expect(checks.map((c) => c.context)).toEqual([...new Set([...registryChecks(), 'merge-rule'])].sort());
    expect(checks.every((c) => c.app_id === 15368)).toBe(true);
    expect(body).toMatchObject({
      required_linear_history: true,
      allow_force_pushes: false,
      allow_deletions: false,
      enforce_admins: false,
      restrictions: null,
      required_pull_request_reviews: { required_approving_review_count: 0, require_code_owner_reviews: false },
    });
  });

  it('restricts pushes to the owner and github-actions on an organization repo', () => {
    const body = protectionBody(run([], { FAKE_GH_OWNER_TYPE: 'Organization' }).calls);
    expect(body['restrictions']).toEqual({ users: ['nyabongo'], teams: [], apps: ['github-actions'] });
  });

  it('makes the same calls on a second run (idempotent writes only)', () => {
    const first = run([]).calls;
    const second = run([]).calls;
    expect(second).toEqual(first);
    for (const call of first.filter(isWrite)) {
      const method = call.args[call.args.indexOf('--method') + 1];
      expect(call.args[0] === 'label' ? call.args.at(-1) : method).toMatch(/^(PUT|PATCH|--force)$/);
    }
  });

  it('creates the labels with their colours and descriptions', () => {
    const labels = run([]).calls.filter((c) => c.args[0] === 'label');
    expect(labels).toHaveLength(33);
    expect(labels.map((c) => c.args[2])).toEqual(
      expect.arrayContaining([
        'needs-review',
        'research',
        'auto-merge-candidate',
        'approved',
        'gates-failed',
        'ios-build',
        'content-issue',
      ]),
    );
    expect(labels.find((c) => c.args[2] === 'ios-build')?.args).toEqual([
      'label',
      'create',
      'ios-build',
      '--repo',
      'nyabongo/lectio',
      '--color',
      'D4C5F9',
      '--description',
      'Runtime: run the macOS iOS no-codesign build on this PR',
      '--force',
    ]);
  });

  it('creates Pages with the Actions source when it does not exist yet', () => {
    const { status, calls } = run([], { FAKE_GH_PAGES: 'missing' });
    expect(status).toBe(0);
    expect(calls.map((c) => c.args)).toContainEqual([
      'api',
      '--method',
      'POST',
      'repos/nyabongo/lectio/pages',
      '-f',
      'build_type=workflow',
    ]);
  });

  it('stops when the Pages settings cannot be read', () => {
    const { status, stderr, calls } = run([], { FAKE_GH_PAGES: 'error' });
    expect(status).toBe(1);
    expect(stderr).toContain('could not read the Pages settings');
    expect(calls.some((c) => c.args.includes('environments/llm-verifiers'))).toBe(false);
  });
});

describe('setup.sh input checks', () => {
  it('prints its header for --help', () => {
    const { status, stdout } = run(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('--dry-run');
    expect(stdout).not.toContain('set -euo');
  });

  it.each([
    [['--bogus'], 'unknown argument: --bogus'],
    [['--repo'], '--repo needs OWNER/NAME'],
    [['--registry'], '--registry needs a directory'],
    [['--repo', 'no-slash'], "--repo must be OWNER/NAME, got 'no-slash'"],
    [['--registry', '/does/not/exist'], 'registry directory not found'],
  ])('rejects %j', (args, message) => {
    const { status, stderr, calls } = run(args);
    expect(status).toBe(1);
    expect(stderr).toContain(message);
    expect(calls).toEqual([]);
  });

  it.each([
    ['broken.json', '{ not json', 'broken.json: not valid JSON'],
    ['empty.json', '{ "workflow": "empty.yml", "jobs": [] }', 'empty.json: "jobs" must be a non-empty array'],
  ])('stops on a malformed registry file (%s) before calling gh', (file, source, message) => {
    const dir = join(work, 'bad');
    mkdirSync(dir);
    writeFileSync(join(dir, file), source);
    const { status, stderr, calls } = run(['--dry-run', '--registry', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain(message);
    expect(calls).toEqual([]);
  });

  it('stops when the registry lists no checks', () => {
    const dir = join(work, 'none');
    mkdirSync(dir);
    const { status, stderr } = run(['--dry-run', '--registry', dir]);
    expect(status).toBe(1);
    expect(stderr).toContain('no required checks found');
  });
});

describe('setup.sh lint', () => {
  const shellcheck = spawnSync('shellcheck', ['--version']).status === 0;
  // ubuntu-latest ships shellcheck, so CI always runs this; locally it is skipped when absent.
  it.runIf(shellcheck || process.env['CI'] === 'true')('is shellcheck clean (with the fake gh)', () => {
    const result = spawnSync('shellcheck', ['--severity=style', script, fakeGh], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
