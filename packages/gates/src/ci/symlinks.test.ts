/**
 * A PR that adds `calendar/2026.json -> /proc/self/environ`: in a real git repository, the gates
 * refuse it before reading anything, the PR checkout never reads the target, and the worktree reader
 * throws instead of following the link. The environment it points to (where a job keeps its token)
 * never reaches a result, a comment or a commit.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';

import { runGatesCli } from '../cli/run.ts';
import { passingGate } from '../core/fixtures/dummy-gate.ts';
import { noFollowReadText, nodeNoFollowFs } from '../core/gate.ts';
import type { NoFollowFs } from '../core/gate.ts';
import { nodeGitExec, nonRegularFiles, parseNonRegular } from '../core/git.ts';
import { gitCheckout } from './checkout.ts';

const LINK = 'calendar/2026.json';
const SECRET = 'GH_TOKEN';

describe('parseNonRegular', () => {
  it('lists added or changed links and submodules, never deletions, following renames', () => {
    const zero = '0'.repeat(40);
    const sha = 'a'.repeat(40);
    const raw = [
      `:000000 120000 ${zero} ${sha} A`,
      'link',
      `:100644 100644 ${sha} ${sha} M`,
      'file',
      `:120000 000000 ${sha} ${zero} D`,
      'gone-link',
      `:100644 120000 ${sha} ${sha} R090`,
      'old',
      'renamed-link',
      `:000000 160000 ${zero} ${sha} A`,
      'module',
      `:100755 100755 ${sha} ${sha} C100`,
      'a',
      'b',
      '',
    ].join('\0');
    expect(parseNonRegular(raw)).toEqual(['link', 'module', 'renamed-link']);
    expect(parseNonRegular('')).toEqual([]);
    expect(parseNonRegular(':broken')).toEqual(['']);
  });
});

describe('noFollowReadText', () => {
  const fs = (kinds: Record<string, ReturnType<NoFollowFs['kind']>>): NoFollowFs => ({
    kind: (path) => kinds[path] ?? 'missing',
    read: (path) => `text of ${path}`,
  });

  it('reads regular files under the root and refuses everything else', () => {
    const read = noFollowReadText('/r', fs({ '/r/a': 'dir', '/r/a/b': 'file', '/r/f': 'file', '/r/o': 'other' }));
    expect(read('/r/a/b')).toBe('text of /r/a/b');
    expect(read('/r/missing')).toBeNull();
    expect(read('/r/f/below')).toBeNull();
    expect(() => read('/r/o')).toThrow('o is not a regular file');
    expect(() => read('/r/a')).toThrow('a is not a regular file');
    expect(() => read('/elsewhere')).toThrow('/elsewhere is outside /r');
    expect(() => read('/r')).toThrow('is outside');
  });

  it('tells files, directories, devices and missing paths apart without following links', () => {
    expect(nodeNoFollowFs.kind('/dev/null')).toBe('other');
    expect(nodeNoFollowFs.kind('/')).toBe('dir');
    expect(nodeNoFollowFs.kind('/no/such/path')).toBe('missing');
    expect(() => nodeNoFollowFs.kind(`${fileURLToPath(import.meta.url)}/below`)).toThrow(/ENOTDIR/);
  });
});

describe('a symbolic link to /proc/self/environ in a real PR', () => {
  let dir: string;
  const run = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lectio-gates-symlink-'));
    run('init', '--quiet', '--initial-branch=main');
    run('config', 'user.email', 'test@example.invalid');
    run('config', 'user.name', 'Test');
    run('config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'README.md'), 'readme\n');
    run('add', '.');
    run('commit', '--quiet', '-m', 'base');
    run('checkout', '--quiet', '-b', 'pr');
    mkdirSync(join(dir, 'calendar'));
    symlinkSync('/proc/self/environ', join(dir, LINK));
    mkdirSync(join(dir, 'passages'));
    symlinkSync('../README.md', join(dir, 'passages', 'A.1.json'));
    run('add', '.');
    run('commit', '--quiet', '-m', 'pr');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is reported as a non-regular change', () => {
    expect(nonRegularFiles(nodeGitExec, dir, 'main', 'HEAD')).toEqual([LINK, 'passages/A.1.json']);
  });

  it('reads as absent through the PR checkout (blobs at the head), never as its target', () => {
    const checkout = gitCheckout(dir, 'HEAD');
    expect(checkout.changedFiles('main', 'HEAD').map((file) => file.path)).toEqual([LINK, 'passages/A.1.json']);
    expect(checkout.readFile(LINK)).toBeNull();
    expect(checkout.readFile('passages/A.1.json')).toBeNull();
    expect(checkout.readFile('README.md')).toBe('readme\n');
  });

  it('makes the worktree reader throw instead of following it', () => {
    const read = noFollowReadText(dir);
    expect(() => read(join(dir, LINK))).toThrow(`${LINK} is a symbolic link; the gates never follow links`);
    expect(read(join(dir, 'README.md'))).toBe('readme\n');
  });

  it('fails lectio-gates run before any gate reads the tree', async () => {
    const logs: string[] = [];
    let ran = false;
    const probe = {
      ...passingGate,
      run: (context: Parameters<typeof passingGate.run>[0]) => {
        ran = true;
        return passingGate.run(context);
      },
    };
    const code = await runGatesCli(['run', '--root', '.', '--base', 'main', '--json', 'out/g.json'], {
      cwd: dir,
      env: { [SECRET]: 'ghs_secret' },
      log: (line) => logs.push(line),
      error: (line) => logs.push(line),
      gates: [probe],
      config: DEFAULT_CONFIG,
    });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(logs[0]).toBe('runner: fail (2 findings)');
    expect(logs.join('\n')).toContain(`${LINK} is not a regular file`);
    expect(logs.join('\n')).not.toContain('ghs_secret');
  });
});
