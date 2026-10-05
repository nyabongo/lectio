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
 * lacks (Sirach 1:5, Tobit S 4:7-18…) has one empty word. Swete's numbering is mostly Rahlfs', the `lxx` scheme of
 * `@lectio/refs`. Theodotion's Daniel 3:98–6:28 and Sirach 30:25–36:16 (in the Greek manuscripts' order upstream) are
 * moved into that scheme's chapters, and each book is then re-divided into the scheme's verses: where Swete divides
 * differently enough to shift verses, LXX_VERSE_STARTS says where each lxx verse starts in Swete's text.
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

import { chapterCount, chapterLength, isRealVerse } from '@lectio/refs';
import type { BookCode } from '@lectio/refs';

import { CorpusError } from '../format.ts';
import type { ChapterVerses, SourceInfo, Token } from '../format.ts';
import { downloadPinned } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import { unpackTarball, writeChapter, writeEditionMetadata } from '../import/unpack.ts';
import { corpusDownloader } from './shared.ts';

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
 * (Rahlfs) starts chapter 4 at Hebrew 3:31 and chapter 6 at Hebrew 5:31, and swaps 3:54 and 3:55.
 */
export const DANIEL_ORDER: readonly Relocation[] = [
  { c: 3, v: 98, count: 3, toC: 4, toV: 1 },
  { c: 4, v: 1, count: 34, toC: 4, toV: 4 },
  { c: 5, v: 31, count: 1, toC: 6, toV: 1 },
  { c: 6, v: 1, count: 28, toC: 6, toV: 2 },
  // Swete prints 3:54 and 3:55 in the order of Codex B; Rahlfs swaps them.
  { c: 3, v: 54, count: 1, toC: 3, toV: 55 },
  { c: 3, v: 55, count: 1, toC: 3, toV: 54 },
];

/**
 * Where Swete's verse divisions differ from the `lxx` scheme (Rahlfs) enough to shift whole verses, the verses of the
 * scheme that start elsewhere: `'BOOK c'` → lxx verse → the Swete position it starts at, `'c:v'` or `'c:v+w'` (word
 * `w`, counted from 0, of Swete's verse `c:v`, numbered as placed by {@link placeVerse}). Every other lxx verse starts
 * at the Swete verse with its number. A verse runs to the start of the next one, so Swete verses merged by Rahlfs are
 * joined and split ones are cut. The starts were found by aligning Swete's words with the verse divisions of a Rahlfs
 * word list (eliranwong/LXX-Rahlfs-1935, used for research only) and checked by hand; only these positions are kept,
 * no Rahlfs text. Elsewhere Swete's and Rahlfs' divisions can still differ by a few words at a verse boundary.
 */
export const LXX_VERSE_STARTS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  'TB 5': { 10: '5:9+47', 16: '5:15+18', 17: '5:16+5', 22: '5:21+30', 23: '6:1' },
  'TB 6': { 1: '6:2', 2: '6:3', 3: '6:4', 4: '6:5', 5: '6:6', 6: '6:6+26', 18: '6:18+15', 19: '6:18+73' },
  'TB 7': { 5: '7:4+14', 7: '7:8', 8: '7:9', 9: '7:9+9', 12: '7:11+27', 13: '7:12', 14: '7:13' },
  'TB 8': { 10: '8:9+4' },
  'TB 10': { 8: '10:7+46', 9: '10:8', 13: '10:12+36', 14: '10:13' },
  'TB 11': {
    2: '11:2+2',
    11: '11:10+13',
    12: '11:13',
    13: '11:13+12',
    14: '11:14+13',
    15: '11:15+11',
    17: '11:17+16',
    18: '11:17+73',
    19: '11:18',
  },
  'TB 13': {
    2: '13:1+2',
    7: '13:6+33',
    11: '13:10',
    12: '13:10+9',
    13: '13:11',
    14: '13:12',
    15: '13:13',
    16: '13:14+12',
    17: '13:16',
  },
  'EST 9': { 31: '9:30', 32: '9:31' },
  'WIS 17': {
    10: '17:11',
    11: '17:12',
    12: '17:13',
    13: '17:14',
    14: '17:15',
    15: '17:16',
    16: '17:17',
    17: '17:18+6',
    18: '17:19+5',
    19: '17:20',
    20: '17:21',
  },
  'SIR 17': { 4: '17:4+1', 10: '17:9' },
  'SIR 20': { 3: '20:2+5', 17: '20:16+13' },
  'SIR 22': { 9: '22:7', 10: '22:8' },
  'SIR 23': { 8: '23:7+12', 17: '23:16+9' },
  'SIR 29': { 17: '29:18', 18: '29:18+10' },
  'SIR 33': {
    17: '33:25+4',
    ...run(18, '33', 26, 11),
    29: '33:38',
    30: '33:38+13',
    31: '33:39',
    32: '33:39+12',
    33: '33:40',
  },
  'SIR 34': {
    ...run(11, '34', 12, 3),
    14: '34:16',
    15: '34:17',
    16: '34:19',
    17: '34:20',
    18: '34:21',
    ...run(19, '34', 23, 4),
    ...run(23, '34', 28, 4),
  },
  'SIR 35': {
    2: '35:3',
    3: '35:5',
    4: '35:6',
    ...run(5, '35', 8, 7),
    12: '35:15+5',
    13: '35:16',
    14: '35:17',
    15: '35:18',
    16: '35:20',
    17: '35:21',
    18: '35:21+10',
    19: '35:22+6',
    20: '35:22+17',
    21: '35:23+5',
    ...run(22, '35', 24, 3),
  },
  'SIR 36': {
    ...run(2, '36', 3, 4),
    6: '36:8',
    ...run(7, '36', 10, 4),
    ...run(11, '36', 17, 6),
    17: '36:22+14',
    ...run(18, '36', 23, 9),
    27: '36:31+10',
  },
  'SIR 41': {
    19: '41:18+12',
    20: '41:19+8',
    21: '41:19+19',
    22: '41:20+5',
    23: '41:21+5',
    24: '41:22',
    25: '41:22+11',
    26: '42:1',
    27: '42:1+10',
  },
  'SIR 37': { 18: '37:18+3' },
  'SIR 38': { 34: '38:33+15' },
  'SIR 42': { 1: '42:1+20' },
  'SIR 51': { 11: '51:11+9', 12: '51:12+11' },
  'BAR 6': {
    9: '6:9+8',
    10: '6:10+10',
    11: '6:11+8',
    12: '6:13',
    13: '6:14',
    14: '6:14+14',
    16: '6:16+10',
    26: '6:26+11',
    28: '6:28+7',
    47: '6:47+8',
    54: '6:54+10',
    57: '6:56+8',
    62: '6:62+12',
  },
  'DN 14': { 5: '14:4+18', 9: '14:9+14', 10: '14:10+10', 12: '14:13', 13: '14:14', 14: '14:14+13', 26: '14:26+14' },
};

/** `count` lxx verses from `first` that start at Swete verses `from`, `from + 1`, … of chapter `c`. */
function run(first: number, c: string, from: number, count: number): Record<number, string> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [first + i, `${c}:${from + i}`]));
}

/** Swete verses outside the `lxx` scheme, in chapters without starts above, that Rahlfs prints with the verse before. */
export const MERGED_WITH_PREVIOUS: ReadonlySet<string> = new Set(['SIR 6:1']);

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
 * Where one upstream verse of `part` goes: Esther's additions to their lettered chapters, Sirach and Daniel into the
 * scheme's chapter order, one-chapter books into their chapter. Parts without words are left out. Verse divisions
 * are adjusted afterwards, book by book ({@link reversify}).
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
const POSITION = /^([1-9][0-9]*):([1-9][0-9]*)(?:\+([1-9][0-9]*))?$/u;

function put(books: LxxBooks, book: BookCode, at: Placement, where: string): void {
  const chapters = books.get(book) ?? new Map<string, Record<string, Token[]>>();
  books.set(book, chapters);
  const verses = chapters.get(at.chapter) ?? {};
  chapters.set(at.chapter, verses);
  if (at.verse in verses) throw new CorpusError(`${where}: ${book} ${at.chapter}:${at.verse} written twice`);
  verses[at.verse] = at.tokens;
}

const byNumber = (a: string, b: string): number => Number(a) - Number(b);

/**
 * Re-divides one book's numbered chapters into the verses of the `lxx` scheme: each lxx verse starts where
 * `starts` says (by default at the Swete verse with its number) and runs to the start of the next. Swete verses the
 * scheme lacks must be covered by `starts` or listed in `merged`; Esther's lettered chapters are kept as they are.
 */
export function reversify(
  book: BookCode,
  chapters: ReadonlyMap<string, Record<string, Token[]>>,
  starts: Readonly<Record<string, Readonly<Record<number, string>>>> = LXX_VERSE_STARTS,
  merged: ReadonlySet<string> = MERGED_WITH_PREVIOUS,
): Map<string, Record<string, Token[]>> {
  const stream: Token[] = [];
  const index = new Map<string, readonly [at: number, length: number]>();
  const numbered = [...chapters.keys()].filter((c) => NUMBER.test(c)).sort(byNumber);
  for (const c of numbered) {
    const verses = chapters.get(c) as Record<string, Token[]>;
    for (const v of Object.keys(verses).sort(byNumber)) {
      const tokens = verses[v] as Token[];
      const label = `${book} ${c}:${v}`;
      if (
        !isRealVerse({ book, c: Number(c), v: Number(v) }, 'lxx') &&
        !merged.has(label) &&
        !(`${book} ${c}` in starts)
      ) {
        throw new CorpusError(`${label} is not a verse of the lxx scheme`);
      }
      index.set(`${c}:${v}`, [stream.length, tokens.length]);
      stream.push(...tokens);
    }
  }
  const position = (spec: string, label: string): number => {
    const match = POSITION.exec(spec);
    const found = match === null ? undefined : index.get(`${match[1]}:${match[2]}`);
    const offset = Number(match?.[3] ?? 0);
    if (found === undefined || offset >= found[1]) throw new CorpusError(`${label}: no Swete position ${spec}`);
    return found[0] + offset;
  };
  const verses: { c: string; v: string; at: number }[] = [];
  for (let c = 1; c <= chapterCount(book, 'lxx'); c += 1) {
    const table = starts[`${book} ${c}`];
    for (let v = 1; v <= (chapterLength(book, c, 'lxx') as number); v += 1) {
      if (!isRealVerse({ book, c, v }, 'lxx')) continue;
      const label = `${book} ${c}:${v}`;
      const spec = table?.[v];
      const at = spec === undefined ? index.get(`${c}:${v}`)?.[0] : position(spec, label);
      if (at === undefined) continue;
      const previous = verses.at(-1);
      if ((previous?.at ?? -1) >= at || (previous === undefined && at !== 0)) {
        throw new CorpusError(`${label}: starts out of order in the Swete text`);
      }
      verses.push({ c: String(c), v: String(v), at });
    }
  }
  const out = new Map<string, Record<string, Token[]>>();
  verses.forEach(({ c, v, at }, i) => {
    const chapter = out.get(c) ?? {};
    out.set(c, chapter);
    chapter[v] = stream.slice(at, verses[i + 1]?.at ?? stream.length);
  });
  for (const [c, lettered] of chapters) if (!NUMBER.test(c)) out.set(c, lettered);
  return out;
}

/**
 * Builds the edition from the parsed upstream files: verses without words are skipped, the rest are placed
 * ({@link placeVerse}) and each book is re-divided into the verses of the `lxx` scheme ({@link reversify}).
 */
export function buildLxxBooks(
  verses: readonly LxxVerseStart[],
  words: readonly string[],
  starts: Readonly<Record<string, Readonly<Record<number, string>>>> = LXX_VERSE_STARTS,
): LxxBooks {
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
  for (const [book, chapters] of books) books.set(book, reversify(book as BookCode, chapters, starts));
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
      'Susanna and Bel as Daniel 13 and 14, Sirach 30-36 in the Latin chapter order, Daniel 3:98-6:28 renumbered ' +
      'and the verses re-divided where they shift against the lxx scheme.',
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
    "30:25-36:16, in the Greek manuscripts' order upstream, is stored in the Latin chapter order of the lxx scheme;",
    "Theodotion's Daniel 3:98-6:28 is renumbered to Rahlfs' chapters (3:98 is 4:1, 4:1 is 4:4, 5:31 is 6:1, 6:1 is 6:2)",
    'and 3:54-55 swapped. Where Swete divides verses differently enough to shift them (Sirach 17, 20, 22, 23, 29,',
    '33-38, 41, 42, 51; Tobit 5-8, 10, 11, 13; Wisdom 17; Esther 9; Baruch 6; Bel), the text is re-divided into the verses of the',
    'lxx scheme, joining or cutting Swete verses. Verses the upstream leaves empty are not stored: in this edition that',
    'includes Tobit 4:7-18 and 13:7-10 (lacunae of Sinaiticus), Daniel 3:67-68 and the Sirach prologue. Every other',
    'word is unchanged (normalised to Unicode NFC).',
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
  /** Where lxx verses start in Swete's text. Defaults to LXX_VERSE_STARTS; tests with a tiny archive pass `{}`. */
  readonly verseStarts?: Readonly<Record<string, Readonly<Record<number, string>>>>;
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
    const books = buildLxxBooks(verses, words, options.verseStarts);
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
 * repository's git-ignored cache). The script injects the live downloader (`LiveDownloader` from
 * `@lectio/provider-fetch`). Exit code 0 on success, 2 on a corpus error (bad hash, unexpected upstream layout,
 * network or HTTP error).
 */
export async function runImportLxx(
  corpusRoot: string,
  io: ImportCliIo,
  {
    downloader,
    archive,
    verseStarts,
  }: Pick<ImportLxxOptions, 'downloader'> & Partial<Pick<ImportLxxOptions, 'archive' | 'verseStarts'>>,
): Promise<number> {
  try {
    const cacheDir = join(dirname(corpusRoot), '.cache', 'corpus');
    const summary = await importLxx({
      downloader: corpusDownloader(downloader),
      corpusRoot,
      cacheDir,
      archive,
      verseStarts,
    });
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
