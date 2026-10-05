/**
 * Importer for the deuterocanonical books of Swete's Septuagint (H. B. Swete, The Old Testament in Greek according to
 * the Septuagint, Cambridge 1907–1912, public domain), from Eliran Wong's LXX-Swete-1930 database
 * (https://github.com/eliranwong/LXX-Swete-1930, GNU GPL v3), pinned to one commit and its archive's sha256.
 *
 * Why this digitisation: the First1KGreek TEI of Swete (CC BY-SA 4.0) and the plain-text conversions built from it
 * lose whole passages of these books (Wisdom 3:5-17 and chapter 15, with 15-19 numbered 16-20; the end of Daniel 12
 * and of Bel; a dozen Sirach verses), which would make the evidence gate reject words that are in the text.
 *
 * The upstream format: `00-Swete_versification.csv` has one line per verse, `<first word id>\t<Book>.<c>:<v>`;
 * `01-Swete_word_with_punctuations.csv` has one line per word, `<id>\t<word>` (ids 1, 2, 3…). A verse the edition
 * lacks (Sirach 1:5, Tobit S 4:7-18…) has one empty word. Verses mostly follow Rahlfs' numbering, the `lxx` scheme of
 * `@lectio/refs`: Theodotion's Daniel 3:98–6:28 and Sirach 30:25–36:16 (in the Greek manuscripts' order upstream) are
 * moved into that scheme's order, and the importer checks every verse against it (see OUTSIDE_LXX).
 *
 * Output: `corpus/grc-lxx/<BOOK>/<chapter>.json` under the NABRE book codes of ADR 0004, `lxx` versification:
 * Tobit is the Sinaiticus text (the one the NABRE translates); Daniel is Theodotion's, with Susanna as chapter 13
 * and Bel and the Dragon as chapter 14; the Letter of Jeremiah is Baruch 6. Greek Esther's additions, which lxx.vrs
 * does not number verse by verse, are stored as chapters A–F with the verse numbers the upstream prints in brackets,
 * which are the NABRE's lettered chapters (`EST C 12` is NABRE Esther C:12). Each word keeps its attached
 * punctuation as its surface form and has an empty lemma (the source is not lemmatised); the upstream's text-critical
 * signs (⸂ ⸃ ⸆) and bracketed verse numbers are dropped.
 */
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { isRealVerse } from '@lectio/refs';
import type { BookCode } from '@lectio/refs';

import { CorpusError } from '../format.ts';
import type { ChapterVerses, SourceInfo, Token } from '../format.ts';
import { downloadPinned } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import { unpackTarball, writeChapter, writeEditionMetadata } from '../import/unpack.ts';
import { fetchDownloader } from './vulgate.ts';

export const LXX_EDITION = 'grc-lxx';

const COMMIT = '1d3efc3c63bd384a4f3f07ed37eef54b0d45ac33';

/** The pinned upstream: GitHub's archive of LXX-Swete-1930 at commit 1d3efc3 (2017-06-17, the latest). */
export const SWETE_LXX: PinnedArchive & { readonly version: string } = {
  url: `https://github.com/eliranwong/LXX-Swete-1930/archive/${COMMIT}.tar.gz`,
  sha256: '41574db5b44390680bbc433b95acec74f381731fcb5ca51f9abc49d89f3e55d5',
  version: COMMIT,
};

export const VERSIFICATION_FILE = '00-Swete_versification.csv';
export const WORDS_FILE = '01-Swete_word_with_punctuations.csv';

/** One upstream book and where it goes: a NABRE book code and, for one-chapter books, the chapter it becomes. */
export interface LxxBookPart {
  readonly upstream: string;
  readonly book: BookCode;
  readonly chapter?: number;
}

/** The upstream books imported: the deuterocanonical books and the Greek forms of Esther and Daniel. */
export const LXX_BOOKS: readonly LxxBookPart[] = [
  { upstream: 'Tbs', book: 'TB' },
  { upstream: 'Jdt', book: 'JDT' },
  { upstream: 'Est', book: 'EST' },
  { upstream: '1Ma', book: '1MC' },
  { upstream: '2Ma', book: '2MC' },
  { upstream: 'Wis', book: 'WIS' },
  { upstream: 'Sir', book: 'SIR' },
  { upstream: 'Bar', book: 'BAR' },
  { upstream: 'Epj', book: 'BAR', chapter: 6 },
  { upstream: 'Dat', book: 'DN' },
  { upstream: 'Sut', book: 'DN', chapter: 13 },
  { upstream: 'Bet', book: 'DN', chapter: 14 },
];

/** Greek Esther verses that hold an addition, and the NABRE lettered chapter the addition is stored as. */
export const ESTHER_ADDITIONS: Readonly<Record<string, string>> = {
  '1:1': 'A',
  '3:13': 'B',
  '4:17': 'C',
  '5:1': 'D',
  '5:2': 'D',
  '8:12': 'E',
  '10:3': 'F',
};

/** One line of the versification file: the verse starting at word `start`. */
export interface LxxVerseStart {
  readonly start: number;
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
}

const VERSE_LINE = /^([1-9][0-9]*)\t([1-4]?[A-Z][a-z]+)\.([1-9][0-9]*):([1-9][0-9]*)$/u;
const WORD_LINE = /^([1-9][0-9]*)\t(.*)$/u;

function lines(text: string): string[] {
  const all = text.split(/\r?\n/u);
  if (all.at(-1) === '') all.pop();
  return all;
}

/** Parses the versification file. Word ids must increase; `where` names the file in error messages. */
export function parseVersification(text: string, where = VERSIFICATION_FILE): LxxVerseStart[] {
  const verses: LxxVerseStart[] = [];
  lines(text).forEach((line, index) => {
    const match = VERSE_LINE.exec(line);
    if (match === null) throw new CorpusError(`${where}:${index + 1}: expected "<word id>\\t<Book>.<c>:<v>"`);
    const [, start, book, chapter, verse] = match as unknown as [string, string, string, string, string];
    const entry = { start: Number(start), book, chapter: Number(chapter), verse: Number(verse) };
    const previous = verses.at(-1);
    if (previous !== undefined && entry.start <= previous.start) {
      throw new CorpusError(`${where}:${index + 1}: word ids must increase`);
    }
    verses.push(entry);
  });
  if (verses.length === 0) throw new CorpusError(`${where}: no verses`);
  return verses;
}

/** Parses the word file: word `id` is at index `id - 1`. */
export function parseWords(text: string, where = WORDS_FILE): string[] {
  return lines(text).map((line, index) => {
    const match = WORD_LINE.exec(line);
    if (match === null || Number(match[1]) !== index + 1) {
      throw new CorpusError(`${where}:${index + 1}: expected "${index + 1}\\t<word>"`);
    }
    return match[2] as string;
  });
}

const SIGNS = /[⸂⸃⸆]/gu;
const MARKER = /^\[([1-9][0-9]*)\]$/u;
const LETTER = /\p{L}/u;

/** One upstream word, read: a word, a bracketed verse number, or nothing; `closes` when it ends an addition (⸃). */
export type LxxPiece =
  | { readonly kind: 'word'; readonly surface: string; readonly closes: boolean }
  | { readonly kind: 'marker'; readonly verse: string; readonly closes: boolean }
  | { readonly kind: 'none'; readonly closes: boolean };

export function readPiece(raw: string): LxxPiece {
  const closes = raw.includes('⸃');
  const text = raw.normalize('NFC').replace(SIGNS, '').trim();
  const marker = MARKER.exec(text);
  if (marker !== null) return { kind: 'marker', verse: marker[1] as string, closes };
  if (LETTER.test(text)) return { kind: 'word', surface: text, closes };
  return { kind: 'none', closes };
}

/** Tokens of an ordinary verse: words only (bracketed numbers and signs dropped). */
export function verseTokens(words: readonly string[]): Token[] {
  return words.flatMap((raw): Token[] => {
    const piece = readPiece(raw);
    return piece.kind === 'word' ? [[piece.surface, '']] : [];
  });
}

/** A Greek Esther verse split into its own words and its addition's verses (stored under `letter`). */
export interface EstherSplit {
  readonly base: Token[];
  readonly addition: ReadonlyMap<string, Token[]>;
}

/**
 * Splits an Esther verse that holds an addition: words before the first bracketed number belong to the verse, each
 * `[n]` starts addition verse n, and ⸃ ends the addition; words after it (and their bracketed number, as the `[18]`
 * of 1:1) belong to the verse again.
 */
export function splitEstherVerse(words: readonly string[], where: string): EstherSplit {
  const base: Token[] = [];
  const addition = new Map<string, Token[]>();
  let current: Token[] = base;
  let closed = false;
  for (const raw of words) {
    const piece = readPiece(raw);
    if (piece.kind === 'marker' && !closed) {
      if (addition.has(piece.verse)) throw new CorpusError(`${where}: addition verse ${piece.verse} repeated`);
      current = [];
      addition.set(piece.verse, current);
    } else if (piece.kind === 'word') {
      current.push([piece.surface, '']);
    }
    if (piece.closes) {
      closed = true;
      current = base;
    }
  }
  if (addition.size === 0) throw new CorpusError(`${where}: expected the addition's bracketed verse numbers`);
  for (const [verse, tokens] of addition) {
    if (tokens.length === 0) throw new CorpusError(`${where}: addition verse ${verse} has no words`);
  }
  return { base, addition };
}

/** Where an upstream verse, or part of it, is stored. */
export interface Placement {
  readonly chapter: string;
  readonly verse: string;
  readonly tokens: Token[];
}

/** A run of upstream verses `c:v`…`c:(v + count - 1)` that is stored as `toC:toV`…. */
export interface Relocation {
  readonly c: number;
  readonly v: number;
  readonly count: number;
  readonly toC: number;
  readonly toV: number;
}

/**
 * Sirach 30:25–36:16 is in the Greek manuscripts' order upstream. Swete prints it in the Latin order the `lxx` scheme
 * numbers by (30:24, 30:25 "λαμπρὰ καρδία", 31 "ἀγρυπνία πλούτου", …), keeping his own verse numbers, and so is it
 * stored. The two verses split between places are handled in {@link placeVerse}.
 */
export const SIRACH_ORDER: readonly Relocation[] = [
  { c: 30, v: 25, count: 16, toC: 33, toV: 25 },
  { c: 31, v: 1, count: 31, toC: 34, toV: 1 },
  { c: 32, v: 1, count: 26, toC: 35, toV: 1 },
  { c: 33, v: 1, count: 13, toC: 36, toV: 1 },
  { c: 34, v: 1, count: 31, toC: 31, toV: 1 },
  { c: 35, v: 1, count: 24, toC: 32, toV: 1 },
  { c: 36, v: 1, count: 15, toC: 33, toV: 1 },
];

/**
 * Theodotion's Daniel is numbered upstream as in Hebrew and English Bibles from 3:98 to 6:28; the `lxx` scheme
 * (Rahlfs) starts chapter 4 at Hebrew 3:31 and chapter 6 at Hebrew 5:31.
 */
export const DANIEL_ORDER: readonly Relocation[] = [
  { c: 3, v: 98, count: 3, toC: 4, toV: 1 },
  { c: 4, v: 1, count: 34, toC: 4, toV: 4 },
  { c: 5, v: 31, count: 1, toC: 6, toV: 1 },
  { c: 6, v: 1, count: 28, toC: 6, toV: 2 },
];

/**
 * Verses Swete has that the `lxx` scheme lacks or marks as absent. They are stored under Swete's numbers; any other
 * verse outside the scheme stops the import, so a changed upstream cannot slip through.
 */
export const OUTSIDE_LXX: ReadonlySet<string> = new Set([
  'TB 13:10',
  'EST 9:30',
  'WIS 17:21',
  'SIR 6:1',
  'SIR 17:9',
  'SIR 22:7',
  'SIR 22:8',
  ...[34, 35, 36, 37, 38, 39, 40].map((v) => `SIR 33:${v}`),
  ...[27, 28, 29, 30, 31].map((v) => `SIR 34:${v}`),
  'SIR 35:25',
  'SIR 35:26',
  ...[28, 29, 30, 31].map((v) => `SIR 36:${v}`),
]);

function relocate(table: readonly Relocation[], c: number, v: number): [number, number] {
  const run = table.find((r) => r.c === c && r.v <= v && v < r.v + r.count);
  return run === undefined ? [c, v] : [run.toC, run.toV + v - run.v];
}

function placed(c: number | string, v: number | string, tokens: Token[]): Placement {
  return { chapter: String(c), verse: String(v), tokens };
}

/** Splits `words` before the first piece `isBoundary` accepts (the boundary piece goes to the second part). */
function splitAt(words: readonly string[], isBoundary: (piece: LxxPiece, index: number) => boolean, where: string) {
  const at = words.findIndex((raw, index) => isBoundary(readPiece(raw), index));
  if (at <= 0) throw new CorpusError(`${where}: expected the verse to be split in two`);
  return [verseTokens(words.slice(0, at)), verseTokens(words.slice(at))] as const;
}

/**
 * Where one upstream verse of `part` goes, in the `lxx` scheme: Esther's additions to their lettered chapters, Sirach
 * and Daniel into the scheme's order, one-chapter books into their chapter. Parts without words are left out.
 */
export function placeVerse(
  part: LxxBookPart,
  c: number,
  v: number,
  words: readonly string[],
  where: string,
): Placement[] {
  if (part.chapter !== undefined) {
    if (c !== 1) throw new CorpusError(`${where}: expected a one-chapter book`);
    return [placed(part.chapter, v, verseTokens(words))];
  }
  const letter = part.upstream === 'Est' ? ESTHER_ADDITIONS[`${c}:${v}`] : undefined;
  if (letter !== undefined) {
    const split = splitEstherVerse(words, where);
    return [placed(c, v, split.base), ...[...split.addition].map(([n, tokens]) => placed(letter, n, tokens))];
  }
  if (part.upstream === 'Sir' && c === 30 && v === 24) {
    // "[13]" starts Latin 30:25 (33:13b in the Greek manuscripts' numbering).
    const [first, second] = splitAt(words, (piece) => piece.kind === 'marker' && piece.verse === '13', where);
    return [placed(30, 24, first), placed(30, 25, second)];
  }
  if (part.upstream === 'Sir' && c === 36 && v === 16) {
    // "Κἀγὼ ἔσχατος ἠγρύπνησα," is 33:16a; the rest is 36:16b.
    const [first, second] = splitAt(
      words,
      (_piece, index) => index > 0 && (words[index - 1] as string).endsWith(','),
      where,
    );
    return [placed(33, 16, first), placed(36, 16, second)];
  }
  const table = part.upstream === 'Sir' ? SIRACH_ORDER : part.upstream === 'Dat' ? DANIEL_ORDER : [];
  const [toC, toV] = relocate(table, c, v);
  return [placed(toC, toV, verseTokens(words))];
}

/** The edition being built: book code to chapter (as a string) to verses. */
export type LxxBooks = Map<string, Map<string, Record<string, Token[]>>>;

const NUMBER = /^[1-9][0-9]*$/u;

function put(books: LxxBooks, book: BookCode, at: Placement, where: string): void {
  const label = `${book} ${at.chapter}:${at.verse}`;
  if (NUMBER.test(at.chapter) && !OUTSIDE_LXX.has(label)) {
    if (!isRealVerse({ book, c: Number(at.chapter), v: Number(at.verse) }, 'lxx')) {
      throw new CorpusError(`${where}: ${label} is not a verse of the lxx scheme`);
    }
  }
  const chapters = books.get(book) ?? new Map<string, Record<string, Token[]>>();
  books.set(book, chapters);
  const verses = chapters.get(at.chapter) ?? {};
  chapters.set(at.chapter, verses);
  if (at.verse in verses) throw new CorpusError(`${where}: ${label} written twice`);
  verses[at.verse] = at.tokens;
}

/**
 * Builds the edition from the parsed upstream files. Verses without words are skipped; every other verse must exist
 * in the `lxx` scheme of `@lectio/refs`, be listed in {@link OUTSIDE_LXX}, or be in one of Esther's lettered chapters.
 */
export function buildLxxBooks(verses: readonly LxxVerseStart[], words: readonly string[]): LxxBooks {
  const parts = new Map(LXX_BOOKS.map((part) => [part.upstream, part]));
  const books: LxxBooks = new Map();
  const seen = new Set<string>();
  verses.forEach((entry, index) => {
    const part = parts.get(entry.book);
    if (part === undefined) return;
    seen.add(entry.book);
    const where = `${entry.book}.${entry.chapter}:${entry.verse}`;
    const end = verses[index + 1]?.start ?? words.length + 1;
    if (end - 1 > words.length) throw new CorpusError(`${where}: word ids beyond the end of ${WORDS_FILE}`);
    const raw = words.slice(entry.start - 1, end - 1);
    for (const at of placeVerse(part, entry.chapter, entry.verse, raw, where)) {
      if (at.tokens.length > 0) put(books, part.book, at, where);
    }
  });
  const missing = LXX_BOOKS.filter((part) => !seen.has(part.upstream)).map((part) => part.upstream);
  if (missing.length > 0) throw new CorpusError(`missing upstream book(s): ${missing.join(', ')}`);
  return books;
}

/** Eliran Wong's statement of where the text comes from, verbatim from the upstream README.md. */
export const PROVENANCE_STATEMENT =
  "Source of Swete's text: supplied by Pasquale Amicarelli, prevously copmiled by Pasquale Amicarelli as a " +
  'bibleworks module';

/** The SOURCE.json of the edition. */
export function lxxSource(archive: PinnedArchive & { readonly version: string }): SourceInfo {
  return {
    name: 'Septuagint, deuterocanonical books (Swete, via LXX-Swete-1930)',
    language: 'grc',
    upstreamUrl: archive.url,
    version: archive.version,
    sha256: archive.sha256,
    licence: 'GPL-3.0-only',
    attribution:
      "Greek text of H. B. Swete's The Old Testament in Greek according to the Septuagint (Cambridge, 1907-1912; " +
      'public domain), digitised by Pasquale Amicarelli and published by Eliran Wong in LXX-Swete-1930 ' +
      '(https://github.com/eliranwong/LXX-Swete-1930) under the GNU General Public License v3. Modified for Lectio: ' +
      'deuterocanonical books and Greek Esther and Daniel only, split into words, text-critical signs and bracketed ' +
      'verse numbers removed, Greek Esther additions stored as chapters A-F, the Letter of Jeremiah as Baruch 6, ' +
      'Susanna and Bel as Daniel 13 and 14, Sirach 30-36 in the Latin chapter order and Daniel 3:98-6:28 renumbered ' +
      'to the lxx scheme.',
    versification: 'lxx',
  };
}

function licenceText(archive: PinnedArchive & { readonly version: string }, readme: string, licence: string): string {
  return [
    '# Septuagint (Swete), deuterocanonical books: licence',
    '',
    `Imported from ${archive.url} (commit ${archive.version}, sha256 ${archive.sha256}).`,
    '',
    '## Licence statement',
    '',
    'The repository https://github.com/eliranwong/LXX-Swete-1930 is published under the GNU General Public License',
    "version 3; its LICENSE file is reproduced verbatim below. Swete's edition itself (1907-1912) is in the public",
    'domain. The upstream README.md says where the digitised text comes from:',
    '',
    `> ${PROVENANCE_STATEMENT}`,
    '',
    'The files in this directory are a modified version of that database and are distributed under the same licence.',
    '',
    '## Modifications',
    '',
    'Lectio kept only Tobit (the Sinaiticus text), Judith, Greek Esther, 1-2 Maccabees, Wisdom, Sirach, Baruch, the',
    "Letter of Jeremiah and Theodotion's Daniel, Susanna and Bel; stored the Letter of Jeremiah as Baruch 6 and",
    'Susanna and Bel as Daniel 13 and 14; split each verse into words; removed the text-critical signs (⸂ ⸃ ⸆) and the',
    "bracketed verse numbers; and stored Greek Esther's additions as chapters A-F, numbered by those brackets. Sirach",
    "30:25-36:16, in the Greek manuscripts' order upstream, is stored in the Latin chapter order Swete prints, with his",
    "verse numbers; Theodotion's Daniel 3:98-6:28 is renumbered to Rahlfs' chapters (3:98 is 4:1, 4:1 is 4:4, 5:31 is",
    '6:1, 6:1 is 6:2). Verses the upstream leaves empty are not stored. Every other word is unchanged (normalised to',
    'Unicode NFC).',
    '',
    `## Upstream README.md (commit ${archive.version})`,
    '',
    readme.replace(/\r\n/gu, '\n').trimEnd(),
    '',
    `## Upstream LICENSE (commit ${archive.version})`,
    '',
    '```text',
    licence.replace(/\r\n/gu, '\n').trimEnd(),
    '```',
    '',
  ].join('\n');
}

export interface ImportLxxOptions {
  readonly downloader: Downloader;
  /** The corpus directory; the edition is written to `<corpusRoot>/grc-lxx`. */
  readonly corpusRoot: string;
  /** Where the downloaded archive is cached (reused when its sha256 still matches). */
  readonly cacheDir: string;
  /** The upstream archive. Defaults to the pinned SWETE_LXX; tests pass a fixture archive. */
  readonly archive?: PinnedArchive & { readonly version: string };
  /** Renames a directory. Defaults to node:fs `rename`; injectable so tests can make the final swap fail. */
  readonly renameDir?: (from: string, to: string) => Promise<void>;
}

export interface ImportSummary {
  readonly edition: string;
  readonly books: number;
  readonly chapters: number;
  readonly verses: number;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readUpstream(dir: string, name: string): Promise<string> {
  try {
    return await readFile(join(dir, name), 'utf8');
  } catch (error) {
    if (isNotFound(error)) throw new CorpusError(`upstream archive has no ${name}`);
    throw error;
  }
}

/**
 * Moves the staged edition to `target`. An existing edition is first moved to `backup` and moved back if the swap
 * fails, so the corpus always holds either the old or the new edition, never a partial one.
 */
async function swapIn(
  staged: string,
  target: string,
  backup: string,
  renameDir: (from: string, to: string) => Promise<void>,
): Promise<void> {
  let hadOld = true;
  try {
    await renameDir(target, backup);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    hadOld = false;
  }
  try {
    await renameDir(staged, target);
  } catch (error) {
    if (hadOld) await renameDir(backup, target);
    throw error;
  }
}

/**
 * Downloads (or reuses) the pinned archive, verifies its sha256, and rebuilds `corpus/grc-lxx` from scratch, so a
 * re-run produces byte-identical files. The edition is written to a staging directory under the corpus root and
 * swapped in only once every file is written; a failure leaves the previous edition in place.
 */
export async function importLxx(options: ImportLxxOptions): Promise<ImportSummary> {
  const archive = options.archive ?? SWETE_LXX;
  const cached = join(options.cacheDir, `lxx-swete-${archive.version}.tar.gz`);
  await downloadPinned(options.downloader, archive, cached);
  const work = await mkdtemp(join(tmpdir(), 'lectio-lxx-'));
  try {
    await unpackTarball(cached, work, { strip: 1 });
    const verses = parseVersification(await readUpstream(work, VERSIFICATION_FILE));
    const words = parseWords(await readUpstream(work, WORDS_FILE));
    const readme = await readUpstream(work, 'README.md');
    const licence = await readUpstream(work, 'LICENSE');
    const books = buildLxxBooks(verses, words);
    await mkdir(options.corpusRoot, { recursive: true });
    const staging = await mkdtemp(join(options.corpusRoot, '.staging-lxx-'));
    try {
      let chapters = 0;
      let verseCount = 0;
      for (const [book, content] of books) {
        for (const [chapter, chapterVerses] of content) {
          await writeChapter(staging, LXX_EDITION, book, chapter, chapterVerses as ChapterVerses);
          chapters += 1;
          verseCount += Object.keys(chapterVerses).length;
        }
      }
      await writeEditionMetadata(staging, LXX_EDITION, lxxSource(archive), licenceText(archive, readme, licence));
      await swapIn(
        join(staging, LXX_EDITION),
        join(options.corpusRoot, LXX_EDITION),
        join(staging, 'previous'),
        options.renameDir ?? rename,
      );
      return { edition: LXX_EDITION, books: books.size, chapters, verses: verseCount };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export interface ImportCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * `npm run corpus:import:lxx`: imports into `corpusRoot`, caching the archive in `.cache/corpus` next to it (the
 * repository's git-ignored cache). Exit code 0 on success, 2 on a corpus error (bad hash, unexpected upstream layout,
 * network or HTTP error).
 */
export async function runImportLxx(
  corpusRoot: string,
  io: ImportCliIo,
  { downloader = fetchDownloader(), archive }: { downloader?: Downloader; archive?: ImportLxxOptions['archive'] } = {},
): Promise<number> {
  try {
    const cacheDir = join(dirname(corpusRoot), '.cache', 'corpus');
    const summary = await importLxx({ downloader, corpusRoot, cacheDir, ...(archive && { archive }) });
    io.out(
      `${summary.edition}: ${summary.books} books, ${summary.chapters} chapters, ${summary.verses} verses ` +
        `written to ${join(corpusRoot, summary.edition)}`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof CorpusError)) throw error;
    io.err(error.message);
    return 2;
  }
}
