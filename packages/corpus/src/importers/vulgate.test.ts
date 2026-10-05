import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { server } from '@lectio/shared/test-server';
import { isBookCode } from '@lectio/refs';
import { http, HttpResponse } from 'msw';
import { c as createTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import { openCorpus } from '../corpus.ts';
import { CorpusError } from '../format.ts';
import type { Downloader } from '../import/download.ts';
import { sha256Hex } from '../import/download.ts';
import { listLicences } from '../licences.ts';
import {
  CLEMENTINE_VULGATE,
  decodeCp1252,
  fetchDownloader,
  importClementineVulgate,
  LICENCE_STATEMENT,
  parseVulgateBook,
  PROLOGUE_VERSE,
  runImportVulgate,
  tokeniseVerse,
  VULGATE_BOOKS,
  VULGATE_EDITION,
  vulgateSource,
} from './vulgate.ts';

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-vulgate-test-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Encodes text as codepage 1252 (the few non-ASCII letters the fixtures use). */
function cp1252(text: string): Uint8Array {
  const table: Record<string, number> = { æ: 0xe6, Æ: 0xc6, œ: 0x9c, ë: 0xeb };
  return Uint8Array.from([...text].map((char) => table[char] ?? char.charCodeAt(0)));
}

/** Synthetic upstream text, in the upstream markup, written for the tests (not taken from the edition). */
const SYNTHETIC: Readonly<Record<string, string>> = {
  Mt: '20:14 Tolle verbum tuum, et vade.\r\n20:15 An oculus tuus nequam est ? lux mea.\r\n',
  Ps: '144:1 Canticum novum. [Cantabo tibi, rex,/ et laudabo nomen tuum./\r\n144:2 Per dies cæli benedicam./]\r\n',
  Lam: '1:1 <Prologus>Prologus brevis hic : et dixit : [<Aleph>Quomodo sedet/ civitas !/\r\n',
  Ct: '1:1 [<Sponsa>Osculetur me ;/ quia meliora sunt,/\r\n',
};

function bookText(stem: string): string {
  return SYNTHETIC[stem] ?? `1:1 Verbum libri ${stem}.\r\n`;
}

/** A tiny upstream-style archive (`clementinetextproject-text-<sha>/…`) with one short file per book. */
async function fixtureArchive(
  dir: string,
  edit: (files: Map<string, Uint8Array>) => void = () => undefined,
): Promise<Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const stem of Object.keys(VULGATE_BOOKS)) files.set(`${stem}.lat`, cp1252(bookText(stem)));
  files.set('README.md', new TextEncoder().encode('# Synthetic upstream README\r\n\r\nFor tests.\r\n'));
  edit(files);
  const top = join(dir, 'src', 'clementinetextproject-text-test');
  await mkdir(top, { recursive: true });
  for (const [name, bytes] of files) {
    await mkdir(dirname(join(top, name)), { recursive: true });
    await writeFile(join(top, name), bytes);
  }
  const archive = join(dir, 'upstream.tar.gz');
  await createTar({ gzip: true, file: archive, cwd: join(dir, 'src'), portable: true }, [
    'clementinetextproject-text-test',
  ]);
  return new Uint8Array(await readFile(archive));
}

function fakeDownloader(files: Record<string, Uint8Array>): Downloader & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async fetchBytes(url) {
      requests.push(url);
      const bytes = files[url];
      if (bytes === undefined) throw new CorpusError(`GET ${url}: HTTP 404`);
      return bytes;
    },
  };
}

async function treeHash(dir: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        hash
          .update(relative(dir, path))
          .update('\0')
          .update(await readFile(path));
    }
  }
  await walk(dir);
  return hash.digest('hex');
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

const testUrl = 'https://example.test/clementine.tar.gz';

describe('book table', () => {
  it('maps the 73 upstream files to 73 distinct NABRE book codes', () => {
    const codes = Object.values(VULGATE_BOOKS);
    expect(codes).toHaveLength(73);
    expect(new Set(codes).size).toBe(73);
    expect(codes.filter((code) => !isBookCode(code))).toEqual([]);
    expect(VULGATE_BOOKS['3Rg']).toBe('1KGS');
    expect(VULGATE_BOOKS['Mch']).toBe('MI');
    expect(VULGATE_BOOKS['Mc']).toBe('MK');
  });
});

describe('decodeCp1252', () => {
  it('decodes the ligatures and diaeresis the upstream uses', () => {
    expect(decodeCp1252(Uint8Array.from([0xe6, 0xc6, 0x9c, 0xeb, 0x41]))).toBe('æÆœëA');
  });
});

describe('tokeniseVerse', () => {
  it('drops markup, speaker labels and free-standing punctuation, keeping attached punctuation', () => {
    expect(tokeniseVerse('[<Sponsa>Osculetur me ;/ quia (inquit) meliora,/ sunt.\\ Et ? ]')).toEqual([
      ['Osculetur', ''],
      ['me', ''],
      ['quia', ''],
      ['(inquit)', ''],
      ['meliora,', ''],
      ['sunt.', ''],
      ['Et', ''],
    ]);
    expect(tokeniseVerse(' : ; ')).toEqual([]);
  });
});

describe('parseVulgateBook', () => {
  it('parses chapters and verses (CRLF or LF, with or without a final newline)', () => {
    const book = parseVulgateBook('1:1 Alpha beta.\r\n1:2 Gamma.\r\n2:1 Delta', 'X.lat');
    expect([...book.keys()]).toEqual(['1', '2']);
    expect(book.get('1')).toEqual({
      '1': [
        ['Alpha', ''],
        ['beta.', ''],
      ],
      '2': [['Gamma.', '']],
    });
    expect(book.get('2')).toEqual({ '1': [['Delta', '']] });
    expect(parseVulgateBook('1:1 A\n', 'X.lat').get('1')).toEqual({ '1': [['A', '']] });
  });

  it('stores a prologue as its own verse, before the first "["', () => {
    const book = parseVulgateBook('1:1 <Prologus>Ante dixit : [<Aleph>Quomodo/\r\n', 'Lam.lat');
    expect(book.get('1')).toEqual({
      [PROLOGUE_VERSE]: [
        ['Ante', ''],
        ['dixit', ''],
      ],
      '1': [['Quomodo', '']],
    });
  });

  it.each([
    ['', 'X.lat: no verses'],
    ['1:1 A\r\n\r\n1:2 B\r\n', 'X.lat:2: expected "<chapter>:<verse> <text>"'],
    ['1:01 A\r\n', 'X.lat:1: expected "<chapter>:<verse> <text>"'],
    ['1:1 A\r\n1:1 B\r\n', 'X.lat:2: duplicate verse 1:1'],
    ['1:1 [ / ? ]\r\n', 'X.lat:1: verse 1:1 has no words'],
    ['1:1 <Prologus>Sine versu\r\n', 'X.lat:1: prologue without a following "["'],
  ])('rejects %j', (text, message) => {
    expect(() => parseVulgateBook(text, 'X.lat')).toThrow(new CorpusError(message));
  });
});

describe('vulgateSource', () => {
  it('records the pinned upstream, the public-domain licence and Vulgate versification', () => {
    const source = vulgateSource(CLEMENTINE_VULGATE);
    expect(source).toMatchObject({
      language: 'lat',
      upstreamUrl: CLEMENTINE_VULGATE.url,
      version: CLEMENTINE_VULGATE.version,
      sha256: CLEMENTINE_VULGATE.sha256,
      licence: 'LicenseRef-PublicDomain',
      versification: 'vulgate',
    });
    expect(CLEMENTINE_VULGATE.url).toContain(CLEMENTINE_VULGATE.version);
  });
});

describe('importClementineVulgate', () => {
  it('imports every book, writes metadata, and the corpus answers queries', async () => {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const downloader = fakeDownloader({ [testUrl]: bytes });
    const corpusRoot = join(dir, 'corpus');
    const summary = await importClementineVulgate({ downloader, corpusRoot, cacheDir: join(dir, 'cache'), archive });
    expect(summary).toEqual({ edition: VULGATE_EDITION, books: 73, chapters: 73, verses: 75 });
    expect(await stat(join(dir, 'cache', 'clementine-vulgate-test-1.tar.gz'))).toBeTruthy();

    const corpus = openCorpus(corpusRoot);
    expect((await corpus.findWord(VULGATE_EDITION, 'MT', 20, 15, 'oculus')).matches).toHaveLength(1);
    expect((await corpus.findWord(VULGATE_EDITION, 'MT', 20, 15, 'nequam')).matches).toHaveLength(1);
    expect(await corpus.getVerse(VULGATE_EDITION, 'PS', 144, 1)).toContainEqual(['Cantabo', '']);
    expect((await corpus.findWord(VULGATE_EDITION, 'PS', 144, 2, 'caeli')).matches).toHaveLength(1);
    expect(await corpus.getVerse(VULGATE_EDITION, 'LAM', 1, PROLOGUE_VERSE)).toContainEqual(['Prologus', '']);
    expect(await corpus.getVerse(VULGATE_EDITION, 'LAM', 1, 1)).toEqual([
      ['Quomodo', ''],
      ['sedet', ''],
      ['civitas', ''],
    ]);
    expect(await corpus.getVerse(VULGATE_EDITION, 'RV', 1, 1)).toEqual([
      ['Verbum', ''],
      ['libri', ''],
      ['Apc.', ''],
    ]);
    expect((await corpus.editions()).length).toBe(1);
    expect(await readdir(corpusRoot)).toEqual([VULGATE_EDITION]);

    expect(await listLicences(corpusRoot)).toEqual([{ edition: VULGATE_EDITION, ...vulgateSource(archive) }]);
    const licence = await readFile(join(corpusRoot, VULGATE_EDITION, 'LICENSE.md'), 'utf8');
    expect(licence).toContain(`> ${LICENCE_STATEMENT}`);
    expect(licence).toContain('# Synthetic upstream README\n\nFor tests.\n');
    expect(licence).not.toContain('\r');
  });

  it('re-runs byte-identically from the cache and removes stale files', async () => {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const corpusRoot = join(dir, 'corpus');
    const options = { corpusRoot, cacheDir: join(dir, 'cache'), archive };
    await importClementineVulgate({ ...options, downloader: fakeDownloader({ [testUrl]: bytes }) });
    const first = await treeHash(corpusRoot);
    await writeFile(join(corpusRoot, VULGATE_EDITION, 'MT', '99.json'), '{}\n');
    const offline = fakeDownloader({});
    await importClementineVulgate({ ...options, downloader: offline });
    expect(offline.requests).toEqual([]);
    expect(await treeHash(corpusRoot)).toBe(first);
  });

  it('downloads the pinned archive by default and refuses a mismatching hash', async () => {
    const dir = await tempDir();
    const downloader = fakeDownloader({ [CLEMENTINE_VULGATE.url]: new TextEncoder().encode('not the archive') });
    await expect(
      importClementineVulgate({ downloader, corpusRoot: join(dir, 'corpus'), cacheDir: join(dir, 'cache') }),
    ).rejects.toThrow(/sha256 mismatch/);
    expect(downloader.requests).toEqual([CLEMENTINE_VULGATE.url]);
    await expect(stat(join(dir, 'corpus'))).rejects.toThrow(/ENOENT/);
  });

  it.each([
    ['a missing book', (files: Map<string, Uint8Array>) => files.delete('Ps.lat'), 'missing upstream book file(s): Ps'],
    [
      'an unexpected book',
      (files: Map<string, Uint8Array>) => files.set('3Esr.lat', cp1252('1:1 A\r\n')),
      'unexpected upstream book file(s): 3Esr',
    ],
    [
      'a malformed book',
      (files: Map<string, Uint8Array>) => files.set('Gn.lat', cp1252('x\r\n')),
      'Gn.lat:1: expected "<chapter>:<verse> <text>"',
    ],
  ])('refuses an archive with %s and leaves the corpus untouched', async (_what, edit, message) => {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir, edit);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const corpusRoot = join(dir, 'corpus');
    await mkdir(join(corpusRoot, VULGATE_EDITION), { recursive: true });
    await writeFile(join(corpusRoot, VULGATE_EDITION, 'keep.txt'), 'kept');
    await expect(
      importClementineVulgate({
        downloader: fakeDownloader({ [testUrl]: bytes }),
        corpusRoot,
        cacheDir: join(dir, 'cache'),
        archive,
      }),
    ).rejects.toThrow(new CorpusError(message));
    expect(await readFile(join(corpusRoot, VULGATE_EDITION, 'keep.txt'), 'utf8')).toBe('kept');
  });
});

describe('importClementineVulgate staging and swap', () => {
  async function setup(edit?: (files: Map<string, Uint8Array>) => void) {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir, edit);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const corpusRoot = join(dir, 'corpus');
    const base = {
      corpusRoot,
      cacheDir: join(dir, 'cache'),
      archive,
      downloader: fakeDownloader({ [testUrl]: bytes }),
    };
    return { corpusRoot, base };
  }
  async function oldEdition(corpusRoot: string): Promise<void> {
    await mkdir(join(corpusRoot, VULGATE_EDITION), { recursive: true });
    await writeFile(join(corpusRoot, VULGATE_EDITION, 'old.txt'), 'old');
  }
  const failing = (failOn: number, code = 'EXDEV') => {
    let calls = 0;
    return async (from: string, to: string) => {
      calls += 1;
      if (calls === failOn) throw Object.assign(new Error(`rename failed (${code})`), { code });
      const { rename } = await import('node:fs/promises');
      await rename(from, to);
    };
  };

  it('replaces an existing edition and leaves no staging directory', async () => {
    const { corpusRoot, base } = await setup();
    await oldEdition(corpusRoot);
    await importClementineVulgate(base);
    await expect(stat(join(corpusRoot, VULGATE_EDITION, 'old.txt'))).rejects.toThrow(/ENOENT/);
    expect(await readdir(corpusRoot)).toEqual([VULGATE_EDITION]);
  });

  it('restores the previous edition when the swap fails', async () => {
    const { corpusRoot, base } = await setup();
    await oldEdition(corpusRoot);
    await expect(importClementineVulgate({ ...base, renameDir: failing(2) })).rejects.toThrow('rename failed');
    expect(await readFile(join(corpusRoot, VULGATE_EDITION, 'old.txt'), 'utf8')).toBe('old');
    expect(await readdir(corpusRoot)).toEqual([VULGATE_EDITION]);
  });

  it('keeps the previous edition when moving it aside fails', async () => {
    const { corpusRoot, base } = await setup();
    await oldEdition(corpusRoot);
    await expect(importClementineVulgate({ ...base, renameDir: failing(1, 'EACCES') })).rejects.toThrow(
      'rename failed',
    );
    expect(await readFile(join(corpusRoot, VULGATE_EDITION, 'old.txt'), 'utf8')).toBe('old');
    expect(await readdir(corpusRoot)).toEqual([VULGATE_EDITION]);
  });

  it('leaves nothing behind when the swap fails without a previous edition', async () => {
    const { corpusRoot, base } = await setup();
    await expect(importClementineVulgate({ ...base, renameDir: failing(2) })).rejects.toThrow('rename failed');
    expect(await readdir(corpusRoot)).toEqual([]);
  });

  it('refuses an archive without a README.md as a corpus error', async () => {
    const { corpusRoot, base } = await setup((files) => files.delete('README.md'));
    await oldEdition(corpusRoot);
    await expect(importClementineVulgate(base)).rejects.toThrow(new CorpusError('upstream archive has no README.md'));
    expect(await readFile(join(corpusRoot, VULGATE_EDITION, 'old.txt'), 'utf8')).toBe('old');
  });

  it('rethrows other README read errors', async () => {
    const { base } = await setup((files) => {
      files.delete('README.md');
      files.set('README.md/inner', new Uint8Array());
    });
    await expect(importClementineVulgate(base)).rejects.toThrow(/EISDIR/);
  });
});

describe('fetchDownloader', () => {
  it('throws a CorpusError when reading the body fails', async () => {
    const truncated = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.reject(new Error('aborted')),
    })) as unknown as typeof fetch;
    await expect(fetchDownloader(truncated).fetchBytes(testUrl)).rejects.toThrow(
      new CorpusError(`GET ${testUrl}: reading the body failed: aborted`),
    );
  });

  it('returns the response bytes (global fetch by default)', async () => {
    server.use(http.get(testUrl, () => HttpResponse.arrayBuffer(Uint8Array.from([1, 2, 3]).buffer)));
    expect(await fetchDownloader().fetchBytes(testUrl)).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('throws a CorpusError on an HTTP error status', async () => {
    server.use(http.get(testUrl, () => new HttpResponse(null, { status: 404 })));
    await expect(fetchDownloader().fetchBytes(testUrl)).rejects.toThrow(new CorpusError(`GET ${testUrl}: HTTP 404`));
  });

  it('throws a CorpusError on a network error', async () => {
    server.use(http.get(testUrl, () => HttpResponse.error()));
    await expect(fetchDownloader().fetchBytes(testUrl)).rejects.toThrow(CorpusError);
    const rejecting = (() => Promise.reject('offline')) as unknown as typeof fetch;
    await expect(fetchDownloader(rejecting).fetchBytes(testUrl)).rejects.toThrow(
      new CorpusError(`GET ${testUrl}: offline`),
    );
  });
});

describe('runImportVulgate', () => {
  it('imports and prints a summary, caching the archive in .cache/corpus next to the corpus root', async () => {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const corpusRoot = join(dir, 'corpus');
    const { out, err, io } = capture();
    const downloader = fakeDownloader({ [testUrl]: bytes });
    expect(await runImportVulgate(corpusRoot, io, { downloader, archive })).toBe(0);
    expect(out).toEqual([
      `${VULGATE_EDITION}: 73 books, 73 chapters, 75 verses written to ${join(corpusRoot, VULGATE_EDITION)}`,
    ]);
    expect(err).toEqual([]);
    expect(await stat(join(dir, '.cache', 'corpus', 'clementine-vulgate-test-1.tar.gz'))).toBeTruthy();
  });

  it('reports corpus errors with exit code 2 and rethrows anything else', async () => {
    const dir = await tempDir();
    const { out, err, io } = capture();
    const offline: Downloader = {
      fetchBytes: async () => {
        throw new CorpusError('offline');
      },
    };
    expect(await runImportVulgate(join(dir, 'corpus'), io, { downloader: offline })).toBe(2);
    expect(err).toEqual(['offline']);
    expect(out).toEqual([]);
    const broken: Downloader = {
      fetchBytes: async () => {
        throw new TypeError('bug');
      },
    };
    await expect(runImportVulgate(join(dir, 'corpus'), io, { downloader: broken })).rejects.toThrow(TypeError);
  });

  it('downloads the pinned archive with fetch by default', async () => {
    const dir = await tempDir();
    server.use(http.get(CLEMENTINE_VULGATE.url, () => new HttpResponse(null, { status: 503 })));
    const { err, io } = capture();
    expect(await runImportVulgate(join(dir, 'corpus'), io)).toBe(2);
    expect(err).toEqual([`GET ${CLEMENTINE_VULGATE.url}: HTTP 503`]);
  });
});
