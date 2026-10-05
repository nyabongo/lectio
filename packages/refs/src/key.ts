import { isBookCode } from './books.ts';
import type { BookCode } from './books.ts';
import { RefError } from './errors.ts';
import { chapterLabel, readChapter } from './greek-esther.ts';
import type { Point, Ref, Segment } from './types.ts';
import { checkRef } from './validate.ts';

/**
 * Characters a passage key may contain: safe in file names on every OS and in URL path segments.
 * Chapters and verses are numbers; only Esther may also name a chapter by the letters A–F of its
 * Greek additions (`EST.C.12`, `EST.C.30-D.2`), and only where a chapter stands. {@link isKey} is
 * the full check.
 */
export const KEY_PATTERN =
  /^(?:[A-Z0-9]+\.[0-9]+(?:[.-][0-9]+)*(?:_[0-9]+(?:[.-][0-9]+)*)*|EST\.(?:[0-9]+|[A-F])(?:-(?:[0-9]+|[A-F])|\.[0-9]+(?:-(?:(?:[0-9]+|[A-F])\.)?[0-9]+)?)?(?:_(?:[0-9]+|[A-F])(?:-(?:[0-9]+|[A-F])|\.[0-9]+(?:-(?:(?:[0-9]+|[A-F])\.)?[0-9]+)?)?)*)$/;

function segmentKey(book: BookCode, { start, end }: Segment): string {
  const from = chapterLabel(book, start.c);
  const to = chapterLabel(book, end.c);
  if (start.v === undefined) return start.c === end.c ? from : `${from}-${to}`;
  const head = `${from}.${start.v}`;
  if (start.c !== end.c) return `${head}-${to}.${end.v}`;
  return start.v === end.v ? head : `${head}-${end.v}`;
}

/**
 * The canonical passage key (ADR 0004): book code once, then segments joined
 * by `_`, each carrying its chapter, sub-verse letters dropped.
 * `Phil 1:20c-24, 27a` → `PHIL.1.20-24_1.27`; `Eccl 11:9—12:8` → `ECCL.11.9-12.8`;
 * a whole chapter is `PS.23`, a chapter range `IS.40-41`; Greek Esther keeps
 * its letter, `Est C:12, 14-16` → `EST.C.12_C.14-16`.
 */
export function toKey(ref: Ref): string {
  checkRef(ref);
  return `${ref.book}.${ref.segments.map((segment) => segmentKey(ref.book, segment)).join('_')}`;
}

const SEGMENT = /^(\d+|[A-F])(?:\.(\d+))?(?:-(\d+|[A-F])(?:\.(\d+))?)?$/;

function readSegment(book: BookCode, text: string): Segment | undefined {
  const match = SEGMENT.exec(text);
  if (!match) return undefined;
  const [, a = '', b, c, d] = match;
  // After a verse, a lone end is a verse number: `EST.1.2-C` names no chapter C.
  if (b !== undefined && c !== undefined && d === undefined && !/^\d/.test(c)) return undefined;
  const first = readChapter(book, a);
  const after = c === undefined ? first : readChapter(book, c);
  if (first === undefined || after === undefined) return undefined;
  const start: Point = b === undefined ? { c: first } : { c: first, v: Number(b) };
  if (c === undefined) return { start, end: start };
  if (d !== undefined) return { start, end: { c: after, v: Number(d) } };
  return { start, end: b === undefined ? { c: after } : { c: start.c, v: after } };
}

function invalid(key: string, reason: string): RefError {
  return new RefError('INVALID_KEY', `Not a canonical passage key: ${reason}`, key);
}

/**
 * Reads a key written by {@link toKey}. Only the canonical spelling is
 * accepted (no leading zeros, no `1.2-2`, no `1.2-1.5`, no `EST.103.12` for
 * `EST.C.12`), so each passage has exactly one key. The result has no
 * sub-verse letters.
 */
export function fromKey(key: string): Ref {
  const dot = key.indexOf('.');
  const book = key.slice(0, dot);
  if (dot < 0 || !isBookCode(book)) throw invalid(key, 'it must start with a book code and a dot');
  const segments: Segment[] = [];
  for (const text of key.slice(dot + 1).split('_')) {
    const segment = readSegment(book, text);
    if (!segment) throw invalid(key, `cannot read segment "${text}"`);
    segments.push(segment);
  }
  const ref: Ref = { book, segments };
  let canonical: string;
  try {
    canonical = toKey(ref);
  } catch (error) {
    throw invalid(key, (error as RefError).message);
  }
  if (canonical !== key) throw invalid(key, `the canonical spelling is "${canonical}"`);
  return ref;
}

/** True when `key` is a canonical passage key. */
export function isKey(key: string): boolean {
  try {
    fromKey(key);
    return true;
  } catch {
    return false;
  }
}
