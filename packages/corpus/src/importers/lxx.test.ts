import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

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
  buildLxxBooks,
  DANIEL_ORDER,
  ESTHER_ADDITIONS,
  importLxx,
  LXX_BOOKS,
  LXX_EDITION,
  LXX_VERSE_STARTS,
  lxxSource,
  MERGED_WITH_PREVIOUS,
  parseVersification,
  parseWords,
  placeVerse,
  PROVENANCE_STATEMENT,
  readPiece,
  reversify,
  runImportLxx,
  SIRACH_ORDER,
  splitEstherVerse,
  SWETE_LXX,
  verseTokens,
  VERSIFICATION_FILE,
  WORDS_FILE,
} from './lxx.ts';
import type { LxxBookPart } from './lxx.ts';

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-lxx-test-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Synthetic upstream verses in the upstream layout, written for the tests (made-up Greek, not the edition's text):
 * one verse per imported book plus the cases the importer rearranges.
 */
type Verses = ReadonlyArray<readonly [ref: string, words: readonly string[]]>;
const SYNTHETIC: Verses = [
  ['Gen.1:1', ['ἄλλο', 'βιβλίον.']],
  ['Tbs.1:1', ['λόγος', 'πρῶτος,']],
  ['Tbs.4:7', ['']],
  ['Jdt.1:1', ['ἔτος', 'δωδέκατον.']],
  ['Est.1:1', ['⸂[1]', 'ἀρχὴ', 'ὁράσεως,', '[2]', 'δεύτερος', 'λόγος.⸃', '[18]', 'Καὶ', 'ἐγένετο.']],
  ['Est.3:13', ['κείμενον', '⸂[1]', 'ἐπιστολή.⸃']],
  ['Est.10:3', ['τέλος.', '[1]', 'καὶ', 'εἶπεν.⸃']],
  ['1Ma.1:1', ['πρῶτον', 'βιβλίον.']],
  ['2Ma.1:1', ['δεύτερον', 'βιβλίον.']],
  ['Wis.1:1', ['ἀγαπήσατε', '⸂⸆⸃', 'δικαιοσύνην,']],
  ['Sir.1:1', ['πᾶσα', 'σοφία.']],
  ['Sir.5:15', ['μὴ', 'ἀγνόει,']],
  ['Sir.6:1', ['μὴ', 'γίνου', 'ἐχθρός.']],
  ['Sir.30:24', ['ζῆλος', 'πολύς.', '[13]', 'λαμπρὰ', 'καρδία.']],
  ['Sir.30:25', ['⸂⸆⸃', 'καλαμώμενος', 'ὀπίσω.']],
  ['Sir.34:1', ['ἀγρυπνία', 'πλούτου.']],
  ['Sir.36:16', ['Κἀγὼ', 'ἔσχατος,', 'καὶ', 'κληρονομήσεις.', '⸆']],
  ['Bar.1:1', ['οὗτοι', 'οἱ', 'λόγοι.']],
  ['Epj.1:1', ['ἀντίγραφον', 'ἐπιστολῆς.']],
  ['Dat.1:1', ['ἐν', 'ἔτει', 'τρίτῳ.']],
  ['Dat.3:98', ['εἰρήνη', 'ὑμῖν.']],
  ['Sut.1:1', ['ἀνὴρ', 'ἐν', 'Βαβυλῶνι.']],
  ['Bet.1:1', ['ὁ', 'βασιλεύς.']],
];

/** The two upstream CSV files for `verses`. */
function upstreamFiles(verses: Verses): { versification: string; words: string } {
  const verseLines: string[] = [];
  const wordLines: string[] = [];
  for (const [ref, words] of verses) {
    verseLines.push(`${wordLines.length + 1}\t${ref}`);
    for (const word of words) wordLines.push(`${wordLines.length + 1}\t${word}`);
  }
  return { versification: `${verseLines.join('\n')}\n`, words: `${wordLines.join('\n')}\n` };
}

/** A tiny upstream-style archive (`LXX-Swete-1930-test/…`). */
async function fixtureArchive(
  dir: string,
  edit: (files: Map<string, string>) => void = () => undefined,
  verses: Verses = SYNTHETIC,
): Promise<Uint8Array> {
  const { versification, words } = upstreamFiles(verses);
  const files = new Map<string, string>([
    [VERSIFICATION_FILE, versification],
    [WORDS_FILE, words],
    ['README.md', '# Synthetic upstream README\n\nFor tests.\n'],
    ['LICENSE', 'Synthetic licence text.\n'],
  ]);
  edit(files);
  const top = join(dir, 'src', 'LXX-Swete-1930-test');
  await mkdir(top, { recursive: true });
  for (const [name, text] of files) {
    await mkdir(join(top, name, '..'), { recursive: true });
    await writeFile(join(top, name), text);
  }
  const archive = join(dir, 'upstream.tar.gz');
  await createTar({ gzip: true, file: archive, cwd: join(dir, 'src'), portable: true }, ['LXX-Swete-1930-test']);
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

function build(verses: Verses) {
  const { versification, words } = upstreamFiles(verses);
  return buildLxxBooks(parseVersification(versification), parseWords(words), {});
}

const testUrl = 'https://example.test/lxx.tar.gz';
const part = (upstream: string): LxxBookPart => LXX_BOOKS.find((p) => p.upstream === upstream) as LxxBookPart;

describe('tables', () => {
  it('imports the deuterocanonical books under NABRE book codes', () => {
    expect(LXX_BOOKS.every((p) => isBookCode(p.book))).toBe(true);
    expect([...new Set(LXX_BOOKS.map((p) => p.book))]).toEqual([
      'TB',
      'JDT',
      'EST',
      '1MC',
      '2MC',
      'WIS',
      'SIR',
      'BAR',
      'DN',
    ]);
    expect(new Set(Object.values(ESTHER_ADDITIONS))).toEqual(new Set(['A', 'B', 'C', 'D', 'E', 'F']));
    expect(MERGED_WITH_PREVIOUS.has('SIR 6:1')).toBe(true);
    expect(LXX_VERSE_STARTS['SIR 34']?.[21]).toBe('34:25');
    expect(LXX_VERSE_STARTS['TB 5']?.[23]).toBe('6:1');
    expect(SWETE_LXX.url).toContain(SWETE_LXX.version);
  });

  it('relocates disjoint runs of Sirach and Daniel', () => {
    for (const table of [SIRACH_ORDER, DANIEL_ORDER]) {
      const targets = table.flatMap((r) => Array.from({ length: r.count }, (_, i) => `${r.toC}:${r.toV + i}`));
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

describe('parseVersification and parseWords', () => {
  it('parses the upstream lines (LF or CRLF, with or without a final newline)', () => {
    expect(parseVersification('1\tSir.1:1\r\n4\t1Ma.2:10')).toEqual([
      { start: 1, book: 'Sir', chapter: 1, verse: 1 },
      { start: 4, book: '1Ma', chapter: 2, verse: 10 },
    ]);
    expect(parseWords('1\tλόγος\n2\t\n')).toEqual(['λόγος', '']);
  });

  it.each([
    ['', `${VERSIFICATION_FILE}: no verses`],
    ['1\tSir 1:1\n', `${VERSIFICATION_FILE}:1: expected "<word id>\\t<Book>.<c>:<v>"`],
    ['1\tSir.0:1\n', `${VERSIFICATION_FILE}:1: expected "<word id>\\t<Book>.<c>:<v>"`],
    ['3\tSir.1:1\n3\tSir.1:2\n', `${VERSIFICATION_FILE}:2: word ids must increase`],
  ])('rejects versification %j', (text, message) => {
    expect(() => parseVersification(text)).toThrow(new CorpusError(message));
  });

  it.each([
    ['2\tλόγος\n', `${WORDS_FILE}:1: expected "1\\t<word>"`],
    ['1\tλόγος\nλόγος\n', `${WORDS_FILE}:2: expected "2\\t<word>"`],
  ])('rejects words %j', (text, message) => {
    expect(() => parseWords(text)).toThrow(new CorpusError(message));
  });
});

describe('readPiece and verseTokens', () => {
  it('reads words, bracketed numbers, signs and the end of an addition', () => {
    expect(readPiece('ἀρχὴ')).toEqual({ kind: 'word', surface: 'ἀρχὴ', closes: false });
    expect(readPiece('λόγος.⸃')).toEqual({ kind: 'word', surface: 'λόγος.', closes: true });
    expect(readPiece('⸂[12]')).toEqual({ kind: 'marker', verse: '12', closes: false });
    expect(readPiece('⸂⸆⸃')).toEqual({ kind: 'none', closes: true });
    expect(readPiece('')).toEqual({ kind: 'none', closes: false });
    expect(readPiece('ά')).toEqual({ kind: 'word', surface: 'ά', closes: false });
  });

  it('keeps only words, normalised to NFC', () => {
    expect(verseTokens(['⸂', 'ἀγαπήσατε,⸃', '[3]', '⸆', 'ά'])).toEqual([
      ['ἀγαπήσατε,', ''],
      ['ά', ''],
    ]);
  });
});

describe('splitEstherVerse', () => {
  it('splits the verse from its addition and resumes the verse after ⸃', () => {
    const split = splitEstherVerse(['κείμενον', '⸂[1]', 'α', '[2]', 'β.⸃', '[3]', 'γ'], 'Est.1:1');
    expect(split.base).toEqual([
      ['κείμενον', ''],
      ['γ', ''],
    ]);
    expect([...split.addition]).toEqual([
      ['1', [['α', '']]],
      ['2', [['β.', '']]],
    ]);
  });

  it.each([
    [['α', 'β'], "Est.1:1: expected the addition's bracketed verse numbers"],
    [['[1]', 'α', '[1]', 'β'], 'Est.1:1: addition verse 1 repeated'],
    [['[1]', '[2]', 'β'], 'Est.1:1: addition verse 1 has no words'],
  ])('rejects %j', (words, message) => {
    expect(() => splitEstherVerse(words, 'Est.1:1')).toThrow(new CorpusError(message));
  });
});

describe('placeVerse', () => {
  it('places ordinary verses, one-chapter books and relocated runs', () => {
    expect(placeVerse(part('Jdt'), 2, 3, ['α'], 'w')).toEqual([{ chapter: '2', verse: '3', tokens: [['α', '']] }]);
    expect(placeVerse(part('Epj'), 1, 72, ['α'], 'w')).toEqual([{ chapter: '6', verse: '72', tokens: [['α', '']] }]);
    expect(placeVerse(part('Dat'), 4, 34, ['α'], 'w')[0]).toMatchObject({ chapter: '4', verse: '37' });
    expect(placeVerse(part('Dat'), 6, 28, ['α'], 'w')[0]).toMatchObject({ chapter: '6', verse: '29' });
    expect(placeVerse(part('Dat'), 3, 97, ['α'], 'w')[0]).toMatchObject({ chapter: '3', verse: '97' });
    expect(placeVerse(part('Sir'), 30, 40, ['α'], 'w')[0]).toMatchObject({ chapter: '33', verse: '40' });
    expect(placeVerse(part('Sir'), 36, 17, ['α'], 'w')[0]).toMatchObject({ chapter: '36', verse: '17' });
    expect(placeVerse(part('Est'), 2, 1, ['[1]', 'α'], 'w')).toEqual([
      { chapter: '2', verse: '1', tokens: [['α', '']] },
    ]);
  });

  it.each([
    [part('Sut'), 2, 1, ['α'], 'w: expected a one-chapter book'],
    [part('Sir'), 30, 24, ['α', 'β'], 'w: expected the verse to be split in two'],
    [part('Sir'), 30, 24, ['[13]', 'β'], 'w: expected the verse to be split in two'],
    [part('Sir'), 36, 16, ['α', 'β.'], 'w: expected the verse to be split in two'],
  ])('rejects %#', (p, c, v, words, message) => {
    expect(() => placeVerse(p, c, v, words, 'w')).toThrow(new CorpusError(message));
  });
});

describe('buildLxxBooks', () => {
  it('builds the edition in the lxx scheme', () => {
    const books = build(SYNTHETIC);
    expect([...books.keys()]).toEqual(['TB', 'JDT', 'EST', '1MC', '2MC', 'WIS', 'SIR', 'BAR', 'DN']);
    expect([...(books.get('TB')?.keys() ?? [])]).toEqual(['1']);
    const est = books.get('EST');
    expect(est?.get('A')).toEqual({
      '1': [
        ['ἀρχὴ', ''],
        ['ὁράσεως,', ''],
      ],
      '2': [
        ['δεύτερος', ''],
        ['λόγος.', ''],
      ],
    });
    expect(est?.get('1')).toEqual({
      '1': [
        ['Καὶ', ''],
        ['ἐγένετο.', ''],
      ],
    });
    expect(est?.get('B')).toEqual({ '1': [['ἐπιστολή.', '']] });
    expect(est?.get('F')).toEqual({
      '1': [
        ['καὶ', ''],
        ['εἶπεν.', ''],
      ],
    });
    const sir = books.get('SIR');
    expect(sir?.get('30')).toEqual({
      '24': [
        ['ζῆλος', ''],
        ['πολύς.', ''],
      ],
      '25': [
        ['λαμπρὰ', ''],
        ['καρδία.', ''],
      ],
    });
    expect(sir?.get('33')).toEqual({
      '16': [
        ['Κἀγὼ', ''],
        ['ἔσχατος,', ''],
      ],
      '25': [
        ['καλαμώμενος', ''],
        ['ὀπίσω.', ''],
      ],
    });
    expect(sir?.get('31')).toEqual({
      '1': [
        ['ἀγρυπνία', ''],
        ['πλούτου.', ''],
      ],
    });
    expect(sir?.get('36')).toEqual({
      '16': [
        ['καὶ', ''],
        ['κληρονομήσεις.', ''],
      ],
    });
    expect(books.get('BAR')?.get('6')).toEqual({
      '1': [
        ['ἀντίγραφον', ''],
        ['ἐπιστολῆς.', ''],
      ],
    });
    expect([...(books.get('DN')?.keys() ?? [])]).toEqual(['1', '4', '13', '14']);
    expect(sir?.get('5')).toEqual({
      '15': [
        ['μὴ', ''],
        ['ἀγνόει,', ''],
        ['μὴ', ''],
        ['γίνου', ''],
        ['ἐχθρός.', ''],
      ],
    });
    expect(sir?.has('6')).toBe(false);
  });

  it.each([
    ['a missing book', SYNTHETIC.filter(([ref]) => !ref.startsWith('Bet.')), 'missing upstream book(s): Bet'],
    [
      'a verse outside the lxx scheme',
      [...SYNTHETIC, ['Jdt.16:26', ['α']] as const],
      'JDT 16:26 is not a verse of the lxx scheme',
    ],
    ['a repeated verse', [...SYNTHETIC, ['Jdt.1:1', ['α']] as const], 'Jdt.1:1: JDT 1:1 written twice'],
  ])('refuses %s', (_what, verses, message) => {
    expect(() => build(verses)).toThrow(new CorpusError(message));
  });

  it('refuses a verse whose words run past the end of the word file', () => {
    const verses = parseVersification('1\tJdt.1:1\n5\tGen.1:1\n');
    expect(() => buildLxxBooks(verses, ['α', 'β'])).toThrow(
      new CorpusError(`Jdt.1:1: word ids beyond the end of ${WORDS_FILE}`),
    );
  });
});

describe('reversify', () => {
  const tokens = (...words: string[]) => words.map((w): [string, string] => [w, '']);
  const chapters = (entries: Record<string, Record<string, string[]>>) =>
    new Map(
      Object.entries(entries).map(([c, verses]) => [
        c,
        Object.fromEntries(Object.entries(verses).map(([v, words]) => [v, tokens(...words)])),
      ]),
    );

  it('keeps Swete verses by default and lettered chapters as they are', () => {
    const out = reversify('JDT', chapters({ '1': { '1': ['α'], '2': ['β'] }, A: { '1': ['γ'] } }));
    expect([...out]).toEqual([
      ['1', { '1': tokens('α'), '2': tokens('β') }],
      ['A', { '1': tokens('γ') }],
    ]);
  });

  it('joins and cuts verses where the starts say, across chapters', () => {
    const swete = chapters({
      '1': { '1': ['α', 'β'], '2': ['γ', 'δ', 'ε'] },
      '2': { '1': ['ζ'], '2': ['η', 'θ'] },
    });
    const starts = { 'JDT 1': { 2: '1:2+1', 3: '2:1' }, 'JDT 2': { 1: '2:2', 2: '2:2+1' } };
    const out = reversify('JDT', swete, starts, new Set());
    expect(out.get('1')).toEqual({ '1': tokens('α', 'β', 'γ'), '2': tokens('δ', 'ε'), '3': tokens('ζ') });
    expect(out.get('2')).toEqual({ '1': tokens('η'), '2': tokens('θ') });
  });

  it('merges a listed Swete plus into the verse before and accepts pluses in chapters with starts', () => {
    const swete = chapters({ '16': { '25': ['α'], '26': ['β'] } });
    expect(reversify('JDT', swete, {}, new Set(['JDT 16:26'])).get('16')).toEqual({ '25': tokens('α', 'β') });
    expect(reversify('JDT', swete, { 'JDT 16': {} }, new Set()).get('16')).toEqual({ '25': tokens('α', 'β') });
  });

  it.each([
    [{ 'JDT 1': { 2: '1:3' } }, 'JDT 1:2: no Swete position 1:3'],
    [{ 'JDT 1': { 2: '1:2+2' } }, 'JDT 1:2: no Swete position 1:2+2'],
    [{ 'JDT 1': { 2: 'x' } }, 'JDT 1:2: no Swete position x'],
    [{ 'JDT 1': { 2: '1:1' } }, 'JDT 1:2: starts out of order in the Swete text'],
    [{ 'JDT 1': { 1: '1:1+1' } }, 'JDT 1:1: starts out of order in the Swete text'],
  ])('refuses starts %j', (starts, message) => {
    const swete = chapters({ '1': { '1': ['α', 'β'], '2': ['γ', 'δ'] } });
    expect(() => reversify('JDT', swete, starts, new Set())).toThrow(new CorpusError(message));
  });
});

describe('lxxSource', () => {
  it('records the pinned upstream, the GPL and lxx versification', () => {
    expect(lxxSource(SWETE_LXX)).toMatchObject({
      language: 'grc',
      upstreamUrl: SWETE_LXX.url,
      version: SWETE_LXX.version,
      sha256: SWETE_LXX.sha256,
      licence: 'GPL-3.0-only',
      versification: 'lxx',
    });
  });
});

describe('importLxx', () => {
  async function setup(edit?: (files: Map<string, string>) => void) {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir, edit);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const corpusRoot = join(dir, 'corpus');
    const downloader = fakeDownloader({ [testUrl]: bytes });
    return {
      dir,
      bytes,
      corpusRoot,
      base: { corpusRoot, cacheDir: join(dir, 'cache'), archive, downloader, verseStarts: {} },
    };
  }
  async function oldEdition(corpusRoot: string): Promise<void> {
    await mkdir(join(corpusRoot, LXX_EDITION), { recursive: true });
    await writeFile(join(corpusRoot, LXX_EDITION, 'old.txt'), 'old');
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

  it('imports the books, writes metadata, and corpus:find answers on a Sirach verse', async () => {
    const { dir, corpusRoot, base } = await setup();
    const summary = await importLxx(base);
    expect(summary).toEqual({ edition: LXX_EDITION, books: 9, chapters: 23, verses: 26 });
    expect(await stat(join(dir, 'cache', 'lxx-swete-test-1.tar.gz'))).toBeTruthy();

    const corpus = openCorpus(corpusRoot);
    expect((await corpus.findWord(LXX_EDITION, 'SIR', 1, 1, 'σοφια')).matches).toHaveLength(1);
    expect((await corpus.findWord(LXX_EDITION, 'SIR', 30, 25, 'καρδία')).matches).toHaveLength(1);
    expect((await corpus.findWord(LXX_EDITION, 'EST', 'A', 2, 'λόγος')).matches).toHaveLength(1);
    expect(await corpus.getVerse(LXX_EDITION, 'DN', 13, 1)).toContainEqual(['Βαβυλῶνι.', '']);
    expect(await corpus.getVerse(LXX_EDITION, 'DN', 4, 1)).toEqual([
      ['εἰρήνη', ''],
      ['ὑμῖν.', ''],
    ]);
    expect(await readdir(corpusRoot)).toEqual([LXX_EDITION]);

    expect(await listLicences(corpusRoot)).toEqual([{ edition: LXX_EDITION, ...lxxSource(base.archive) }]);
    const licence = await readFile(join(corpusRoot, LXX_EDITION, 'LICENSE.md'), 'utf8');
    expect(licence).toContain(`> ${PROVENANCE_STATEMENT}`);
    expect(licence).toContain('# Synthetic upstream README\n\nFor tests.\n');
    expect(licence).toContain('```text\nSynthetic licence text.\n```\n');
  });

  it('re-runs byte-identically from the cache and removes stale files', async () => {
    const { corpusRoot, base } = await setup();
    await importLxx(base);
    const first = await treeHash(corpusRoot);
    await writeFile(join(corpusRoot, LXX_EDITION, 'SIR', '99.json'), '{}\n');
    const offline = fakeDownloader({});
    await importLxx({ ...base, downloader: offline });
    expect(offline.requests).toEqual([]);
    expect(await treeHash(corpusRoot)).toBe(first);
  });

  it('downloads the pinned archive by default and refuses a mismatching hash', async () => {
    const dir = await tempDir();
    const downloader = fakeDownloader({ [SWETE_LXX.url]: new TextEncoder().encode('not the archive') });
    await expect(
      importLxx({ downloader, corpusRoot: join(dir, 'corpus'), cacheDir: join(dir, 'cache') }),
    ).rejects.toThrow(/sha256 mismatch/);
    expect(downloader.requests).toEqual([SWETE_LXX.url]);
    await expect(stat(join(dir, 'corpus'))).rejects.toThrow(/ENOENT/);
  });

  it.each([VERSIFICATION_FILE, WORDS_FILE, 'README.md', 'LICENSE'])(
    'refuses an archive without %s and leaves the corpus untouched',
    async (name) => {
      const { corpusRoot, base } = await setup((files) => files.delete(name));
      await oldEdition(corpusRoot);
      await expect(importLxx(base)).rejects.toThrow(new CorpusError(`upstream archive has no ${name}`));
      expect(await readFile(join(corpusRoot, LXX_EDITION, 'old.txt'), 'utf8')).toBe('old');
    },
  );

  it('rethrows other read errors', async () => {
    const { base } = await setup((files) => {
      files.delete('LICENSE');
      files.set('LICENSE/inner', '');
    });
    await expect(importLxx(base)).rejects.toThrow(/EISDIR/);
  });

  it('replaces an existing edition and leaves no staging directory', async () => {
    const { corpusRoot, base } = await setup();
    await oldEdition(corpusRoot);
    await importLxx(base);
    await expect(stat(join(corpusRoot, LXX_EDITION, 'old.txt'))).rejects.toThrow(/ENOENT/);
    expect(await readdir(corpusRoot)).toEqual([LXX_EDITION]);
  });

  it('restores the previous edition when the swap fails', async () => {
    const { corpusRoot, base } = await setup();
    await oldEdition(corpusRoot);
    await expect(importLxx({ ...base, renameDir: failing(2) })).rejects.toThrow('rename failed');
    expect(await readFile(join(corpusRoot, LXX_EDITION, 'old.txt'), 'utf8')).toBe('old');
    expect(await readdir(corpusRoot)).toEqual([LXX_EDITION]);
  });

  it('keeps the previous edition when moving it aside fails', async () => {
    const { corpusRoot, base } = await setup();
    await oldEdition(corpusRoot);
    await expect(importLxx({ ...base, renameDir: failing(1, 'EACCES') })).rejects.toThrow('rename failed');
    expect(await readFile(join(corpusRoot, LXX_EDITION, 'old.txt'), 'utf8')).toBe('old');
  });

  it('leaves nothing behind when the swap fails without a previous edition', async () => {
    const { corpusRoot, base } = await setup();
    await expect(importLxx({ ...base, renameDir: failing(2) })).rejects.toThrow('rename failed');
    expect(await readdir(corpusRoot)).toEqual([]);
  });
});

describe('runImportLxx', () => {
  it('imports and prints a summary, caching the archive in .cache/corpus next to the corpus root', async () => {
    const dir = await tempDir();
    const bytes = await fixtureArchive(dir);
    const archive = { url: testUrl, sha256: sha256Hex(bytes), version: 'test-1' };
    const corpusRoot = join(dir, 'corpus');
    const { out, err, io } = capture();
    const downloader = fakeDownloader({ [testUrl]: bytes });
    expect(await runImportLxx(corpusRoot, io, { downloader, archive, verseStarts: {} })).toBe(0);
    expect(out).toEqual([
      `${LXX_EDITION}: 9 books, 23 chapters, 26 verses written to ${join(corpusRoot, LXX_EDITION)}`,
    ]);
    expect(err).toEqual([]);
    expect(await stat(join(dir, '.cache', 'corpus', 'lxx-swete-test-1.tar.gz'))).toBeTruthy();
  });

  it('reports corpus errors with exit code 2 and rethrows anything else', async () => {
    const dir = await tempDir();
    const { out, err, io } = capture();
    const offline: Downloader = {
      fetchBytes: async () => {
        throw new CorpusError('offline');
      },
    };
    expect(await runImportLxx(join(dir, 'corpus'), io, { downloader: offline })).toBe(2);
    expect(err).toEqual(['offline']);
    expect(out).toEqual([]);
    const broken: Downloader = {
      fetchBytes: async () => {
        throw new TypeError('bug');
      },
    };
    await expect(runImportLxx(join(dir, 'corpus'), io, { downloader: broken })).rejects.toThrow(TypeError);
  });

  it('downloads the pinned archive with fetch by default', async () => {
    const dir = await tempDir();
    server.use(http.get(SWETE_LXX.url, () => new HttpResponse(null, { status: 503 })));
    const { err, io } = capture();
    expect(await runImportLxx(join(dir, 'corpus'), io)).toBe(2);
    expect(err).toEqual([`GET ${SWETE_LXX.url}: HTTP 503`]);
  });
});
