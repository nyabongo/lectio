import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CorpusError } from '../format.ts';
import type { Downloader } from '../import/download.ts';
import { corpusDownloader, replaceEdition } from './shared.ts';
import type { RenameDir } from './shared.ts';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-shared-test-'));
  temps.push(dir);
  return join(dir, 'corpus');
}

describe('corpusDownloader', () => {
  const url = 'https://example.test/a.tar.gz';
  const failing = (error: unknown): Downloader => ({ fetchBytes: () => Promise.reject(error) });

  it('passes bytes through', async () => {
    const ok: Downloader = { fetchBytes: async () => Uint8Array.from([1]) };
    expect(await corpusDownloader(ok).fetchBytes(url)).toEqual(Uint8Array.from([1]));
  });

  it('turns failures into CorpusErrors naming the URL once', async () => {
    const own = new CorpusError('already a corpus error');
    await expect(corpusDownloader(failing(own)).fetchBytes(url)).rejects.toBe(own);
    await expect(corpusDownloader(failing(new Error('offline'))).fetchBytes(url)).rejects.toThrow(
      new CorpusError(`GET ${url}: offline`),
    );
    await expect(corpusDownloader(failing(new Error(`GET ${url}: HTTP 404`))).fetchBytes(url)).rejects.toThrow(
      new CorpusError(`GET ${url}: HTTP 404`),
    );
    const error = await corpusDownloader(failing('boom'))
      .fetchBytes(url)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CorpusError);
    expect(error).toMatchObject({ message: `GET ${url}: boom`, cause: 'boom' });
  });
});

describe('replaceEdition', () => {
  const write = (text: string) => async (staging: string) => {
    await mkdir(join(staging, 'ed'), { recursive: true });
    await writeFile(join(staging, 'ed', 'file.txt'), text);
    return text.length;
  };
  const failingOn = (failOn: readonly number[], code = 'EXDEV'): RenameDir => {
    let calls = 0;
    return async (from, to) => {
      calls += 1;
      if (failOn.includes(calls)) throw Object.assign(new Error(`rename ${calls} failed`), { code });
      await rename(from, to);
    };
  };

  it('creates the edition, then replaces it, leaving no staging or backup directory', async () => {
    const root = await tempRoot();
    expect(await replaceEdition(root, 'ed', write('one'))).toBe(3);
    await writeFile(join(root, 'ed', 'stale.txt'), 'stale');
    await replaceEdition(root, 'ed', write('two'));
    expect(await readdir(root)).toEqual(['ed']);
    expect(await readdir(join(root, 'ed'))).toEqual(['file.txt']);
    expect(await readFile(join(root, 'ed', 'file.txt'), 'utf8')).toBe('two');
  });

  it('stages under a .staging-<edition>- dot-folder in the corpus root', async () => {
    const root = await tempRoot();
    let seen = '';
    await replaceEdition(root, 'ed', async (staging) => {
      seen = staging;
      return write('x')(staging);
    });
    expect(seen.startsWith(join(root, '.staging-ed-'))).toBe(true);
  });

  it('keeps the previous edition when writing fails part-way', async () => {
    const root = await tempRoot();
    await replaceEdition(root, 'ed', write('old'));
    await expect(
      replaceEdition(root, 'ed', async (staging) => {
        await write('partial')(staging);
        throw new CorpusError('parse error');
      }),
    ).rejects.toThrow('parse error');
    expect(await readdir(root)).toEqual(['ed']);
    expect(await readFile(join(root, 'ed', 'file.txt'), 'utf8')).toBe('old');
  });

  it('restores the previous edition when the swap fails', async () => {
    const root = await tempRoot();
    await replaceEdition(root, 'ed', write('old'));
    await expect(replaceEdition(root, 'ed', write('new'), failingOn([2]))).rejects.toThrow('rename 2 failed');
    expect(await readdir(root)).toEqual(['ed']);
    expect(await readFile(join(root, 'ed', 'file.txt'), 'utf8')).toBe('old');
  });

  it('keeps the backup outside the staging directory when even the restore fails', async () => {
    const root = await tempRoot();
    await replaceEdition(root, 'ed', write('old'));
    const error = await replaceEdition(root, 'ed', write('new'), failingOn([2, 3])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CorpusError);
    expect((error as Error).message).toMatch(/rename 2 failed.*rename 3 failed.*previous edition is kept at /u);
    const left = await readdir(root);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^\.staging-ed-.+-previous$/u);
    expect(await readFile(join(root, left[0] as string, 'file.txt'), 'utf8')).toBe('old');
  });
});
