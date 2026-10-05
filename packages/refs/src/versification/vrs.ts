/**
 * Reader for Paratext versification files (`.vrs`), the format of the
 * libpalaso `org.vrs`, `vul.vrs`, `lxx.vrs` and `eng.vrs` tables in
 * packages/refs/data (see SOURCE.json there).
 *
 * A file has three kinds of line, and `#` starts a comment:
 * - a book line, `GEN 1:31 2:25 …`: the last verse of each chapter;
 * - an excluded verse, `-GEN 31:51`: a verse number the scheme skips;
 * - a mapping, `PSA 9:22-39 = PSA 10:1-18`: verses of this scheme (left) and the
 *   verses of the original scheme (`org.vrs`, right) they correspond to.
 *   Ranges stay inside one chapter and both sides have the same length.
 *
 * Lines starting with `*` (verse segments) are ignored. Verse 0 (a psalm title
 * that is not a verse) is dropped from mappings, since passage keys start at 1.
 * Lines that cannot be read are kept in `skipped` instead of failing, because
 * the upstream files contain a few typos (`DAG 3:52-23`); tests pin that list.
 */

/** A verse in Paratext terms: a three-character USFM book id such as `PSA`, `DAN` or `S3Y`. */
export interface SourceVerse {
  readonly book: string;
  readonly c: number;
  readonly v: number;
}

export interface VrsMapping {
  /** The verse in the file's own scheme. */
  readonly from: SourceVerse;
  /** The corresponding verse in the original scheme. */
  readonly to: SourceVerse;
}

export interface VrsFile {
  /** USFM book id → last verse of each chapter (index 0 is chapter 1). */
  readonly books: ReadonlyMap<string, readonly number[]>;
  /** Excluded verses as {@link sourceKey} strings. */
  readonly excluded: ReadonlySet<string>;
  /** Mapping pairs in file order, ranges expanded to single verses. */
  readonly mappings: readonly VrsMapping[];
  /** Lines that could not be read, verbatim. */
  readonly skipped: readonly string[];
}

/** `PSA 145:2`: the string form used as a map key. */
export function sourceKey({ book, c, v }: SourceVerse): string {
  return `${book} ${c}:${v}`;
}

const BOOK = '([0-9A-Z]{3})';
const RANGE = new RegExp(`^${BOOK} (\\d+):(\\d+)(?:-(\\d+))?$`);
const BOOK_LINE = new RegExp(`^${BOOK}((?: \\d+:\\d+)+)$`);

interface Range {
  readonly book: string;
  readonly c: number;
  readonly from: number;
  readonly to: number;
}

function readRange(text: string): Range | undefined {
  const match = RANGE.exec(text.trim());
  if (!match) return undefined;
  const [, book = '', c, from, to] = match;
  const range = { book, c: Number(c), from: Number(from), to: Number(to ?? from) };
  return range.to < range.from ? undefined : range;
}

function readMapping(line: string): VrsMapping[] | undefined {
  const sides = line.split('=');
  if (sides.length !== 2) return undefined;
  const [left, right] = sides.map(readRange);
  if (!left || !right || left.to - left.from !== right.to - right.from) return undefined;
  const pairs: VrsMapping[] = [];
  for (let i = 0; i <= left.to - left.from; i++) {
    const from = { book: left.book, c: left.c, v: left.from + i };
    const to = { book: right.book, c: right.c, v: right.from + i };
    if (from.v > 0 && to.v > 0) pairs.push({ from, to });
  }
  return pairs;
}

function readBookLine(line: string): [string, number[]] | undefined {
  const match = BOOK_LINE.exec(line);
  if (!match) return undefined;
  const [, book = '', rest = ''] = match;
  const counts: number[] = [];
  for (const token of rest.trim().split(' ')) {
    const [c, v] = token.split(':').map(Number) as [number, number];
    if (c !== counts.length + 1) return undefined;
    counts.push(v);
  }
  return [book, counts];
}

/** Parses the text of a `.vrs` file. Never throws; unreadable lines land in `skipped`. */
export function parseVrs(text: string): VrsFile {
  const books = new Map<string, readonly number[]>();
  const excluded = new Set<string>();
  const mappings: VrsMapping[] = [];
  const skipped: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '' || line.startsWith('*')) continue;
    if (line.includes('=')) {
      const pairs = readMapping(line);
      if (pairs) mappings.push(...pairs);
      else skipped.push(line);
    } else if (line.startsWith('-')) {
      const range = readRange(line.slice(1));
      if (range)
        for (let v = range.from; v <= range.to; v++) excluded.add(sourceKey({ book: range.book, c: range.c, v }));
      else skipped.push(line);
    } else {
      const entry = readBookLine(line);
      if (entry && !books.has(entry[0])) books.set(...entry);
      else skipped.push(line);
    }
  }
  return { books, excluded, mappings, skipped };
}

/** The text of a `.vrs` file without comment-only and blank lines, as embedded in the generated module. */
export function stripVrs(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n');
}
