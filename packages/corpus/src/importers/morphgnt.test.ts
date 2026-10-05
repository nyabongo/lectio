import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { server } from '@lectio/shared/test-server';
import { http, HttpResponse } from 'msw';
import { c as createTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import { openCorpus } from '../corpus.ts';
import { CorpusError } from '../format.ts';
import { sha256Hex } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import {
  fetchDownloader,
  importMorphgntTree,
  importSblgnt,
  MORPHGNT_BOOK_CODES,
  MORPHGNT_SBLGNT_ARCHIVE,
  MORPHGNT_SBLGNT_COMMIT,
  morphgntBookCode,
  parseMorphgntBook,
  parseMorphgntLine,
  readUpstreamStatements,
  runImportGreek,
  SBLGNT_EDITION,
  sblgntLicenceMarkdown,
  sblgntSource,
} from './morphgnt.ts';

const fixtureDir = fileURLToPath(new URL('./fixtures/morphgnt', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-morphgnt-test-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const LINE = '012015 A- ----NSM- πονηρός πονηρός πονηρός πονηρός';

/** An upstream-style tree: the fixture README and Matthew snippet, plus a one-word file for every other book. */
async function upstreamTree(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'README.md'), await readFile(join(fixtureDir, 'README.md')));
  await writeFile(join(dir, '61-Mt-morphgnt.txt'), await readFile(join(fixtureDir, '61-Mt-morphgnt.txt')));
  for (let book = 2; book <= 27; book += 1) {
    const bb = String(book).padStart(2, '0');
    await writeFile(join(dir, `${60 + book}-B${bb}-morphgnt.txt`), `${bb}0101 N- ----NSM- λόγος λόγος λόγος λόγος\n`);
  }
  return dir;
}

/** The tree packed like a GitHub archive (`sblgnt-<commit>/…`), with its pin. */
async function upstreamArchive(): Promise<{ bytes: Uint8Array; archive: PinnedArchive }> {
  const dir = await tempDir();
  await upstreamTree(join(dir, 'src', 'sblgnt-test'));
  const file = join(dir, 'upstream.tar.gz');
  await createTar({ gzip: true, file, cwd: join(dir, 'src'), portable: true }, ['sblgnt-test']);
  const bytes = new Uint8Array(await readFile(file));
  return { bytes, archive: { url: 'https://example.test/sblgnt.tar.gz', sha256: sha256Hex(bytes) } };
}

function fakeDownloader(files: Record<string, Uint8Array>): Downloader & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async fetchBytes(url) {
      requests.push(url);
      const bytes = files[url];
      if (bytes === undefined) throw new CorpusError(`404 ${url}`);
      return bytes;
    },
  };
}

/** Every file under `dir` (relative path → contents). */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  const contents = await Promise.all(
    files.map(async (file) => [file.slice(dir.length + 1), await readFile(file, 'utf8')]),
  );
  return Object.fromEntries(contents);
}

describe('book numbers', () => {
  it('maps the 27 MorphGNT books to L-005 codes in order', () => {
    expect(MORPHGNT_BOOK_CODES).toHaveLength(27);
    expect(morphgntBookCode(1)).toBe('MT');
    expect(morphgntBookCode(5)).toBe('ACTS');
    expect(morphgntBookCode(18)).toBe('PHLM');
    expect(morphgntBookCode(26)).toBe('JUDE');
    expect(morphgntBookCode(27)).toBe('RV');
  });

  it('rejects numbers outside 1–27', () => {
    for (const n of [0, 28, 1.5, Number.NaN]) {
      expect(() => morphgntBookCode(n)).toThrow(CorpusError);
    }
  });
});

describe('parseMorphgntLine', () => {
  it('keeps the text with punctuation, the lemma and "<pos> <parse>"', () => {
    expect(parseMorphgntLine(LINE, 'x')).toEqual({
      book: 1,
      chapter: 20,
      verse: 15,
      token: ['πονηρός', 'πονηρός', 'A- ----NSM-'],
    });
    expect(parseMorphgntLine('012013 N- ----VSM- Ἑταῖρε, Ἑταῖρε ἑταῖρε ἑταῖρος', 'x').token).toEqual([
      'Ἑταῖρε,',
      'ἑταῖρος',
      'N- ----VSM-',
    ]);
  });

  it('rejects malformed lines, naming where', () => {
    const shape = /^f:3: expected "BBCCVV pos parse text word normalized lemma"$/;
    expect(() => parseMorphgntLine('012015 A- ----NSM- πονηρός', 'f:3')).toThrow(shape);
    expect(() => parseMorphgntLine(`${LINE} extra`, 'f:3')).toThrow(shape);
    expect(() => parseMorphgntLine(LINE.replace('012015', '1215'), 'f:3')).toThrow(shape);
    expect(() => parseMorphgntLine(LINE.replace(' πονηρός', '  '), 'f:3')).toThrow(shape);
    expect(() => parseMorphgntLine(LINE.replace('012015', '010015'), 'f:3')).toThrow('f:3: invalid reference 010015');
    expect(() => parseMorphgntLine(LINE.replace('012015', '012000'), 'f:3')).toThrow('invalid reference');
    expect(() => parseMorphgntLine(LINE.replace('A-', 'a-'), 'f:3')).toThrow(
      'f:3: invalid part of speech or parsing code "a- ----NSM-"',
    );
    expect(() => parseMorphgntLine(LINE.replace('----NSM-', 'NSM'), 'f:3')).toThrow('invalid part of speech');
  });
});

describe('parseMorphgntBook', () => {
  it('groups words by chapter and verse, ignoring blank lines and CR', () => {
    const text = `${LINE}\r\n012015 RA ----NSM- ὁ ὁ ὁ ὁ\n\n012101 C- -------- Καὶ Καὶ καί καί\n`;
    const chapters = parseMorphgntBook(text, 1, 'Mt');
    expect([...chapters.keys()]).toEqual([20, 21]);
    expect(chapters.get(20)?.['15']).toHaveLength(2);
    expect(chapters.get(21)?.['1']?.[0]).toEqual(['Καὶ', 'καί', 'C- --------']);
  });

  it('rejects a word of another book and an empty file', () => {
    expect(() => parseMorphgntBook(`${LINE}\n${LINE.replace('01', '02')}`, 1, 'Mt')).toThrow(
      'Mt:2: book 2 in the file of book 1',
    );
    expect(() => parseMorphgntBook('\n', 1, 'Mt')).toThrow('Mt: no words');
  });
});

describe('upstream statements', () => {
  it('extracts the licence statement and the citation verbatim', async () => {
    const statements = readUpstreamStatements(await readFile(join(fixtureDir, 'README.md'), 'utf8'));
    expect(statements.licence).toBe(
      'The SBLGNT text itself is subject to the [SBLGNT EULA](http://sblgnt.com/license/)\n' +
        'and the morphological parsing and lemmatization is made available under a\n' +
        '[CC-BY-SA License](http://creativecommons.org/licenses/by-sa/3.0/).',
    );
    expect(statements.citation).toMatch(/^Tauber, J\. K\., ed\. \(2017\) _MorphGNT: SBLGNT Edition_\./);
    expect(readUpstreamStatements(`x\r\n\r\nThe SBLGNT text itself a\r\nb\r\n\r\nTauber, J. K. c`)).toEqual({
      licence: 'The SBLGNT text itself a\nb',
      citation: 'Tauber, J. K. c',
    });
  });

  it('fails when the upstream README no longer has them', () => {
    expect(() => readUpstreamStatements('Tauber, J. K.')).toThrow(
      'upstream README.md: the licence statement not found',
    );
    expect(() => readUpstreamStatements('The SBLGNT text itself')).toThrow('the "How to cite" text not found');
  });

  it('builds SOURCE.json and LICENSE.md from them', () => {
    const statements = { licence: 'Line one\n\nline two', citation: 'Cite me' };
    const source = sblgntSource(MORPHGNT_SBLGNT_ARCHIVE, MORPHGNT_SBLGNT_COMMIT, statements);
    expect(source).toMatchObject({ language: 'grc', licence: 'CC-BY-4.0 AND CC-BY-SA-3.0', versification: 'original' });
    expect(source.attribution).toContain('Society of Biblical Literature');
    expect(source.attribution.endsWith('Cite me')).toBe(true);
    const licence = sblgntLicenceMarkdown(MORPHGNT_SBLGNT_ARCHIVE, MORPHGNT_SBLGNT_COMMIT, statements);
    expect(licence).toContain('> Line one\n>\n> line two');
    expect(licence).toContain('ShareAlike');
    expect(licence).toContain(MORPHGNT_SBLGNT_ARCHIVE.sha256);
  });
});

describe('importSblgnt', () => {
  it('downloads, verifies, unpacks and imports; the words of Mt 20:13 and 20:15 are found', async () => {
    const { bytes, archive } = await upstreamArchive();
    const dir = await tempDir();
    const root = join(dir, 'corpus');
    const downloader = fakeDownloader({ [archive.url]: bytes });
    const stats = await importSblgnt({ downloader, root, cacheDir: join(dir, 'cache'), archive, commit: 'c0ffee' });
    expect(stats).toEqual({ books: 27, chapters: 27, verses: 28, words: 59 });
    const corpus = openCorpus(root);
    expect(await corpus.editions()).toEqual([SBLGNT_EDITION]);
    expect(await corpus.source(SBLGNT_EDITION)).toMatchObject({ version: 'c0ffee', sha256: archive.sha256 });
    for (const word of ['ὀφθαλμός', 'πονηρός', 'ἀγαθός']) {
      expect((await corpus.findWord(SBLGNT_EDITION, 'MT', 20, 15, word)).matches).toHaveLength(1);
    }
    expect((await corpus.findWord(SBLGNT_EDITION, 'MT', 20, 13, 'ἑταῖρε', { match: 'surface' })).matches).toHaveLength(
      1,
    );
    expect(await corpus.getVerse(SBLGNT_EDITION, 'RV', 1, 1)).toEqual([['λόγος', 'λόγος', 'N- ----NSM-']]);
    const licence = await readFile(join(root, SBLGNT_EDITION, 'LICENSE.md'), 'utf8');
    expect(licence).toContain('> The SBLGNT text itself is subject to the [SBLGNT EULA](http://sblgnt.com/license/)');
  });

  it('is byte-identical when re-run, reuses the cached archive and drops stale files', async () => {
    const { bytes, archive } = await upstreamArchive();
    const dir = await tempDir();
    const root = join(dir, 'corpus');
    const downloader = fakeDownloader({ [archive.url]: bytes });
    const options = { downloader, root, cacheDir: join(dir, 'cache'), archive, commit: 'c0ffee' };
    await importSblgnt(options);
    const first = await snapshot(root);
    await writeFile(join(root, SBLGNT_EDITION, 'MT', '99.json'), '{}\n');
    await importSblgnt(options);
    expect(await snapshot(root)).toEqual(first);
    expect(downloader.requests).toEqual([archive.url]);
  });

  it('refuses an archive whose sha256 does not match, leaving the corpus untouched', async () => {
    const { bytes, archive } = await upstreamArchive();
    const dir = await tempDir();
    const downloader = fakeDownloader({ [archive.url]: bytes });
    const pin = { ...archive, sha256: '0'.repeat(64) };
    await expect(importSblgnt({ downloader, root: join(dir, 'corpus'), cacheDir: dir, archive: pin })).rejects.toThrow(
      /sha256 mismatch/,
    );
    await expect(stat(join(dir, 'corpus'))).rejects.toThrow(/ENOENT/);
  });
});

describe('importMorphgntTree', () => {
  const options = { archive: MORPHGNT_SBLGNT_ARCHIVE, commit: MORPHGNT_SBLGNT_COMMIT };

  it('validates everything before replacing the edition', async () => {
    const dir = await tempDir();
    const tree = await upstreamTree(join(dir, 'tree'));
    const root = join(dir, 'corpus');
    await importMorphgntTree(tree, root, options);
    const before = await snapshot(root);
    await writeFile(join(tree, '87-B27-morphgnt.txt'), 'garbage\n');
    await expect(importMorphgntTree(tree, root, options)).rejects.toThrow('87-B27-morphgnt.txt:1: expected');
    expect(await snapshot(root)).toEqual(before);
  });

  it('requires exactly one file for each of the 27 books', async () => {
    const dir = await tempDir();
    const tree = await upstreamTree(join(dir, 'tree'));
    const root = join(dir, 'corpus');
    await writeFile(join(tree, 'notes.txt'), 'ignored');
    await writeFile(join(tree, '62-Mark-morphgnt.txt'), '020101 N- ----NSM- λόγος λόγος λόγος λόγος\n');
    await expect(importMorphgntTree(tree, root, options)).rejects.toThrow(
      'two upstream files for MorphGNT book 2: 62-Mark-morphgnt.txt',
    );
    await rm(join(tree, '62-Mark-morphgnt.txt'));
    await rm(join(tree, '62-B02-morphgnt.txt'));
    await rm(join(tree, '87-B27-morphgnt.txt'));
    await expect(importMorphgntTree(tree, root, options)).rejects.toThrow('upstream book file(s) missing for MK, RV');
    await writeFile(join(tree, '40-Mt-morphgnt.txt'), '');
    await expect(importMorphgntTree(tree, root, options)).rejects.toThrow('unknown MorphGNT book number: -20');
  });
});

describe('fetchDownloader', () => {
  it('returns the response bytes through global fetch', async () => {
    server.use(
      http.get('https://example.test/a.tar.gz', () => HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer)),
    );
    expect(await fetchDownloader().fetchBytes('https://example.test/a.tar.gz')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('throws a CorpusError on an HTTP error, with an injected fetch too', async () => {
    server.use(http.get('https://example.test/missing', () => new HttpResponse(null, { status: 404 })));
    await expect(fetchDownloader().fetchBytes('https://example.test/missing')).rejects.toThrow(
      'GET https://example.test/missing: HTTP 404',
    );
    const fake = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    await expect(fetchDownloader(fake).fetchBytes('u')).rejects.toThrow('GET u: HTTP 500');
  });
});

describe('runImportGreek', () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
  }

  it('imports into LECTIO_CORPUS_ROOT and caches the archive beside it', async () => {
    const { bytes, archive } = await upstreamArchive();
    const dir = await tempDir();
    const { out, err, io } = capture();
    const downloader = fakeDownloader({ [archive.url]: bytes });
    const env = { LECTIO_CORPUS_ROOT: join(dir, 'corpus') };
    expect(await runImportGreek(env, dir, io, { downloader, archive, commit: 'c0ffee' })).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual([
      `grc-sblgnt: 27 books, 27 chapters, 28 verses, 59 words → ${join(dir, 'corpus', 'grc-sblgnt')}`,
    ]);
    expect((await stat(join(dir, '.cache', 'corpus', 'morphgnt-sblgnt-c0ffee.tar.gz'))).isFile()).toBe(true);
  });

  it('downloads the pinned archive with fetch and exits 1 on a corpus error', async () => {
    server.use(http.get(MORPHGNT_SBLGNT_ARCHIVE.url, () => HttpResponse.text('not the archive')));
    const dir = await tempDir();
    const { err, io } = capture();
    expect(await runImportGreek({ LECTIO_CORPUS_ROOT: join(dir, 'corpus') }, dir, io)).toBe(1);
    expect(err[0]).toMatch(/^sha256 mismatch for https:\/\/github\.com\/morphgnt\/sblgnt\/archive\//);
  });

  it('rethrows unexpected errors', async () => {
    const dir = await tempDir();
    const downloader: Downloader = {
      fetchBytes: () => Promise.reject(new TypeError('network down')),
    };
    await expect(
      runImportGreek({ LECTIO_CORPUS_ROOT: join(dir, 'c') }, dir, capture().io, { downloader }),
    ).rejects.toThrow('network down');
  });
});

describe('the committed corpus/grc-sblgnt', () => {
  const root = join(repoRoot, 'corpus');

  it('is the pinned upstream: 27 books and 260 chapters', async () => {
    const source = await openCorpus(root).source(SBLGNT_EDITION);
    expect(source).toMatchObject({ version: MORPHGNT_SBLGNT_COMMIT, sha256: MORPHGNT_SBLGNT_ARCHIVE.sha256 });
    const entries = await readdir(join(root, SBLGNT_EDITION), { withFileTypes: true });
    const books = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(books.sort()).toEqual([...MORPHGNT_BOOK_CODES].sort());
    const chapters = await Promise.all(
      books.map(async (book) => (await readdir(join(root, SBLGNT_EDITION, book))).length),
    );
    expect(chapters.reduce((sum, n) => sum + n, 0)).toBe(260);
  });

  it('has ὀφθαλμός, πονηρός and ἀγαθός in Mt 20:15 and ἑταῖρε in Mt 20:13', async () => {
    const corpus = openCorpus(root);
    for (const word of ['ὀφθαλμός', 'πονηρός', 'ἀγαθός']) {
      expect((await corpus.findWord(SBLGNT_EDITION, 'MT', 20, 15, word)).matches).toHaveLength(1);
    }
    expect((await corpus.findWord(SBLGNT_EDITION, 'MT', 20, 13, 'ἑταῖρε')).matches).toHaveLength(1);
  });
});
