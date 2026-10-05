/**
 * @lectio/refs: the book table, the lectionary reference parser, canonical
 * passage keys (ADR 0004), formatters and verse enumeration.
 * Versification and verse existence live in L-006; link-outs in L-007.
 */
export const packageName = '@lectio/refs';

export { BOOKS, bookAliases, buildAliasIndex, findBook, getBook, isBookCode, normalizeBookName } from './books.ts';
export type { Book, BookCode, Language, Testament } from './books.ts';
export { enumerateVerses } from './enumerate.ts';
export type { VerseCountLookup, VerseId } from './enumerate.ts';
export { RefError } from './errors.ts';
export type { RefErrorCode } from './errors.ts';
export { formatRef } from './format.ts';
export type { FormatOptions, RefStyle } from './format.ts';
export { KEY_PATTERN, fromKey, isKey, toKey } from './key.ts';
export { parseRef, tryParseRef } from './parse.ts';
export type { Point, Ref, Segment } from './types.ts';
export { checkRef } from './validate.ts';
