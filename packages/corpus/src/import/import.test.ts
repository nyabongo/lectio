import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { c as createTar } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openCorpus } from '../corpus.ts';
import { CorpusError } from '../format.ts';
import type { SourceInfo } from '../format.ts';
import { listLicences } from '../licences.ts';
import { downloadPinned, sha256Hex, unpackTarball, verifySha256, writeChapter, writeEditionMetadata } from './index.ts';
import type { Downloader } from './index.ts';

const fixtureRoot = fileURLToPath(new URL('../fixtures/corpus', import.meta.url));

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-import-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A deterministic fake: serves fixed bytes per URL and records requests. */
function fakeDownloader(files: Record<string, Uint8Array>): Downloader & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async fetchBytes(url) {
      requests.push(url);
      const bytes = files[url];
      if (bytes === undefined) throw new Error(`404 ${url}`);
      return bytes;
    },
  };
}

/** Builds a tiny upstream-style archive (`edition-v1/…`) from the fixture corpus. */
async function tinyArchive(dir: string, gzip: boolean): Promise<string> {
  const archive = join(dir, gzip ? 'upstream.tar.gz' : 'upstream.tar');
  await mkdir(join(dir, 'src', 'edition-v1', 'MT'), { recursive: true });
  await writeFile(
    join(dir, 'src', 'edition-v1', 'MT', '20.json'),
    await readFile(join(fixtureRoot, 'grc-test', 'MT', '20.json')),
  );
  await writeFile(join(dir, 'src', 'edition-v1', 'LICENSE'), 'CC BY 4.0');
  await createTar({ gzip, file: archive, cwd: join(dir, 'src'), portable: true }, ['edition-v1']);
  return archive;
}

describe('sha256', () => {
  it('hashes and verifies', () => {
    const bytes = new TextEncoder().encode('abc');
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex(bytes)).toBe(hash);
    expect(() => verifySha256(bytes, hash.toUpperCase(), 'abc')).not.toThrow();
    expect(() => verifySha256(bytes, '0'.repeat(64), 'abc')).toThrow(
      new CorpusError(`sha256 mismatch for abc: expected ${'0'.repeat(64)}, got ${hash}`),
    );
  });
});

describe('downloadPinned', () => {
  const url = 'https://example.test/upstream.tar.gz';
  const bytes = new TextEncoder().encode('archive bytes');
  const sha256 = sha256Hex(bytes);

  it('downloads, verifies and writes the archive', async () => {
    const dir = await tempDir();
    const dest = join(dir, 'cache', 'upstream.tar.gz');
    const downloader = fakeDownloader({ [url]: bytes });
    expect(await downloadPinned(downloader, { url, sha256 }, dest)).toEqual(bytes);
    expect(new Uint8Array(await readFile(dest))).toEqual(bytes);
    expect(downloader.requests).toEqual([url]);
  });

  it('reuses a cached archive with the right hash without downloading', async () => {
    const dir = await tempDir();
    const dest = join(dir, 'upstream.tar.gz');
    await writeFile(dest, bytes);
    const downloader = fakeDownloader({});
    expect(new Uint8Array(await downloadPinned(downloader, { url, sha256 }, dest))).toEqual(bytes);
    expect(downloader.requests).toEqual([]);
  });

  it('replaces a stale cached archive', async () => {
    const dir = await tempDir();
    const dest = join(dir, 'upstream.tar.gz');
    await writeFile(dest, 'stale');
    const downloader = fakeDownloader({ [url]: bytes });
    await downloadPinned(downloader, { url, sha256 }, dest);
    expect(new Uint8Array(await readFile(dest))).toEqual(bytes);
    expect(downloader.requests).toEqual([url]);
  });

  it('refuses a download whose hash does not match and leaves no file', async () => {
    const dir = await tempDir();
    const dest = join(dir, 'upstream.tar.gz');
    const downloader = fakeDownloader({ [url]: new TextEncoder().encode('tampered') });
    await expect(downloadPinned(downloader, { url, sha256 }, dest)).rejects.toThrow(/sha256 mismatch/);
    await expect(stat(dest)).rejects.toThrow(/ENOENT/);
    await expect(stat(`${dest}.partial`)).rejects.toThrow(/ENOENT/);
  });

  it('propagates downloader and file-system errors', async () => {
    const dir = await tempDir();
    await expect(downloadPinned(fakeDownloader({}), { url, sha256 }, join(dir, 'x'))).rejects.toThrow('404');
    await expect(downloadPinned(fakeDownloader({ [url]: bytes }), { url, sha256 }, dir)).rejects.toThrow();
  });
});

describe('unpackTarball', () => {
  it.each([true, false])('extracts a tiny archive (gzip: %s), stripping the top directory', async (gzip) => {
    const dir = await tempDir();
    const archive = await tinyArchive(dir, gzip);
    const out = join(dir, 'out');
    await unpackTarball(archive, out, { strip: 1 });
    expect(await readFile(join(out, 'LICENSE'), 'utf8')).toBe('CC BY 4.0');
    expect(JSON.parse(await readFile(join(out, 'MT', '20.json'), 'utf8'))).toHaveProperty('15');
    await unpackTarball(archive, join(dir, 'kept'));
    expect(await readFile(join(dir, 'kept', 'edition-v1', 'LICENSE'), 'utf8')).toBe('CC BY 4.0');
  });

  it('end to end: pinned download, unpack, write corpus files, query them', async () => {
    const dir = await tempDir();
    const archive = await tinyArchive(dir, true);
    const archiveBytes = new Uint8Array(await readFile(archive));
    const url = 'https://example.test/edition-v1.tar.gz';
    const downloader = fakeDownloader({ [url]: archiveBytes });
    const sha256 = sha256Hex(archiveBytes);
    const cached = join(dir, 'cache', 'edition-v1.tar.gz');
    await downloadPinned(downloader, { url, sha256 }, cached);
    const unpacked = join(dir, 'unpacked');
    await unpackTarball(cached, unpacked, { strip: 1 });

    const root = join(dir, 'corpus');
    const source: SourceInfo = {
      name: 'Imported test edition',
      language: 'grc',
      upstreamUrl: url,
      version: 'v1',
      sha256,
      licence: 'CC-BY-4.0',
      attribution: 'Test attribution.',
      versification: 'NABRE',
    };
    await writeEditionMetadata(root, 'grc-imported', source, await readFile(join(unpacked, 'LICENSE'), 'utf8'));
    const verses = JSON.parse(await readFile(join(unpacked, 'MT', '20.json'), 'utf8'));
    await writeChapter(root, 'grc-imported', 'MT', 20, verses);

    expect(await readFile(join(root, 'grc-imported', 'LICENSE.md'), 'utf8')).toBe('CC BY 4.0\n');
    const corpus = openCorpus(root);
    expect((await corpus.findWord('grc-imported', 'MT', 20, 15, 'πονηρος')).matches).toHaveLength(1);
    expect(await listLicences(root)).toEqual([{ edition: 'grc-imported', ...source }]);
  });
});

describe('writers', () => {
  it('keeps a trailing newline and validates identifiers', async () => {
    const root = await tempDir();
    const source = (await listLicences(fixtureRoot))[0] as SourceInfo & { edition?: string };
    const { edition: _edition, ...info } = source;
    await writeEditionMetadata(root, 'grc-x', info, 'Licence\n');
    expect(await readFile(join(root, 'grc-x', 'LICENSE.md'), 'utf8')).toBe('Licence\n');
    await expect(writeEditionMetadata(root, 'Bad', info, '')).rejects.toThrow('invalid edition id');
    await expect(writeChapter(root, 'grc-x', 'mt', 1, {})).rejects.toThrow('invalid book code');
    await expect(writeChapter(root, 'bad/x', 'MT', 1, {})).rejects.toThrow('invalid edition id');
    await expect(writeChapter(root, 'grc-x', 'MT', '1/2', {})).rejects.toThrow('invalid chapter');
  });

  it('writes byte-identical files for the same input', async () => {
    const root = await tempDir();
    const write = vi.fn(() => writeChapter(root, 'grc-x', 'MT', 1, { '2': [['b', 'b']], '1': [['a', 'a']] }));
    await write();
    const first = await readFile(join(root, 'grc-x', 'MT', '1.json'), 'utf8');
    await write();
    expect(await readFile(join(root, 'grc-x', 'MT', '1.json'), 'utf8')).toBe(first);
    expect(first.indexOf('"1"')).toBeLessThan(first.indexOf('"2"'));
  });
});
