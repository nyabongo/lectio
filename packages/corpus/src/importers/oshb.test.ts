import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOKS } from '@lectio/refs';
import { c as createTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import { openCorpus } from '../corpus.ts';
import { CorpusError } from '../format.ts';
import type { Token } from '../format.ts';
import { sha256Hex } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import {
  bookCodeForOsis,
  importOshb,
  OSHB_ARCHIVE,
  OSHB_BOOK_IDS,
  OSHB_COMMIT,
  OSHB_EDITION,
  oshbSource,
  parseOsisBook,
  runImportHebrew,
} from './oshb.ts';

const fixtures = fileURLToPath(new URL('./fixtures/oshb', import.meta.url));
const repoCorpus = fileURLToPath(new URL('../../../../corpus', import.meta.url));

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-oshb-test-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * OSHB stores its pointing in the codex's mark order, not in Unicode normal form; this file's literals are NFC, so
 * pointed strings are compared after NFC on both sides (the normalisers make matching order-insensitive anyway).
 */
function nfc(token: Token | undefined): (string | undefined)[] | undefined {
  return token?.map((part) => part?.normalize('NFC'));
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

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

/** A one-verse book file for the books the fixtures do not cover. */
function minimalBook(osis: string): string {
  return `<osis><osisText><div type="book" osisID="${osis}"><chapter osisID="${osis}.1"><verse osisID="${osis}.1.1"><w lemma="7225" morph="HNcfsa">ראשית</w></verse></chapter></div></osisText></osis>`;
}

interface ArchiveOptions {
  readonly omit?: string;
  readonly licence?: boolean;
}

/** Builds a morphhb-shaped archive (`morphhb-test/wlc/<osis>.xml`, `morphhb-test/LICENSE.md`). */
async function fixtureArchive(options: ArchiveOptions = {}): Promise<{ archive: PinnedArchive; bytes: Uint8Array }> {
  const dir = await tempDir();
  const wlc = join(dir, 'src', 'morphhb-test', 'wlc');
  await mkdir(wlc, { recursive: true });
  for (const osis of OSHB_BOOK_IDS) {
    if (osis === options.omit) continue;
    const xml =
      osis === 'Deut' || osis === 'Prov' ? await readFile(join(fixtures, `${osis}.xml`), 'utf8') : minimalBook(osis);
    await writeFile(join(wlc, `${osis}.xml`), xml);
  }
  await writeFile(join(wlc, 'VerseMap.xml'), '<verseMap/>');
  if (options.licence !== false) {
    await writeFile(join(dir, 'src', 'morphhb-test', 'LICENSE.md'), '# Test licence\n\nCC BY 4.0 (fixture).');
  }
  const file = join(dir, 'morphhb-test.tar.gz');
  await createTar({ gzip: true, file, cwd: join(dir, 'src'), portable: true }, ['morphhb-test']);
  const bytes = new Uint8Array(await readFile(file));
  return { archive: { url: 'https://example.test/morphhb-test.tar.gz', sha256: sha256Hex(bytes) }, bytes };
}

async function treeHash(dir: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (path: string): Promise<void> => {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else {
        hash
          .update(child.slice(dir.length))
          .update('\0')
          .update(await readFile(child));
      }
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

describe('bookCodeForOsis', () => {
  it('maps the 39 OSHB books to distinct Old Testament codes of the L-005 book table', () => {
    const codes = OSHB_BOOK_IDS.map(bookCodeForOsis);
    expect(new Set(codes).size).toBe(39);
    const ot = new Map(BOOKS.filter((book) => book.testament === 'OT').map((book) => [book.code as string, book]));
    for (const code of codes) expect(ot.get(code)?.languages).toContain('hebrew');
    expect(codes.slice(0, 5)).toEqual(['GN', 'EX', 'LV', 'NM', 'DT']);
    expect(bookCodeForOsis('Song')).toBe('SG');
    expect(bookCodeForOsis('Prov')).toBe('PRV');
  });

  it('rejects ids that are not OSIS book ids', () => {
    expect(() => bookCodeForOsis('Psalm')).toThrow(new CorpusError('unknown OSIS book id: "Psalm"'));
    expect(() => bookCodeForOsis('Nope')).toThrow(CorpusError);
  });
});

describe('parseOsisBook', () => {
  it('reads every word with its OSHB surface, lemma and morphology, keeping "/" separators', async () => {
    const { book, chapters } = parseOsisBook(await readFile(join(fixtures, 'Deut.xml'), 'utf8'), 'Deut');
    expect(book).toBe('DT');
    expect([...chapters.keys()]).toEqual([6, 15]);
    const verse9 = chapters.get(15)?.['9'];
    expect(verse9).toHaveLength(28);
    expect(nfc(verse9?.[14])).toEqual(['וְ/רָעָ֣ה', 'c/7489 a', 'HC/Vqq3fs']);
    expect(nfc(verse9?.[15])).toEqual(['עֵֽינְ/ךָ֗', '5869 a', 'HNcbsc/Sp2ms']);
  });

  it('keeps large letters inside words and drops punctuation segments and notes', async () => {
    const { chapters } = parseOsisBook(await readFile(join(fixtures, 'Deut.xml'), 'utf8'), 'Deut');
    expect(chapters.get(6)?.['4']?.map(([surface]) => surface.normalize('NFC'))).toEqual([
      'שְׁמַ֖ע',
      'יִשְׂרָאֵ֑ל',
      'יְהוָ֥ה',
      'אֱלֹהֵ֖י/נוּ',
      'יְהוָ֥ה',
      'אֶחָֽד',
    ]);
  });

  it('follows a ketiv with its qere, reads a qere without ketiv, and skips alternative and exegesis notes', async () => {
    const { chapters } = parseOsisBook(await readFile(join(fixtures, 'Deut.xml'), 'utf8'), 'Deut');
    expect(chapters.get(15)?.['10']?.map(nfc)).toEqual([
      ['הוצא', '3318', 'HVhv2ms'],
      ['הַיְצֵ֣א', '3318', 'HVhv2ms'],
      ['הַ/נָּ֞ס', 'd/5127', 'HTd/Vqrmsa'],
      ['מִ/בֵּ֥ית', 'm/1004 b', 'HR/Ncmsc'],
      ['וְ/לֹא', 'c/3808', 'HC/Tn'],
      ['יֵרַ֥ע', '7489 a', 'HVqi3ms'],
      ['לְבָבְ', '3824'],
    ]);
  });

  it('gives an empty lemma when the attribute is missing', () => {
    const xml = '<verse osisID="Gen.1.1"><w>ב</w></verse>';
    expect(parseOsisBook(xml, 'Gen').chapters.get(1)).toEqual({ '1': [['ב', '']] });
  });

  it('rejects malformed books', () => {
    expect(() => parseOsisBook('<verse osisID="Gen.1.1"><w/></verse>', 'Gen')).toThrow(
      new CorpusError('Gen.1.1: empty <w>'),
    );
    expect(() => parseOsisBook('<verse osisID="Exod.1.1"></verse>', 'Gen')).toThrow(
      new CorpusError('Gen: unexpected verse id "Exod.1.1"'),
    );
    expect(() => parseOsisBook('<verse osisID="Gen.01.1"></verse>', 'Gen')).toThrow(/unexpected verse id/);
    expect(() => parseOsisBook('<verse></verse>', 'Gen')).toThrow(new CorpusError('Gen: unexpected verse id ""'));
    expect(() => parseOsisBook('<verse osisID="Gen.1.1"/><verse osisID="Gen.1.1"/>', 'Gen')).toThrow(
      new CorpusError('Gen: duplicate verse Gen.1.1'),
    );
    expect(() => parseOsisBook('<osis><div/></osis>', 'Gen')).toThrow(new CorpusError('Gen: no verses found'));
    expect(() => parseOsisBook('<verse osisID="Gen.1.1"/>', 'Genesis')).toThrow(/unknown OSIS book id/);
  });
});

describe('oshbSource', () => {
  it('records the pinned commit, the licences and the attribution the OSHB licence asks for', () => {
    const source = oshbSource(OSHB_ARCHIVE, OSHB_COMMIT);
    expect(source).toMatchObject({
      language: 'hbo',
      version: OSHB_COMMIT,
      upstreamUrl: `https://github.com/openscriptures/morphhb/archive/${OSHB_COMMIT}.tar.gz`,
      licence: 'CC-BY-4.0 AND LicenseRef-PublicDomain',
      versification: 'original',
    });
    expect(source.attribution).toContain(
      'Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb',
    );
    expect(source.attribution).toContain('Westminster Leningrad Codex (public domain)');
  });
});

describe('importOshb', () => {
  it('imports 39 books from the archive, verifiably and byte-identically on a re-run', async () => {
    const { archive, bytes } = await fixtureArchive();
    const root = join(await tempDir(), 'corpus');
    const cacheDir = join(await tempDir(), 'cache');
    const downloader = fakeDownloader({ [archive.url]: bytes });
    const log: string[] = [];

    const summary = await importOshb({ root, cacheDir, downloader, archive, version: 'test', log: (l) => log.push(l) });
    expect(summary).toEqual({ edition: OSHB_EDITION, books: 39, chapters: 40, verses: 41, tokens: 88 });
    expect(log[0]).toBe(`archive: ${archive.url}`);
    expect(log).toContain('DT: 2 chapters');
    expect((await readdir(join(root, OSHB_EDITION))).filter((name) => !name.includes('.'))).toHaveLength(39);
    expect(await readFile(join(root, OSHB_EDITION, 'LICENSE.md'), 'utf8')).toBe(
      '# Test licence\n\nCC BY 4.0 (fixture).\n',
    );

    const first = await treeHash(join(root, OSHB_EDITION));
    await writeFile(join(root, OSHB_EDITION, 'GN', '99.json'), '{}\n');
    await importOshb({ root, cacheDir, downloader, archive, version: 'test' });
    expect(await treeHash(join(root, OSHB_EDITION))).toBe(first);
    expect(await readdir(root)).toEqual([OSHB_EDITION]);
    expect(downloader.requests).toEqual([archive.url]);

    const corpus = openCorpus(root);
    expect(await corpus.source(OSHB_EDITION)).toEqual(oshbSource(archive, 'test'));
    expect((await corpus.findWord(OSHB_EDITION, 'DT', 15, 9, 'עין')).matches).toHaveLength(1);
    expect((await corpus.findWord(OSHB_EDITION, 'DT', 15, 9, 'רעה')).matches).toHaveLength(1);
    expect(await corpus.phraseOccurs(OSHB_EDITION, 'PRV', 28, 22, 'רע עין')).toBe(true);
  });

  it('fails before touching the corpus when the archive is wrong or incomplete', async () => {
    const root = join(await tempDir(), 'corpus');
    const cacheDir = await tempDir();
    const missingBook = await fixtureArchive({ omit: 'Mal' });
    await expect(
      importOshb({
        root,
        cacheDir,
        archive: missingBook.archive,
        downloader: fakeDownloader({ [missingBook.archive.url]: missingBook.bytes }),
      }),
    ).rejects.toThrow(new CorpusError('archive has no wlc/Mal.xml'));
    const noLicence = await fixtureArchive({ licence: false });
    await expect(
      importOshb({
        root,
        cacheDir,
        archive: noLicence.archive,
        downloader: fakeDownloader({ [noLicence.archive.url]: noLicence.bytes }),
      }),
    ).rejects.toThrow(new CorpusError('archive has no LICENSE.md'));
    await expect(
      importOshb({ root, cacheDir, downloader: fakeDownloader({ [OSHB_ARCHIVE.url]: new Uint8Array([0]) }) }),
    ).rejects.toThrow(/sha256 mismatch/);
    await expect(stat(root)).rejects.toThrow(/ENOENT/);
  });
});

describe('runImportHebrew', () => {
  it('imports into LECTIO_CORPUS_ROOT, caches the archive beside it and prints a summary', async () => {
    const dir = await tempDir();
    const { archive, bytes } = await fixtureArchive();
    const { io, out, err } = capture();
    const downloader = fakeDownloader({ [archive.url]: bytes });
    const env = { LECTIO_CORPUS_ROOT: join(dir, 'corpus') };
    expect(await runImportHebrew(env, dir, io, { downloader, archive, version: 'test' })).toBe(0);
    expect(err).toEqual([]);
    expect(out.at(-1)).toBe(
      `hbo-oshb: 39 books, 40 chapters, 41 verses, 88 tokens written to ${join(dir, 'corpus', 'hbo-oshb')}`,
    );
    expect((await stat(join(dir, '.cache', 'corpus', `morphhb-${archive.sha256}.tar.gz`))).isFile()).toBe(true);
  });

  it('downloads the pinned archive with the injected downloader and exits 1 when it does not verify', async () => {
    const dir = await tempDir();
    const downloader = fakeDownloader({ [OSHB_ARCHIVE.url]: new TextEncoder().encode('not the archive') });
    const { io, out, err } = capture();
    expect(await runImportHebrew({ LECTIO_CORPUS_ROOT: join(dir, 'corpus') }, dir, io, { downloader })).toBe(1);
    expect(out).toEqual([`archive: ${OSHB_ARCHIVE.url}`]);
    expect(err[0]).toMatch(/^corpus:import:hebrew failed: sha256 mismatch/);
    await expect(stat(join(dir, 'corpus'))).rejects.toThrow(/ENOENT/);
  });

  it('reports non-Error failures', async () => {
    const dir = await tempDir();
    const { io, err } = capture();
    const downloader: Downloader = { fetchBytes: () => Promise.reject('boom') };
    expect(await runImportHebrew({ LECTIO_CORPUS_ROOT: join(dir, 'corpus') }, dir, io, { downloader })).toBe(1);
    expect(err).toEqual([`corpus:import:hebrew failed: GET ${OSHB_ARCHIVE.url}: boom`]);
    const throwing = {
      out: () => {
        throw 'log failed';
      },
      err: (line: string) => err.push(line),
    };
    expect(await runImportHebrew({ LECTIO_CORPUS_ROOT: join(dir, 'corpus') }, dir, throwing, { downloader })).toBe(1);
    expect(err.at(-1)).toBe('corpus:import:hebrew failed: log failed');
  });
});

describe('committed corpus/hbo-oshb', () => {
  const corpus = openCorpus(repoCorpus);

  it('holds the 39 books of the pinned import with its licence', async () => {
    const entries = await readdir(join(repoCorpus, OSHB_EDITION));
    expect(entries.filter((name) => !name.includes('.')).sort()).toEqual(OSHB_BOOK_IDS.map(bookCodeForOsis).sort());
    expect(await corpus.source(OSHB_EDITION)).toEqual(oshbSource(OSHB_ARCHIVE, OSHB_COMMIT));
    const licence = await readFile(join(repoCorpus, OSHB_EDITION, 'LICENSE.md'), 'utf8');
    expect(licence).toContain('Westminster Leningrad Codex*, which is in the public domain');
    expect(licence).toContain('Creative Commons Attribution 4.0 International (CC BY 4.0)');
  });

  it('finds עין and רעה forms in Deut 15:9 and the phrase רע עין in Prov 28:22', async () => {
    expect((await corpus.findWord(OSHB_EDITION, 'DT', 15, 9, 'עין')).matches.map((m) => nfc(m.token))).toEqual([
      ['עֵֽינְ/ךָ֗', '5869 a', 'HNcbsc/Sp2ms'],
    ]);
    expect((await corpus.findWord(OSHB_EDITION, 'DT', 15, 9, 'רעה')).matches.map((m) => nfc(m.token))).toEqual([
      ['וְ/רָעָ֣ה', 'c/7489 a', 'HC/Vqq3fs'],
    ]);
    expect(await corpus.phraseOccurs(OSHB_EDITION, 'PRV', 28, 22, 'רע עין')).toBe(true);
    expect(await corpus.phraseOccurs(OSHB_EDITION, 'PRV', 28, 22, 'רַע עָיִן', { match: 'surface' })).toBe(true);
  });

  it('uses the original versification (Malachi has 3 chapters, Joel 4)', async () => {
    expect(await corpus.getVerse(OSHB_EDITION, 'MAL', 3, 24)).toBeDefined();
    expect(await corpus.getVerse(OSHB_EDITION, 'MAL', 4, 1)).toBeUndefined();
    expect(await corpus.getVerse(OSHB_EDITION, 'JL', 4, 1)).toBeDefined();
  });
});
