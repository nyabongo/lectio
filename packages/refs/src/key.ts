import { isBookCode } from './books.ts';
import { RefError } from './errors.ts';
import type { Point, Ref, Segment } from './types.ts';
import { checkRef } from './validate.ts';

/** Characters a passage key may contain: safe in file names on every OS and in URL path segments. */
export const KEY_PATTERN = /^[A-Z0-9]+\.[0-9]+(?:[.-][0-9]+)*(?:_[0-9]+(?:[.-][0-9]+)*)*$/;

function segmentKey({ start, end }: Segment): string {
  if (start.v === undefined) return start.c === end.c ? `${start.c}` : `${start.c}-${end.c}`;
  const head = `${start.c}.${start.v}`;
  if (start.c !== end.c) return `${head}-${end.c}.${end.v}`;
  return start.v === end.v ? head : `${head}-${end.v}`;
}

/**
 * The canonical passage key (ADR 0004): book code once, then segments joined
 * by `_`, each carrying its chapter, sub-verse letters dropped.
 * `Phil 1:20c-24, 27a` → `PHIL.1.20-24_1.27`; `Eccl 11:9—12:8` → `ECCL.11.9-12.8`;
 * a whole chapter is `PS.23`, a chapter range `IS.40-41`.
 */
export function toKey(ref: Ref): string {
  checkRef(ref);
  return `${ref.book}.${ref.segments.map(segmentKey).join('_')}`;
}

const SEGMENT = /^(\d+)(?:\.(\d+))?(?:-(\d+)(?:\.(\d+))?)?$/;

function readSegment(text: string): Segment | undefined {
  const match = SEGMENT.exec(text);
  if (!match) return undefined;
  const [, a, b, c, d] = match;
  const start: Point = b === undefined ? { c: Number(a) } : { c: Number(a), v: Number(b) };
  if (c === undefined) return { start, end: start };
  if (d !== undefined) return { start, end: { c: Number(c), v: Number(d) } };
  return { start, end: b === undefined ? { c: Number(c) } : { c: start.c, v: Number(c) } };
}

function invalid(key: string, reason: string): RefError {
  return new RefError('INVALID_KEY', `Not a canonical passage key: ${reason}`, key);
}

/**
 * Reads a key written by {@link toKey}. Only the canonical spelling is
 * accepted (no leading zeros, no `1.2-2`, no `1.2-1.5`), so each passage has
 * exactly one key. The result has no sub-verse letters.
 */
export function fromKey(key: string): Ref {
  const dot = key.indexOf('.');
  const book = key.slice(0, dot);
  if (dot < 0 || !isBookCode(book)) throw invalid(key, 'it must start with a book code and a dot');
  const segments: Segment[] = [];
  for (const text of key.slice(dot + 1).split('_')) {
    const segment = readSegment(text);
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
