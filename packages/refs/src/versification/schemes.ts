import type { BookCode } from '../books.ts';

/**
 * The versification schemes Lectio converts between.
 *
 * - `original`: Lectio's canonical scheme (ADR 0004), NABRE ≈ original. It is
 *   libpalaso's `org.vrs` (BHS Old Testament with psalm titles counted as
 *   verses, Nestle-Aland New Testament) with the Greek parts placed where
 *   Catholic Bibles have them: the Prayer of Azariah and Song of the Three as
 *   Daniel 3:24-90 (so Aramaic 3:24-33 is 3:91-100), Susanna as Daniel 13, Bel
 *   as Daniel 14 and the Letter of Jeremiah as Baruch 6.
 * - `vulgate`: Stuttgart Vulgate / Nova Vulgata (`vul.vrs`): Vulgate psalm numbers.
 * - `lxx`: Rahlfs Septuagint (`lxx.vrs`), with Greek Daniel, Greek Esther and
 *   Nehemiah cited as Ezra-Nehemiah chapters 11-23 of the LXX's single book.
 * - `english`: English Bibles (`eng.vrs`): psalm titles not counted, Joel 2:28-32,
 *   Malachi 4; Daniel as Catholic English Bibles print it (14 chapters).
 */
export type Scheme = 'original' | 'vulgate' | 'lxx' | 'english';

export const SCHEMES: readonly Scheme[] = ['original', 'vulgate', 'lxx', 'english'];

/**
 * Where a run of verses of a Lectio book sits in a source `.vrs` book:
 * Lectio chapter `c`, verses `from`…`from + count - 1`, are source `book`
 * chapter `sc`, verses `sv`…. `from` and `sv` default to 1; `count` defaults
 * to the rest of the source chapter.
 */
export interface Span {
  readonly c: number;
  readonly book: string;
  readonly sc: number;
  readonly from?: number;
  readonly sv?: number;
  readonly count?: number;
}

/** Lectio chapters `first`, `first + 1`, … are whole source chapters `from`…`to` of `book`. */
export function chapters(book: string, from: number, to: number, first = from): Span[] {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ c: first + i, book, sc: from + i }));
}

export interface SchemeDefinition {
  /** Name of the `.vrs` text in the data. */
  readonly file: string;
  /** Lectio's own mapping lines, read before the file's (they win on conflict). */
  readonly supplement?: string;
  /** Books laid out differently from "same chapters of the book's USFM id". */
  readonly layouts: Partial<Readonly<Record<BookCode, readonly Span[]>>>;
}

/** Greek Daniel shaped like the Vulgate and NABRE, built from org.vrs's separate books. */
const ORIGINAL_DANIEL: readonly Span[] = [
  ...chapters('DAN', 1, 2),
  { c: 3, book: 'DAN', sc: 3, count: 23 },
  { c: 3, from: 24, book: 'S3Y', sc: 1 },
  { c: 3, from: 91, book: 'DAN', sc: 3, sv: 24 },
  ...chapters('DAN', 4, 12),
  ...chapters('SUS', 1, 1, 13),
  ...chapters('BEL', 1, 1, 14),
];

const BARUCH_WITH_LETTER: readonly Span[] = [...chapters('BAR', 1, 5), ...chapters('LJE', 1, 1, 6)];

export const SCHEME_DEFINITIONS: Readonly<Record<Scheme, SchemeDefinition>> = {
  original: { file: 'org', layouts: { DN: ORIGINAL_DANIEL, BAR: BARUCH_WITH_LETTER } },
  vulgate: { file: 'vul', supplement: 'vulSupplement', layouts: {} },
  lxx: {
    file: 'lxx',
    supplement: 'lxxSupplement',
    layouts: {
      DN: [...chapters('DAG', 1, 12), ...chapters('SUS', 1, 1, 13), ...chapters('BEL', 1, 1, 14)],
      EST: chapters('ESG', 1, 10),
      EZR: chapters('EZR', 1, 10),
      NEH: chapters('EZR', 11, 23, 1),
      BAR: BARUCH_WITH_LETTER,
    },
  },
  english: { file: 'eng', supplement: 'engSupplement', layouts: { DN: chapters('DAG', 1, 14) } },
};

/** org.vrs books holding Greek additions that have no Hebrew or Aramaic original. */
export const GREEK_ADDITION_BOOKS: ReadonlySet<string> = new Set(['S3Y', 'SUS', 'BEL']);

/**
 * Books whose numbering differs from `original` in places the upstream file
 * does not map, so there numbers pass through unchanged where both schemes
 * have them and verses beyond that have no counterpart. vul.vrs says
 * outright that it does not map Tobit, Judith or Sirach; Esther's Greek
 * additions are unsupported. org.vrs takes its deuterocanonical numbering from
 * the LXX, so `lxx` has none. Callers converting these books should check entry
 * by entry (docs/decisions/011-lectionary-source.md).
 */
export const IDENTITY_MAPPED_BOOKS: Readonly<Record<Scheme, readonly BookCode[]>> = {
  original: [],
  vulgate: ['TB', 'JDT', 'EST', 'SIR'],
  lxx: [],
  english: ['TB', 'JDT', 'WIS', 'SIR', 'BAR'],
};
