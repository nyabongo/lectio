import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGit, nodeGitExec, parseNameStatus } from './git.ts';
import type { GitExec } from './git.ts';

describe('parseNameStatus', () => {
  it('parses every status, renames and copies, sorted by path', () => {
    const output = [
      'M',
      'b.json',
      'R087',
      'old.json',
      'new.json',
      'A',
      'a.json',
      'D',
      'gone.json',
      'C100',
      'x',
      'y',
      'T',
      't',
      'U',
      'u',
      '',
    ].join('\0');
    expect(parseNameStatus(output)).toEqual([
      { path: 'a.json', status: 'added' },
      { path: 'b.json', status: 'modified' },
      { path: 'gone.json', status: 'deleted' },
      { path: 'new.json', status: 'renamed', previousPath: 'old.json' },
      { path: 't', status: 'type-changed' },
      { path: 'u', status: 'unmerged' },
      { path: 'y', status: 'copied', previousPath: 'x' },
    ]);
  });

  it('sorts equal paths stably and returns nothing for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
    expect(parseNameStatus(['M', 'a', 'D', 'a'].join('\0'))).toEqual([
      { path: 'a', status: 'modified' },
      { path: 'a', status: 'deleted' },
    ]);
  });

  it('tolerates truncated output', () => {
    expect(parseNameStatus('M')).toEqual([{ path: '', status: 'modified' }]);
    expect(parseNameStatus('R100')).toEqual([{ path: '', status: 'renamed', previousPath: '' }]);
  });

  it('rejects an unknown status', () => {
    expect(() => parseNameStatus('X\0a')).toThrow('unexpected git diff status "X"');
  });
});

describe('createGit with a fake exec', () => {
  const calls: string[][] = [];
  const exec: GitExec = (args, cwd) => {
    calls.push([cwd, ...args]);
    if (args[0] === 'diff') return 'A\0passages/A.1.json\0';
    if (args[0] === 'ls-tree') return args[2] === 'base' ? `${String(args[4])}\n` : '';
    return 'content';
  };
  const git = createGit('/repo', exec);

  it('diffs base...head', () => {
    expect(git.changedFiles('origin/main', 'HEAD')).toEqual([{ path: 'passages/A.1.json', status: 'added' }]);
    expect(calls.at(-1)).toEqual(['/repo', 'diff', '--name-status', '-z', 'origin/main...HEAD']);
  });

  it('shows a file only when it exists at the ref', () => {
    expect(git.show('base', 'a.json')).toBe('content');
    expect(calls.at(-1)).toEqual(['/repo', 'show', 'base:a.json']);
    expect(git.show('other', 'a.json')).toBeNull();
  });
});

describe('createGit against a real repository', () => {
  let dir: string;
  const run = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lectio-gates-git-'));
    run('init', '--quiet', '--initial-branch=main');
    run('config', 'user.email', 'test@example.invalid');
    run('config', 'user.name', 'Test');
    run('config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, 'passages'));
    writeFileSync(join(dir, 'passages', 'A.1.json'), '{"v":1}\n');
    writeFileSync(join(dir, 'old.md'), 'old\n');
    run('add', '.');
    run('commit', '--quiet', '-m', 'base');
    run('checkout', '--quiet', '-b', 'pr');
    writeFileSync(join(dir, 'passages', 'A.1.json'), '{"v":2}\n');
    writeFileSync(join(dir, 'passages', 'B.2.json'), '{}\n');
    run('rm', '--quiet', 'old.md');
    run('add', '.');
    run('commit', '--quiet', '-m', 'pr');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the PR changes and reads base files', () => {
    const git = createGit(dir);
    expect(git.changedFiles('main', 'HEAD')).toEqual([
      { path: 'old.md', status: 'deleted' },
      { path: 'passages/A.1.json', status: 'modified' },
      { path: 'passages/B.2.json', status: 'added' },
    ]);
    expect(git.show('main', 'passages/A.1.json')).toBe('{"v":1}\n');
    expect(git.show('main', 'passages/B.2.json')).toBeNull();
  });

  it('nodeGitExec throws when git fails', () => {
    expect(() => nodeGitExec(['show', 'no-such-ref:x'], dir)).toThrow();
  });
});
