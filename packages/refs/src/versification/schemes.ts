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
 * - `vulgate`: the Stuttgart Vulgate's numbering (`vul.vrs`), which has the
 *   Clementine / Douay-Rheims chapter divisions: Vulgate psalm numbers, Joel in
 *   3 chapters (2:28-32), Malachi in 4, Hosea 1:10-11 and 1 Kings 4:21-34 as in
 *   English Bibles. Use it for Douay-Rheims link-outs and the Clementine text.
 *   Psalms 115 and 147 are numbered from verses 10 and 12 (Stuttgart
 *   numbering): 115:10-19 is Hebrew 116:10-19 and 147:12-20 is Hebrew
 *   147:12-20, and 115:1-9 and 147:1-11 do not exist. The printed Clementine
 *   text numbers them 115:1-10 and 147:1-9, so a Clementine import (L-012) must
 *   add 9 and 11 to those verse numbers before using this scheme.
 *
 *   It is **not** the Nova Vulgata of the OLM. The Nova Vulgata follows the
 *   Hebrew chapter divisions (Joel 3:1-5, Malachi 3:19-24, Hosea 14:2-10,
 *   1 Kings 5:1-14; decision 011) and differs only in its psalm numbers. So
 *   convert OLM / Nova Vulgata citations with `mapRef(ref, 'vulgate', 'original')`
 *   for the Psalms only, and read every other book as `original`. Tobit, Sirach
 *   and Esther still need checking entry by entry (decision 011). No separate
 *   Nova Vulgata scheme exists, because no openly licensed NV table was found.
 * - `lxx`: Rahlfs Septuagint (`lxx.vrs`), with Greek Daniel, Greek Esther and
 *   Nehemiah cited as Ezra-Nehemiah chapters 11-23 of the LXX's single book.
 *   Some verses are lost on the way, as expected: the LXX omits verses (for
 *   example 70 Hebrew Exodus verses, many in the shorter and reordered
 *   chapters 35-40, have no counterpart) and merges others (LXX Jer 25:14 and
 *   25:20 both map to Hebrew 49:34), so a round trip can land on a neighbour
 *   or fail with `NO_COUNTERPART`.
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
 * does not map. In those places verse numbers pass through unchanged where
 * both schemes have them, and verses beyond that have no counterpart. vul.vrs says
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
