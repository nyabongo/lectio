import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultSourceCacheDir } from './cache.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('defaultSourceCacheDir', () => {
  it('is .cache/sources in the nearest workspace root above INIT_CWD or cwd', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'lectio-cache-'));
    dirs.push(repo);
    const pkg = join(repo, 'packages', 'x');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(repo, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    await writeFile(join(pkg, 'package.json'), '{ not json');
    expect(defaultSourceCacheDir({ INIT_CWD: pkg }, '/elsewhere')).toBe(join(repo, '.cache', 'sources'));
    expect(defaultSourceCacheDir({}, pkg)).toBe(join(repo, '.cache', 'sources'));
  });

  it('falls back to the starting directory outside a workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lectio-cache-'));
    dirs.push(dir);
    expect(defaultSourceCacheDir({}, dir)).toBe(join(dir, '.cache', 'sources'));
  });
});
