/**
 * The 73-book Catholic canon in NABRE order (ADR 0004).
 *
 * `code` is the upper-cased NABRE abbreviation with spaces removed and is the
 * first part of every passage key. `languages` lists the languages of the
 * source texts the book has come down to us in (Hebrew Esther and Daniel carry
 * Greek additions; Sirach survives partly in Hebrew, fully in Greek).
 * Douay-Rheims numbers follow the Clementine Vulgate order, where 1-2 Kings are
 * 1-2 Samuel, 3-4 Kings are 1-2 Kings and the Maccabees close the Old Testament.
 */

export type Testament = 'OT' | 'NT';
export type Language = 'hebrew' | 'aramaic' | 'greek';

type Row = readonly [
  code: string,
  abbrev: string,
  name: string,
  osis: string,
  usfm: string,
  languages: readonly Language[],
  douayRheimsName: string,
  aliases: readonly string[],
];

const H = ['hebrew'] as const;
const HA = ['hebrew', 'aramaic'] as const;
const G = ['greek'] as const;
const HG = ['hebrew', 'greek'] as const;

const OLD_TESTAMENT = [
  ['GN', 'Gn', 'Genesis', 'Gen', 'GEN', H, 'Genesis', ['Gen', 'Ge']],
  ['EX', 'Ex', 'Exodus', 'Exod', 'EXO', H, 'Exodus', ['Exod', 'Exo']],
  ['LV', 'Lv', 'Leviticus', 'Lev', 'LEV', H, 'Leviticus', ['Lev']],
  ['NM', 'Nm', 'Numbers', 'Num', 'NUM', H, 'Numbers', ['Num']],
  ['DT', 'Dt', 'Deuteronomy', 'Deut', 'DEU', H, 'Deuteronomy', ['Deut']],
  ['JOS', 'Jos', 'Joshua', 'Josh', 'JOS', H, 'Josue', ['Josh', 'Josue']],
  ['JGS', 'Jgs', 'Judges', 'Judg', 'JDG', H, 'Judges', ['Judg', 'Jdg']],
  ['RU', 'Ru', 'Ruth', 'Ruth', 'RUT', H, 'Ruth', ['Rth']],
  ['1SM', '1 Sm', '1 Samuel', '1Sam', '1SA', H, '1 Kings', ['1 Sam', '1 Sa']],
  ['2SM', '2 Sm', '2 Samuel', '2Sam', '2SA', H, '2 Kings', ['2 Sam', '2 Sa']],
  ['1KGS', '1 Kgs', '1 Kings', '1Kgs', '1KI', H, '3 Kings', ['1 Kg', '1 Ki', '1 Kin']],
  ['2KGS', '2 Kgs', '2 Kings', '2Kgs', '2KI', H, '4 Kings', ['2 Kg', '2 Ki', '2 Kin']],
  ['1CHR', '1 Chr', '1 Chronicles', '1Chr', '1CH', H, '1 Paralipomenon', ['1 Chron', '1 Paralipomenon']],
  ['2CHR', '2 Chr', '2 Chronicles', '2Chr', '2CH', H, '2 Paralipomenon', ['2 Chron', '2 Paralipomenon']],
  ['EZR', 'Ezr', 'Ezra', 'Ezra', 'EZR', HA, '1 Esdras', []],
  ['NEH', 'Neh', 'Nehemiah', 'Neh', 'NEH', H, '2 Esdras', ['Nehemias']],
  ['TB', 'Tb', 'Tobit', 'Tob', 'TOB', G, 'Tobias', ['Tob', 'Tobias']],
  ['JDT', 'Jdt', 'Judith', 'Jdt', 'JDT', G, 'Judith', ['Jth']],
  ['EST', 'Est', 'Esther', 'Esth', 'EST', HG, 'Esther', ['Esth']],
  ['1MC', '1 Mc', '1 Maccabees', '1Macc', '1MA', G, '1 Machabees', ['1 Macc', '1 Mac', '1 Machabees']],
  ['2MC', '2 Mc', '2 Maccabees', '2Macc', '2MA', G, '2 Machabees', ['2 Macc', '2 Mac', '2 Machabees']],
  ['JB', 'Jb', 'Job', 'Job', 'JOB', H, 'Job', []],
  ['PS', 'Ps', 'Psalms', 'Ps', 'PSA', H, 'Psalms', ['Pss', 'Psa', 'Psalm']],
  ['PRV', 'Prv', 'Proverbs', 'Prov', 'PRO', H, 'Proverbs', ['Prov', 'Pr']],
  ['ECCL', 'Eccl', 'Ecclesiastes', 'Eccl', 'ECC', H, 'Ecclesiastes', ['Eccles', 'Ecc', 'Qoheleth', 'Qoh']],
  [
    'SG',
    'Sg',
    'Song of Songs',
    'Song',
    'SNG',
    H,
    'Canticle of Canticles',
    ['Song', 'Song of Solomon', 'Canticle of Canticles', 'Canticles', 'Cant'],
  ],
  ['WIS', 'Wis', 'Wisdom', 'Wis', 'WIS', G, 'Wisdom', ['Wisd', 'Wisdom of Solomon']],
  ['SIR', 'Sir', 'Sirach', 'Sir', 'SIR', HG, 'Ecclesiasticus', ['Ecclesiasticus', 'Ecclus']],
  ['IS', 'Is', 'Isaiah', 'Isa', 'ISA', H, 'Isaias', ['Isa', 'Isaias']],
  ['JER', 'Jer', 'Jeremiah', 'Jer', 'JER', HA, 'Jeremias', ['Jeremias']],
  ['LAM', 'Lam', 'Lamentations', 'Lam', 'LAM', H, 'Lamentations', []],
  ['BAR', 'Bar', 'Baruch', 'Bar', 'BAR', G, 'Baruch', []],
  ['EZ', 'Ez', 'Ezekiel', 'Ezek', 'EZK', H, 'Ezechiel', ['Ezek', 'Ezk', 'Ezechiel']],
  ['DN', 'Dn', 'Daniel', 'Dan', 'DAN', ['hebrew', 'aramaic', 'greek'], 'Daniel', ['Dan']],
  ['HOS', 'Hos', 'Hosea', 'Hos', 'HOS', H, 'Osee', ['Osee']],
  ['JL', 'Jl', 'Joel', 'Joel', 'JOL', H, 'Joel', []],
  ['AM', 'Am', 'Amos', 'Amos', 'AMO', H, 'Amos', []],
  ['OB', 'Ob', 'Obadiah', 'Obad', 'OBA', H, 'Abdias', ['Obad', 'Abdias']],
  ['JON', 'Jon', 'Jonah', 'Jonah', 'JON', H, 'Jonas', ['Jonas']],
  ['MI', 'Mi', 'Micah', 'Mic', 'MIC', H, 'Micheas', ['Mic', 'Micheas']],
  ['NA', 'Na', 'Nahum', 'Nah', 'NAM', H, 'Nahum', ['Nah']],
  ['HB', 'Hb', 'Habakkuk', 'Hab', 'HAB', H, 'Habacuc', ['Hab', 'Habacuc']],
  ['ZEP', 'Zep', 'Zephaniah', 'Zeph', 'ZEP', H, 'Sophonias', ['Zeph', 'Sophonias']],
  ['HG', 'Hg', 'Haggai', 'Hag', 'HAG', H, 'Aggeus', ['Hag', 'Aggeus']],
  ['ZEC', 'Zec', 'Zechariah', 'Zech', 'ZEC', H, 'Zacharias', ['Zech', 'Zacharias']],
  ['MAL', 'Mal', 'Malachi', 'Mal', 'MAL', H, 'Malachias', ['Malachias']],
] as const satisfies readonly Row[];

const NEW_TESTAMENT = [
  ['MT', 'Mt', 'Matthew', 'Matt', 'MAT', G, 'Matthew', ['Matt', 'Mat']],
  ['MK', 'Mk', 'Mark', 'Mark', 'MRK', G, 'Mark', ['Mar', 'Mrk']],
  ['LK', 'Lk', 'Luke', 'Luke', 'LUK', G, 'Luke', ['Luk']],
  ['JN', 'Jn', 'John', 'John', 'JHN', G, 'John', ['Joh', 'Jhn']],
  ['ACTS', 'Acts', 'Acts of the Apostles', 'Acts', 'ACT', G, 'Acts of the Apostles', ['Act', 'Ac']],
  ['ROM', 'Rom', 'Romans', 'Rom', 'ROM', G, 'Romans', ['Ro', 'Rm']],
  ['1COR', '1 Cor', '1 Corinthians', '1Cor', '1CO', G, '1 Corinthians', ['1 Co']],
  ['2COR', '2 Cor', '2 Corinthians', '2Cor', '2CO', G, '2 Corinthians', ['2 Co']],
  ['GAL', 'Gal', 'Galatians', 'Gal', 'GAL', G, 'Galatians', ['Ga']],
  ['EPH', 'Eph', 'Ephesians', 'Eph', 'EPH', G, 'Ephesians', []],
  ['PHIL', 'Phil', 'Philippians', 'Phil', 'PHP', G, 'Philippians', ['Php']],
  ['COL', 'Col', 'Colossians', 'Col', 'COL', G, 'Colossians', []],
  ['1THES', '1 Thes', '1 Thessalonians', '1Thess', '1TH', G, '1 Thessalonians', ['1 Thess', '1 Th']],
  ['2THES', '2 Thes', '2 Thessalonians', '2Thess', '2TH', G, '2 Thessalonians', ['2 Thess', '2 Th']],
  ['1TM', '1 Tm', '1 Timothy', '1Tim', '1TI', G, '1 Timothy', ['1 Tim', '1 Ti']],
  ['2TM', '2 Tm', '2 Timothy', '2Tim', '2TI', G, '2 Timothy', ['2 Tim', '2 Ti']],
  ['TI', 'Ti', 'Titus', 'Titus', 'TIT', G, 'Titus', ['Tit']],
  ['PHLM', 'Phlm', 'Philemon', 'Phlm', 'PHM', G, 'Philemon', ['Philem', 'Phm']],
  ['HEB', 'Heb', 'Hebrews', 'Heb', 'HEB', G, 'Hebrews', []],
  ['JAS', 'Jas', 'James', 'Jas', 'JAS', G, 'James', ['Jm']],
  ['1PT', '1 Pt', '1 Peter', '1Pet', '1PE', G, '1 Peter', ['1 Pet', '1 Pe']],
  ['2PT', '2 Pt', '2 Peter', '2Pet', '2PE', G, '2 Peter', ['2 Pet', '2 Pe']],
  ['1JN', '1 Jn', '1 John', '1John', '1JN', G, '1 John', ['1 Jo', '1 Joh']],
  ['2JN', '2 Jn', '2 John', '2John', '2JN', G, '2 John', ['2 Jo', '2 Joh']],
  ['3JN', '3 Jn', '3 John', '3John', '3JN', G, '3 John', ['3 Jo', '3 Joh']],
  ['JUDE', 'Jude', 'Jude', 'Jude', 'JUD', G, 'Jude', []],
  ['RV', 'Rv', 'Revelation', 'Rev', 'REV', G, 'Apocalypse', ['Rev', 'Apocalypse', 'Apoc', 'Revelations']],
] as const satisfies readonly Row[];

/** Upper-cased NABRE abbreviation, the book part of a passage key. */
export type BookCode = (typeof OLD_TESTAMENT)[number][0] | (typeof NEW_TESTAMENT)[number][0];

export interface Book {
  readonly code: BookCode;
  /** 1–73, NABRE canonical order. */
  readonly order: number;
  /** NABRE abbreviation as printed in the lectionary, e.g. `1 Cor`. */
  readonly abbrev: string;
  /** English name, e.g. `1 Corinthians`. */
  readonly name: string;
  /** Other spellings accepted by the parser (code, abbreviation, name and OSIS id are always accepted). */
  readonly aliases: readonly string[];
  readonly osis: string;
  readonly usfm: string;
  readonly testament: Testament;
  readonly languages: readonly Language[];
  readonly douayRheims: { readonly number: number; readonly name: string };
  /** Books with one chapter are cited by verse alone (`Jude 17, 20b-25`). */
  readonly singleChapter: boolean;
}

const SINGLE_CHAPTER: ReadonlySet<string> = new Set(['OB', 'PHLM', '2JN', '3JN', 'JUDE']);

/** Douay-Rheims (Clementine Vulgate) order: the Maccabees follow Malachi. */
const DOUAY_RHEIMS_ORDER: readonly string[] = [
  ...OLD_TESTAMENT.map((row) => row[0]).filter((code) => code !== '1MC' && code !== '2MC'),
  '1MC',
  '2MC',
  ...NEW_TESTAMENT.map((row) => row[0]),
];

function toBook(row: Row, index: number, testament: Testament): Book {
  const [code, abbrev, name, osis, usfm, languages, douayRheimsName, aliases] = row;
  return Object.freeze({
    code: code as BookCode,
    order: index + 1,
    abbrev,
    name,
    aliases,
    osis,
    usfm,
    testament,
    languages,
    douayRheims: Object.freeze({ number: DOUAY_RHEIMS_ORDER.indexOf(code) + 1, name: douayRheimsName }),
    singleChapter: SINGLE_CHAPTER.has(code),
  });
}

/** All 73 books in NABRE canonical order. */
export const BOOKS: readonly Book[] = Object.freeze([
  ...OLD_TESTAMENT.map((row, i) => toBook(row, i, 'OT')),
  ...NEW_TESTAMENT.map((row, i) => toBook(row, OLD_TESTAMENT.length + i, 'NT')),
]);

const BY_CODE: ReadonlyMap<string, Book> = new Map(BOOKS.map((book) => [book.code, book]));

const ORDINAL_PREFIX = /^(i{1,3}|first|second|third|1st|2nd|3rd)\s+/;
const ORDINALS: Readonly<Record<string, string>> = {
  i: '1',
  ii: '2',
  iii: '3',
  first: '1',
  second: '2',
  third: '3',
  '1st': '1',
  '2nd': '2',
  '3rd': '3',
};

/**
 * Normalises a book name for lookup: case, spaces, dots and apostrophes are
 * ignored, and a leading `I`/`II`/`III`, `1st`/`2nd`/`3rd` or `First`/`Second`/`Third` becomes 1/2/3.
 */
export function normalizeBookName(name: string): string {
  const lower = name.trim().toLowerCase();
  const withDigit = lower.replace(ORDINAL_PREFIX, (_, ordinal: string) => `${ORDINALS[ordinal]} `);
  return withDigit.replace(/[\s.'’]+/g, '');
}

/** Maps every normalised alias to its book; throws if two books claim the same alias. */
export function buildAliasIndex(books: readonly Book[]): ReadonlyMap<string, Book> {
  const index = new Map<string, Book>();
  for (const book of books) {
    for (const alias of [book.code, book.abbrev, book.name, book.osis, ...book.aliases]) {
      const key = normalizeBookName(alias);
      const existing = index.get(key);
      if (existing && existing !== book) {
        throw new Error(`Book alias "${alias}" is claimed by both ${existing.code} and ${book.code}`);
      }
      index.set(key, book);
    }
  }
  return index;
}

const BY_ALIAS = buildAliasIndex(BOOKS);

/** True when `value` is one of the 73 book codes. */
export function isBookCode(value: string): value is BookCode {
  return BY_CODE.has(value);
}

/** The book for a code. Throws on an unknown code (use {@link isBookCode} first for untrusted input). */
export function getBook(code: BookCode): Book {
  const book = BY_CODE.get(code);
  if (!book) throw new Error(`Unknown book code "${code}"`);
  return book;
}

/** Looks a book up by code, abbreviation, name, OSIS id or alias; `undefined` if none matches. */
export function findBook(name: string): Book | undefined {
  return BY_ALIAS.get(normalizeBookName(name));
}

/** Every normalised alias and the book it resolves to (for tests and diagnostics). */
export function bookAliases(): ReadonlyMap<string, BookCode> {
  return new Map([...BY_ALIAS].map(([alias, book]) => [alias, book.code]));
}
