/**
 * Versification (L-006): verse counts for the `original`, `vulgate`, `lxx` and
 * `english` schemes, verse existence, and mapping between schemes. The tables
 * come from libpalaso's `.vrs` files (packages/refs/data/SOURCE.json).
 */
import { VRS_DATA } from './__generated__/vrs-data.ts';
import { createVersification } from './engine.ts';
import { createGreekEstherLxx } from './greek-esther.ts';
import { SCHEME_DEFINITIONS } from './schemes.ts';

export { coalesce, createVersification } from './engine.ts';
export type { VersificationData, Versification, VerseInput } from './engine.ts';
export { VersificationError } from './errors.ts';
export type { VersificationErrorCode } from './errors.ts';
export { createGreekEstherLxx, readRahlfsEsther } from './greek-esther.ts';
export type { LxxVerse } from './greek-esther.ts';
export { GREEK_ADDITION_BOOKS, IDENTITY_MAPPED_BOOKS, SCHEMES, SCHEME_DEFINITIONS, chapters } from './schemes.ts';
export type { Scheme, SchemeDefinition, Span } from './schemes.ts';
export { parseVrs, sourceKey } from './vrs.ts';
export type { SourceVerse, VrsFile, VrsMapping } from './vrs.ts';

/** The versification built from the embedded libpalaso tables. */
export const versification = createVersification({ texts: VRS_DATA, schemes: SCHEME_DEFINITIONS });

export const {
  chapterCount,
  chapterLength,
  firstVerse,
  verseCounts,
  isRealVerse,
  mapVerse,
  mapRef,
  notInOriginal,
  toSourceVerse,
  fromSourceVerse,
} = versification;

/**
 * The Rahlfs Septuagint verse of a verse in Esther's lettered chapters (`original` scheme):
 * C:12 → 4:17k, D:1 → 5:1, F:11 → 10:3l. From libpalaso's eng.vrs ESG lines (MIT).
 * Throws a {@link VersificationError} (`UNKNOWN_VERSE`) for any other verse.
 */
export const greekEstherLxx = createGreekEstherLxx(versification, VRS_DATA.eng);
