/**
 * @lectio/refs: the book table, the lectionary reference parser, canonical
 * passage keys (ADR 0004), formatters, verse enumeration, and versification
 * (verse existence and cross-versification mapping, L-006), link-out URLs (L-007) and
 * Greek Esther's lettered chapters (L-049).
 */
export const packageName = '@lectio/refs';

export { BOOKS, bookAliases, buildAliasIndex, findBook, getBook, isBookCode, normalizeBookName } from './books.ts';
export type { Book, BookCode, Language, Testament } from './books.ts';
export { enumerateVerses } from './enumerate.ts';
export type { VerseCountLookup, VerseId } from './enumerate.ts';
export { RefError } from './errors.ts';
export type { RefErrorCode } from './errors.ts';
export { formatRef } from './format.ts';
export {
  GREEK_ESTHER_LETTERS,
  chapterLabel,
  chapterLetter,
  comparePoints,
  isLetteredChapter,
  letteredChapter,
  readChapter,
  readingOrder,
} from './greek-esther.ts';
export type { GreekEstherLetter } from './greek-esther.ts';
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
  createGreekEstherLxx,
  createVersification,
  fromSourceVerse,
  greekEstherLxx,
  isRealVerse,
  mapRef,
  mapVerse,
  notInOriginal,
  readRahlfsEsther,
  toSourceVerse,
  verseCounts,
  versification,
} from './versification/index.ts';
export type {
  LxxVerse,
  Scheme,
  SourceVerse,
  VerseInput,
  Versification,
  VersificationData,
  VersificationErrorCode,
} from './versification/index.ts';
export {
  DRBO_BASE,
  LinkoutError,
  REFERENCE_SCHEME,
  TEMPLATE_TOKENS,
  activeProvider,
  compactDate,
  drboChapterUrl,
  drboUrl,
  fillTemplate,
  firstChapter,
  linkoutUrl,
  templateTokens,
  templateValues,
} from './linkout/index.ts';
export type { Linkout, LinkoutErrorCode, TemplateToken } from './linkout/index.ts';
