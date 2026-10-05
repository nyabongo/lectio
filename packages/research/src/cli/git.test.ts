import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PullRequest } from '@lectio/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gitPrFiles } from './git.ts';

describe('gitPrFiles against a local origin', () => {
  let dir: string;
  let headSha: string;
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lectio-research-git-'));
    const origin = join(dir, 'origin');
    mkdirSync(join(origin, 'passages'), { recursive: true });
    git(origin, 'init', '--quiet', '--initial-branch=main');
    git(origin, 'config', 'user.email', 'test@example.invalid');
    git(origin, 'config', 'user.name', 'Test');
    git(origin, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(origin, 'passages', 'OLD.1.1.json'), '{"base":true}\n');
    git(origin, 'add', '.');
    git(origin, 'commit', '--quiet', '-m', 'base');
    git(dir, 'clone', '--quiet', origin, 'checkout');
    git(origin, 'checkout', '--quiet', '-b', 'research/MT.20.1-16');
    writeFileSync(join(origin, 'passages', 'MT.20.1-16.json'), '{"head":true}\n');
    git(origin, 'add', '.');
    git(origin, 'commit', '--quiet', '-m', 'research');
    headSha = git(origin, 'rev-parse', 'HEAD').trim();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fetches the PR branch and reads its file at the head sha, and reads the base branch', async () => {
    const files = gitPrFiles(join(dir, 'checkout'));
    const pr = { head: 'research/MT.20.1-16', headSha, base: 'main' } as PullRequest;
    expect(await files.head(pr, 'passages/MT.20.1-16.json')).toBe('{"head":true}\n');
    expect(await files.base(pr, 'passages/MT.20.1-16.json')).toBeNull();
    expect(await files.base(pr, 'passages/OLD.1.1.json')).toBe('{"base":true}\n');
  });
});
