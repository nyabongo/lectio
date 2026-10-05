import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SAMPLES,
  LIMITATION,
  parseBuildArgs,
  PUBLIC_DOMAIN_SOURCES,
  readChapters,
  runGuardBuild,
  sampleShingleKeys,
} from './build.ts';
import type { GuardManifest, GuardSource } from './build.ts';
import { createFakeDownloader } from './download.ts';
import { writeZip } from './fixtures/zip-writer.ts';
import { shingleKeys, wordHash } from './hash.ts';
import { loadIndex } from './index-file.ts';
import { tokenise } from './normalise.ts';
import { longestRun } from './run.ts';

// Invented chapter text in eBible.org's readaloud layout (title, chapter line, one verse per line).
const chapterText = (seed: string): string =>
  `\uFEFFA Book of ${seed}.\nChapter 1.\nShort line.\n` +
  `On the ${seed} morning the weaver carried seven baskets of blue thread down to the river market and sold them all.\n` +
  `Then the ${seed} weaver went home singing.\n`;

const readaloudZip = (prefix: string, chapters: ReadonlyArray<[string, number]>): Uint8Array =>
  writeZip([
    { name: 'copr.htm', data: '<p>Public Domain</p>' },
    { name: `${prefix}_000_000_000_read.txt`, data: 'This set of files contains a script.' },
    ...chapters.map(([book, chapter]) => ({
      name: `${prefix}_000_${book}_${String(chapter).padStart(2, '0')}_read.txt`,
      data: chapterText(`${prefix} ${book} ${chapter}`),
    })),
  ]);

const SOURCES: GuardSource[] = [
  { id: 'aaa', title: 'Edition A', url: 'https://example.org/a.zip', homepage: 'https://example.org/a', licence: 'PD' },
  { id: 'bbb', title: 'Edition B', url: 'https://example.org/b.zip', homepage: 'https://example.org/b', licence: 'PD' },
];

let tmpRoot: string;
let outDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'textguard-test-tmp-'));
  outDir = join(await mkdtemp(join(tmpdir(), 'textguard-test-out-')), 'guard');
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(join(outDir, '..'), { recursive: true, force: true });
});

const fake = () =>
  createFakeDownloader({
    'https://example.org/a.zip': readaloudZip('aaa', [
      ['GEN', 1],
      ['JHN', 3],
    ]),
    'https://example.org/b.zip': readaloudZip('bbb', [['JHN', 3]]),
  });

describe('readChapters', () => {
  it('keeps chapter files only and skips the preamble', () => {
    const chapters = readChapters(readaloudZip('xyz', [['PSA', 23]]));
    expect(chapters.map(({ book, chapter }) => [book, chapter])).toEqual([['PSA', 23]]);
    expect(chapters[0]!.text).toContain('weaver');
  });
});

describe('sampleShingleKeys', () => {
  it('gives the shingle keys of the first 15 words of the first long enough line', () => {
    const keys = sampleShingleKeys(chapterText('x'), 8);
    const words = tokenise('On the x morning the weaver carried seven baskets of blue thread down to the');
    expect(words).toHaveLength(15);
    expect(keys).toEqual(
      shingleKeys(
        words.map((t) => wordHash(t.word)),
        8,
      ),
    );
    expect(keys).toHaveLength(8);
    expect(sampleShingleKeys('too short\nalso short', 8)).toBeUndefined();
  });
});

describe('runGuardBuild', () => {
  it('writes the index and SOURCE.json, self-checks, and deletes the downloaded text', async () => {
    const downloader = fake();
    const logs: string[] = [];
    const result = await runGuardBuild({
      downloader,
      outDir,
      sources: SOURCES,
      samples: [
        { source: 'aaa', book: 'JHN', chapter: 3 },
        { source: 'bbb', book: 'JHN', chapter: 3 },
      ],
      tmpRoot,
      now: () => new Date('2026-10-05T00:00:00Z'),
      log: (m) => logs.push(m),
    });

    expect(downloader.calls).toEqual(['https://example.org/a.zip', 'https://example.org/b.zip']);
    expect(await readdir(tmpRoot)).toEqual([]);
    expect((await readdir(outDir)).sort()).toEqual(['SOURCE.json', 'en-pd-8.bin']);
    expect(result.indexPath).toBe(join(outDir, 'en-pd-8.bin'));

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as GuardManifest;
    expect(manifest).toEqual(result.manifest);
    expect(manifest).toMatchObject({
      file: 'en-pd-8.bin',
      shingleSize: 8,
      builtAt: '2026-10-05T00:00:00.000Z',
      format: { magic: 'LSHI', version: 2, normaliserVersion: 2, keyBits: 40 },
      limitation: LIMITATION,
    });
    expect(manifest.editions.map((e) => [e.id, e.chapters])).toEqual([
      ['aaa', 2],
      ['bbb', 1],
    ]);
    expect(manifest.editions[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.selfCheck).toHaveLength(2);
    expect(manifest.selfCheck[0]!.shingleKeys).toHaveLength(8);
    expect(manifest.selfCheck[0]!.shingleKeys[0]).toMatch(/^[0-9a-f]{10}$/);
    expect(manifest.format).toMatchObject({ keyBits: 40 });
    expect(manifest.format.falsePositiveRate).toBeGreaterThan(0);
    // The manifest records no word, and no per-word hash, of the sample text.
    const json = await readFile(result.manifestPath, 'utf8');
    for (const { word } of tokenise(chapterText('aaa JHN 3'))) {
      expect(json).not.toContain(wordHash(word).toString(16));
    }
    expect(json).not.toMatch(/weaver|baskets|thread|market/i);
    expect(manifest.selfCheck[0]!.longestRun).toBeGreaterThanOrEqual(15);

    const bytes = new Uint8Array(await readFile(result.indexPath));
    expect(manifest.bytes).toBe(bytes.length);
    const index = loadIndex(bytes);
    expect(manifest.shingles).toBe(index.size);
    expect(longestRun(chapterText('aaa GEN 1'), index).words).toBe(tokenise(chapterText('aaa GEN 1')).length);
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('weaver');
    expect(logs.at(-1)).toMatch(/^wrote .*en-pd-8\.bin/);
  });

  it('defaults to the public-domain sources, the default samples and the OS temp dir', async () => {
    const zips: Record<string, Uint8Array> = {};
    for (const source of PUBLIC_DOMAIN_SOURCES) {
      const chapters = DEFAULT_SAMPLES.filter((s) => s.source === source.id).map(
        (s) => [s.book, s.chapter] as [string, number],
      );
      zips[source.url] = readaloudZip(source.id, chapters);
    }
    const result = await runGuardBuild({ downloader: createFakeDownloader(zips), outDir });
    expect(result.manifest.selfCheck).toHaveLength(DEFAULT_SAMPLES.length);
    expect(result.manifest.editions.map((e) => e.id)).toEqual(['eng-web', 'engDRA']);
  });

  it('names the file after the shingle size', async () => {
    const result = await runGuardBuild({
      downloader: fake(),
      outDir,
      sources: SOURCES,
      samples: [],
      shingleSize: 5,
      tmpRoot,
    });
    expect(result.indexPath).toBe(join(outDir, 'en-pd-5.bin'));
  });

  it.each([
    [{ source: 'aaa', book: 'ROM', chapter: 8 }, 'chapter aaa ROM 8 not found'],
    [{ source: 'zzz', book: 'JHN', chapter: 3 }, 'chapter zzz JHN 3 not found'],
  ])('fails when a sample chapter is missing (%o)', async (sample, message) => {
    await expect(
      runGuardBuild({ downloader: fake(), outDir, sources: SOURCES, samples: [sample], tmpRoot }),
    ).rejects.toThrow(message);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('fails when a sample chapter has no verse of 15 words', async () => {
    const downloader = createFakeDownloader({
      'https://example.org/a.zip': writeZip([{ name: 'aaa_001_GEN_01_read.txt', data: 'too short to sample' }]),
    });
    await expect(
      runGuardBuild({
        downloader,
        outDir,
        sources: [SOURCES[0]!],
        samples: [{ source: 'aaa', book: 'GEN', chapter: 1 }],
        tmpRoot,
      }),
    ).rejects.toThrow('aaa GEN 1 has no verse of 15 words');
  });

  it('fails when the index misses a sample (shingles longer than the sample)', async () => {
    await expect(
      runGuardBuild({
        downloader: fake(),
        outDir,
        sources: SOURCES,
        samples: [{ source: 'aaa', book: 'GEN', chapter: 1 }],
        shingleSize: 16,
        tmpRoot,
      }),
    ).rejects.toThrow('aaa GEN 1 gave a run of 0 words, expected 15');
  });

  it('fails on an archive without chapter files or a failed download, leaving nothing behind', async () => {
    const empty = createFakeDownloader({ 'https://example.org/a.zip': writeZip([{ name: 'copr.htm', data: 'x' }]) });
    await expect(runGuardBuild({ downloader: empty, outDir, sources: SOURCES, tmpRoot })).rejects.toThrow(
      'aaa: no chapter files in https://example.org/a.zip',
    );
    await expect(
      runGuardBuild({ downloader: createFakeDownloader({}), outDir, sources: SOURCES, tmpRoot }),
    ).rejects.toThrow('no file for https://example.org/a.zip');
    expect(await readdir(tmpRoot)).toEqual([]);
    await expect(readdir(outDir)).rejects.toThrow();
  });

  it('rejects a bad shingle size before downloading', async () => {
    const downloader = fake();
    await expect(runGuardBuild({ downloader, outDir, shingleSize: 1, tmpRoot })).rejects.toThrow(RangeError);
    expect(downloader.calls).toEqual([]);
  });
});

describe('parseBuildArgs', () => {
  it('defaults to 8-word shingles in corpus/guard', () => {
    expect(parseBuildArgs([])).toEqual({ shingleSize: 8, outDir: 'corpus/guard' });
  });

  it('reads --n and --out', () => {
    expect(parseBuildArgs(['--n', '6', '--out', 'tmp/guard'])).toEqual({ shingleSize: 6, outDir: 'tmp/guard' });
  });

  it('rejects bad input', () => {
    expect(() => parseBuildArgs(['--n'])).toThrow('--n needs a value');
    expect(() => parseBuildArgs(['--out'])).toThrow('--out needs a value');
    expect(() => parseBuildArgs(['--n', 'eight'])).toThrow(RangeError);
    expect(() => parseBuildArgs(['--verbose'])).toThrow('unknown argument --verbose');
  });
});
