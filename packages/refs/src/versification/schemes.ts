import type { BookCode } from '../books.ts';
import { letteredChapter } from '../greek-esther.ts';

/**
 * The versification schemes Lectio converts between.
 *
 * - `original`: Lectio's canonical scheme (ADR 0004), NABRE ≈ original. It is
 *   libpalaso's `org.vrs` (BHS Old Testament with psalm titles counted as
 *   verses, Nestle-Aland New Testament) with the Greek parts placed where
 *   Catholic Bibles have them: the Prayer of Azariah and Song of the Three as
 *   Daniel 3:24-90 (so Aramaic 3:24-33 is 3:91-100), Susanna as Daniel 13, Bel
 *   as Daniel 14 and the Letter of Jeremiah as Baruch 6. Esther is the Hebrew
 *   book (chapters 1-10) plus the Greek additions as the NABRE's lettered
 *   chapters A–F (stored as chapters 101-106, see `greek-esther.ts`), laid
 *   out on org.vrs's ESG, the Greek Esther that counts the additions as verses.
 * - `vulgate`: the Stuttgart Vulgate's numbering (`vul.vrs`), which has the
 *   Clementine / Douay-Rheims chapter divisions: Vulgate psalm numbers, Joel in
 *   3 chapters (2:28-32), Malachi in 4, Hosea 1:10-11 and 1 Kings 4:21-34 as in
 *   English Bibles, Esther in 16 (the Greek additions as 10:4-16:24, from
 *   `vul.supplement.vrs`; Hebrew 1:1-10:3 passes through by number). Use it
 *   for Douay-Rheims link-outs and the Clementine text.
 *   Psalms 115 and 147 are numbered from verses 10 and 12 (Stuttgart
 *   numbering): 115:10-19 is Hebrew 116:10-19 and 147:12-20 is Hebrew
 *   147:12-20, and 115:1-9 and 147:1-11 do not exist (`firstVerse` gives 10
 *   and 12, `chapterLength` the last verse, 19 and 20). The printed Clementine
 *   text numbers them 115:1-10 and 147:1-9, so a Clementine import (L-012) must
 *   add 9 and 11 to those verse numbers before using this scheme.
 *
 *   It is **not** the Nova Vulgata of the OLM. The Nova Vulgata follows the
 *   Hebrew chapter divisions (Joel 3:1-5, Malachi 3:19-24, Hosea 14:2-10,
 *   1 Kings 5:1-14; decision 011) and differs only in its psalm numbers, while
 *   its verse numbers follow the Hebrew. The Stuttgart text counts a few psalm
 *   verses its own way (its Ps 145:2 is Hebrew 146:1, and its Ps 10, 12, 14,
 *   15, 43 and 55 split or merge verses), so take only the psalm number from
 *   this scheme, mapping verse by verse only in the split psalms (9, 113-115,
 *   146-147), and read every other book as `original`; `toCanonical` in
 *   `@lectio/lectionary` does this. Tobit, Sirach and Esther still need
 *   checking entry by entry (decision 011); the NABRE lectionary cites Esther's
 *   additions by letter (`Est C:12`), which `original` reads directly. No separate Nova Vulgata scheme
 *   exists, because no openly licensed NV table was found.
 * - `lxx`: Rahlfs Septuagint (`lxx.vrs`), with Greek Daniel, Greek Esther and
 *   Nehemiah cited as Ezra-Nehemiah chapters 11-23 of the LXX's single book.
 *   Rahlfs numbers Esther's additions with sub-verse letters (4:17k), which a
 *   verse number cannot hold, so they have no counterpart here;
 *   `greekEstherLxx` gives the Rahlfs verse of a lettered-chapter verse.
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
  /** Lectio's own lines: its book lines replace the file's, its mapping lines are read first (they win on conflict). */
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

/**
 * Hebrew Esther and the NABRE lettered chapters on org.vrs's ESG, which counts
 * each addition as verses: A is ESG 1:1-17 (before Hebrew 1:1 at ESG 1:18),
 * B 3:14-20, C 4:18-47, D 5:1-16 (it absorbs Hebrew 5:1-2), E 8:13-36 and F
 * 10:4-14. org.vrs's ESG table gives chapter 10 only 13 verses, but its eng.vrs
 * twin maps ESG 10:14 (F:11, the colophon) to Rahlfs 10:3l, so the span is explicit.
 */
const ORIGINAL_ESTHER: readonly Span[] = [
  ...chapters('EST', 1, 10),
  { c: letteredChapter('A'), book: 'ESG', sc: 1, count: 17 },
  { c: letteredChapter('B'), book: 'ESG', sc: 3, sv: 14, count: 7 },
  { c: letteredChapter('C'), book: 'ESG', sc: 4, sv: 18, count: 30 },
  { c: letteredChapter('D'), book: 'ESG', sc: 5, count: 16 },
  { c: letteredChapter('E'), book: 'ESG', sc: 8, sv: 13, count: 24 },
  { c: letteredChapter('F'), book: 'ESG', sc: 10, sv: 4, count: 11 },
];

export const SCHEME_DEFINITIONS: Readonly<Record<Scheme, SchemeDefinition>> = {
  original: { file: 'org', layouts: { DN: ORIGINAL_DANIEL, BAR: BARUCH_WITH_LETTER, EST: ORIGINAL_ESTHER } },
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

/**
 * org.vrs books holding Greek additions that have no Hebrew or Aramaic original. The `original`
 * scheme uses ESG only for Esther's lettered chapters.
 */
export const GREEK_ADDITION_BOOKS: ReadonlySet<string> = new Set(['S3Y', 'SUS', 'BEL', 'ESG']);

/**
 * Books whose numbering differs from `original` in places the upstream file
 * does not map. In those places verse numbers pass through unchanged where
 * both schemes have them, and verses beyond that have no counterpart. vul.vrs says
 * outright that it does not map Tobit, Judith or Sirach; in Esther only the
 * Greek additions (10:4-16:24) are mapped, by `vul.supplement.vrs`. org.vrs takes its deuterocanonical numbering from
 * the LXX, so `lxx` has none. Callers converting these books should check entry
 * by entry (docs/decisions/011-lectionary-source.md).
 */
export const IDENTITY_MAPPED_BOOKS: Readonly<Record<Scheme, readonly BookCode[]>> = {
  original: [],
  vulgate: ['TB', 'JDT', 'EST', 'SIR'],
  lxx: [],
  english: ['TB', 'JDT', 'WIS', 'SIR', 'BAR'],
};
