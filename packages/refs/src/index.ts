/**
 * @lectio/refs: the book table, the lectionary reference parser, canonical
 * passage keys (ADR 0004), formatters, verse enumeration, and versification
 * (verse existence and cross-versification mapping, L-006). Link-outs live in L-007.
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
export {
  GREEK_ADDITION_BOOKS,
  IDENTITY_MAPPED_BOOKS,
  SCHEMES,
  VersificationError,
  chapterCount,
  chapterLength,
  createVersification,
  fromSourceVerse,
  isRealVerse,
  mapRef,
  mapVerse,
  notInOriginal,
  toSourceVerse,
  verseCounts,
  versification,
} from './versification/index.ts';
export type {
  Scheme,
  SourceVerse,
  VerseInput,
  Versification,
  VersificationData,
  VersificationErrorCode,
} from './versification/index.ts';
