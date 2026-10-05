/**
 * `npm run guard:build`: downloads the public-domain English Bibles to a temp
 * directory, hashes their shingles, deletes the text and writes only
 * `corpus/guard/en-pd-<n>.bin` and `corpus/guard/SOURCE.json`.
 *
 * Before writing, it checks the new index against sample verses of the World
 * English Bible and records each sample only as its shingle keys (the same keys
 * the index holds; never words or per-word hashes) with its run length, so the
 * unit tests can re-check the committed index offline.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Downloader } from './download.ts';
import { assertShingleSize, DEFAULT_SHINGLE_SIZE, KEY_BITS, shingleKeys, wordHash } from './hash.ts';
import { buildIndex, INDEX_FORMAT_VERSION, INDEX_MAGIC, loadIndex } from './index-file.ts';
import type { ShingleIndex } from './index-file.ts';
import { NORMALISER_VERSION, tokenise } from './normalise.ts';
import { longestRunOfKeys } from './run.ts';
import { readZip } from './zip.ts';

/** A public-domain Bible in eBible.org's "readaloud" layout: one plain-text file per chapter. */
export interface GuardSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly homepage: string;
  readonly licence: string;
}

export const PUBLIC_DOMAIN_SOURCES: readonly GuardSource[] = [
  {
    id: 'eng-web',
    title: 'World English Bible Classic (2020 stable text, with deuterocanon), eBible.org readaloud edition',
    url: 'https://ebible.org/Scriptures/eng-web_readaloud.zip',
    homepage: 'https://ebible.org/web/',
    licence: 'Public Domain',
  },
  {
    id: 'engDRA',
    title: 'Douay-Rheims Bible, American Edition of 1899 (Challoner revision), eBible.org readaloud edition',
    url: 'https://ebible.org/Scriptures/engDRA_readaloud.zip',
    homepage: 'https://ebible.org/engDRA/',
    licence: 'Public Domain',
  },
];

/** A chapter whose first verse of at least `SAMPLE_WORDS` words becomes a self-check sample. */
export interface SampleSelector {
  readonly source: string;
  readonly book: string;
  readonly chapter: number;
}

export const SAMPLE_WORDS = 15;

export const DEFAULT_SAMPLES: readonly SampleSelector[] = [
  { source: 'eng-web', book: 'GEN', chapter: 1 },
  { source: 'eng-web', book: 'PSA', chapter: 23 },
  { source: 'eng-web', book: 'MAT', chapter: 5 },
  { source: 'eng-web', book: 'JHN', chapter: 3 },
  { source: 'eng-web', book: 'ROM', chapter: 8 },
  { source: 'engDRA', book: 'JHN', chapter: 3 },
];

export interface SelfCheckSample {
  readonly source: string;
  readonly book: string;
  readonly chapter: number;
  /**
   * The sample's consecutive shingle keys (10 hex digits each): the same keys the index holds, so they only
   * answer "is this n-word window in the index?" and cannot be turned back into words. No per-word hash,
   * word or text is ever recorded.
   */
  readonly shingleKeys: string[];
  readonly longestRun: number;
}

export interface GuardManifest {
  readonly description: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly format: {
    readonly magic: string;
    readonly version: number;
    readonly normaliserVersion: number;
    readonly keyBits: number;
    /** Chance that one shingle absent from the sources is reported as present: keys / 2^keyBits. */
    readonly falsePositiveRate: number;
  };
  readonly shingleSize: number;
  readonly shingles: number;
  readonly builtAt: string;
  readonly builder: string;
  readonly editions: ReadonlyArray<
    GuardSource & { readonly sha256: string; readonly chapters: number; readonly words: number }
  >;
  readonly selfCheck: SelfCheckSample[];
  readonly limitation: string;
}

export interface GuardBuildOptions {
  readonly downloader: Downloader;
  /** Directory receiving `en-pd-<n>.bin` and `SOURCE.json` (created if missing). */
  readonly outDir: string;
  readonly shingleSize?: number;
  readonly sources?: readonly GuardSource[];
  readonly samples?: readonly SampleSelector[];
  /** Parent of the temporary download directory; default the OS temp dir. */
  readonly tmpRoot?: string;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

export interface GuardBuildResult {
  readonly indexPath: string;
  readonly manifestPath: string;
  readonly manifest: GuardManifest;
}

export const LIMITATION =
  'The index only detects overlap with World English Bible and Douay-Rheims wording. Copyrighted modern ' +
  'translations (NABRE, RSV-2CE, Jerusalem Bible) are caught only where they share runs with those texts; the ' +
  'quoted-run rule, the research prompt rules and human review are the remaining safeguards.';

interface Chapter {
  readonly book: string;
  readonly chapter: number;
  readonly text: string;
}

const CHAPTER_FILE = /_([0-9A-Z]{3})_(\d+)_read\.txt$/;
const INTRO_FILE = /_000_000_000_read\.txt$/;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The chapter texts of a readaloud archive (the archive's preamble file is skipped). */
export function readChapters(zipBytes: Uint8Array): Chapter[] {
  const chapters: Chapter[] = [];
  const decoder = new TextDecoder();
  for (const { name, data } of readZip(zipBytes)) {
    const match = CHAPTER_FILE.exec(name);
    if (match === null || INTRO_FILE.test(name)) continue;
    chapters.push({ book: match[1] as string, chapter: Number(match[2]), text: decoder.decode(data) });
  }
  return chapters;
}

/** The shingle keys of the first `SAMPLE_WORDS` words of the chapter's first verse line that has that many. */
export function sampleShingleKeys(chapterText: string, shingleSize: number): number[] | undefined {
  for (const line of chapterText.split('\n')) {
    const tokens = tokenise(line);
    if (tokens.length >= SAMPLE_WORDS) {
      return shingleKeys(
        tokens.slice(0, SAMPLE_WORDS).map(({ word }) => wordHash(word)),
        shingleSize,
      );
    }
  }
  return undefined;
}

function selfCheck(
  index: ShingleIndex,
  chaptersBySource: ReadonlyMap<string, readonly Chapter[]>,
  samples: readonly SampleSelector[],
): SelfCheckSample[] {
  return samples.map(({ source, book, chapter }) => {
    const label = `${source} ${book} ${chapter}`;
    const found = chaptersBySource.get(source)?.find((c) => c.book === book && c.chapter === chapter);
    if (found === undefined) throw new Error(`self-check: chapter ${label} not found`);
    const keys = sampleShingleKeys(found.text, index.shingleSize);
    if (keys === undefined) throw new Error(`self-check: ${label} has no verse of ${SAMPLE_WORDS} words`);
    const run = longestRunOfKeys(keys, index).words;
    if (run < SAMPLE_WORDS)
      throw new Error(`self-check: ${label} gave a run of ${run} words, expected ${SAMPLE_WORDS}`);
    const hexKeys = keys.map((key) => key.toString(16).padStart(KEY_BITS / 4, '0'));
    return { source, book, chapter, shingleKeys: hexKeys, longestRun: run };
  });
}

/** Downloads, hashes and writes the guard index; the downloaded text is deleted before this resolves. */
export async function runGuardBuild(options: GuardBuildOptions): Promise<GuardBuildResult> {
  const shingleSize = options.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  assertShingleSize(shingleSize);
  const sources = options.sources ?? PUBLIC_DOMAIN_SOURCES;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());

  const tmp = await mkdtemp(join(options.tmpRoot ?? tmpdir(), 'lectio-guard-'));
  let bytes: Uint8Array;
  let checks: SelfCheckSample[];
  let index: ShingleIndex;
  const editions: GuardManifest['editions'][number][] = [];
  try {
    const chaptersBySource = new Map<string, Chapter[]>();
    for (const source of sources) {
      log(`downloading ${source.url}`);
      const zipPath = join(tmp, `${source.id}.zip`);
      await writeFile(zipPath, await options.downloader.download(source.url));
      const zipBytes = new Uint8Array(await readFile(zipPath));
      const chapters = readChapters(zipBytes);
      if (chapters.length === 0) throw new Error(`${source.id}: no chapter files in ${source.url}`);
      chaptersBySource.set(source.id, chapters);
      const words = chapters.reduce((sum, c) => sum + tokenise(c.text).length, 0);
      editions.push({ ...source, sha256: sha256(zipBytes), chapters: chapters.length, words });
      log(`${source.id}: ${chapters.length} chapters, ${words} words`);
    }
    bytes = buildIndex(
      [...chaptersBySource.values()].flatMap((chapters) => chapters.map((c) => c.text)),
      { shingleSize },
    );
    index = loadIndex(bytes);
    checks = selfCheck(index, chaptersBySource, options.samples ?? DEFAULT_SAMPLES);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const file = `en-pd-${shingleSize}.bin`;
  const manifest: GuardManifest = {
    description:
      'Hash-only shingle index of public-domain English Bibles for the licence guard (gate 3). It stores a ' +
      `Golomb-Rice-coded set of ${KEY_BITS}-bit hashes of every ${shingleSize}-word shingle and no text; see ` +
      'packages/textguard/README.md.',
    file,
    sha256: sha256(bytes),
    bytes: bytes.length,
    format: {
      magic: INDEX_MAGIC,
      version: INDEX_FORMAT_VERSION,
      normaliserVersion: NORMALISER_VERSION,
      keyBits: KEY_BITS,
      falsePositiveRate: Number((index.size / 2 ** KEY_BITS).toPrecision(2)),
    },
    shingleSize,
    shingles: index.size,
    builtAt: now().toISOString(),
    builder: 'scripts/corpus/build-guard-index.mjs (packages/textguard/src/build.ts)',
    editions,
    selfCheck: checks,
    limitation: LIMITATION,
  };
  await mkdir(options.outDir, { recursive: true });
  const indexPath = join(options.outDir, file);
  const manifestPath = join(options.outDir, 'SOURCE.json');
  await writeFile(indexPath, bytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`wrote ${indexPath} (${bytes.length} bytes, ${manifest.shingles} shingles)`);
  return { indexPath, manifestPath, manifest };
}

export interface GuardBuildArgs {
  readonly shingleSize: number;
  /** Output directory relative to the repository root. */
  readonly outDir: string;
}

/** Parses `[--n <words>] [--out <dir>]`. */
export function parseBuildArgs(argv: readonly string[]): GuardBuildArgs {
  let shingleSize = DEFAULT_SHINGLE_SIZE;
  let outDir = 'corpus/guard';
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === '--n' || flag === '--out') && value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--n') {
      shingleSize = Number(value);
      assertShingleSize(shingleSize);
      i++;
    } else if (flag === '--out') {
      outDir = value as string;
      i++;
    } else {
      throw new Error(`unknown argument ${flag}; usage: guard:build [--n <words>] [--out <dir>]`);
    }
  }
  return { shingleSize, outDir };
}
