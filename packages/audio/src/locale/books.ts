/**
 * Kiswahili book names, after the Catholic Biblia Takatifu: how each book is said in narration and
 * the names and abbreviations Kiswahili prose writes (`Mathayo 6:22`, `Kum 15:9`, `1 Kor 13:4`).
 * Standard English abbreviations (`Mt`, `Deut`) are still understood through `@lectio/refs`.
 */
import type { BookCode } from '@lectio/refs';

export interface SwahiliBook {
  /** The book as a listener hears it (`Kumbukumbu la Torati`, `Wakorintho wa Kwanza`). */
  readonly spoken: string;
  /** Written forms in Kiswahili prose, besides the spoken name; a digit prefix may drop its space. */
  readonly written: readonly string[];
}

const book = (spoken: string, ...written: string[]): SwahiliBook => ({ spoken, written });

/** Every book of the Catholic canon. */
export const SWAHILI_BOOKS: Readonly<Record<BookCode, SwahiliBook>> = {
  GN: book('Mwanzo', 'Mwa'),
  EX: book('Kutoka', 'Kut'),
  LV: book('Mambo ya Walawi', 'Walawi', 'Law'),
  NM: book('Hesabu', 'Hes'),
  DT: book('Kumbukumbu la Torati', 'Kumbukumbu', 'Kum'),
  JOS: book('Yoshua', 'Yos'),
  JGS: book('Waamuzi', 'Amu'),
  RU: book('Ruthu', 'Rut'),
  '1SM': book('Samweli wa Kwanza', '1 Samweli', '1 Sam'),
  '2SM': book('Samweli wa Pili', '2 Samweli', '2 Sam'),
  '1KGS': book('Wafalme wa Kwanza', '1 Wafalme', '1 Fal'),
  '2KGS': book('Wafalme wa Pili', '2 Wafalme', '2 Fal'),
  '1CHR': book('Mambo ya Nyakati ya Kwanza', '1 Mambo ya Nyakati', '1 Nya'),
  '2CHR': book('Mambo ya Nyakati ya Pili', '2 Mambo ya Nyakati', '2 Nya'),
  EZR: book('Ezra', 'Ezr'),
  NEH: book('Nehemia', 'Neh'),
  TB: book('Tobiti', 'Tob'),
  JDT: book('Yudithi', 'Ydt'),
  EST: book('Esta', 'Est'),
  '1MC': book('Wamakabayo wa Kwanza', '1 Wamakabayo', '1 Mak'),
  '2MC': book('Wamakabayo wa Pili', '2 Wamakabayo', '2 Mak'),
  JB: book('Ayubu', 'Ayu'),
  PS: book('Zaburi', 'Zab'),
  PRV: book('Mithali', 'Mit'),
  ECCL: book('Mhubiri', 'Mhu'),
  SG: book('Wimbo Ulio Bora', 'Wimbo', 'Wim'),
  WIS: book('Hekima', 'Hekima ya Sulemani', 'Hek'),
  SIR: book('Yoshua bin Sira', 'Sira', 'YbS'),
  IS: book('Isaya', 'Isa'),
  JER: book('Yeremia', 'Yer'),
  LAM: book('Maombolezo', 'Omb'),
  BAR: book('Baruku', 'Bar'),
  EZ: book('Ezekieli', 'Eze'),
  DN: book('Danieli', 'Dan'),
  HOS: book('Hosea', 'Hos'),
  JL: book('Yoeli', 'Yoe'),
  AM: book('Amosi', 'Amo'),
  OB: book('Obadia', 'Oba'),
  JON: book('Yona', 'Yon'),
  MI: book('Mika', 'Mik'),
  NA: book('Nahumu', 'Nah'),
  HB: book('Habakuki', 'Hab'),
  ZEP: book('Sefania', 'Sef'),
  HG: book('Hagai', 'Hag'),
  ZEC: book('Zekaria', 'Zek'),
  MAL: book('Malaki', 'Mal'),
  MT: book('Mathayo', 'Mt', 'Mat'),
  MK: book('Marko', 'Mk', 'Mar'),
  LK: book('Luka', 'Lk', 'Lu'),
  JN: book('Yohana', 'Yn', 'Yoh'),
  ACTS: book('Matendo ya Mitume', 'Matendo', 'Mdo'),
  ROM: book('Warumi', 'Rum', 'Rm'),
  '1COR': book('Wakorintho wa Kwanza', '1 Wakorintho', '1 Kor'),
  '2COR': book('Wakorintho wa Pili', '2 Wakorintho', '2 Kor'),
  GAL: book('Wagalatia', 'Gal'),
  EPH: book('Waefeso', 'Efe'),
  PHIL: book('Wafilipi', 'Flp'),
  COL: book('Wakolosai', 'Kol'),
  '1THES': book('Wathesalonike wa Kwanza', '1 Wathesalonike', '1 The'),
  '2THES': book('Wathesalonike wa Pili', '2 Wathesalonike', '2 The'),
  '1TM': book('Timotheo wa Kwanza', '1 Timotheo', '1 Tim'),
  '2TM': book('Timotheo wa Pili', '2 Timotheo', '2 Tim'),
  TI: book('Tito', 'Tit'),
  PHLM: book('Filemoni', 'Flm'),
  HEB: book('Waebrania', 'Ebr'),
  JAS: book('Yakobo', 'Yak'),
  '1PT': book('Petro wa Kwanza', '1 Petro', '1 Pet'),
  '2PT': book('Petro wa Pili', '2 Petro', '2 Pet'),
  '1JN': book('Yohana wa Kwanza', '1 Yohana', '1 Yoh', '1 Yn'),
  '2JN': book('Yohana wa Pili', '2 Yohana', '2 Yoh', '2 Yn'),
  '3JN': book('Yohana wa Tatu', '3 Yohana', '3 Yoh', '3 Yn'),
  JUDE: book('Yuda', 'Yud'),
  RV: book('Ufunuo', 'Ufunuo wa Yohana', 'Ufu'),
};

/** A written form's lookup key: lower case, no full stop, single spaces, no space after a leading digit. */
function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/^([1-3]) /, '$1');
}

/** Every written form with its book. The tests check that no form names two books. */
export function swahiliBookEntries(): [name: string, code: BookCode][] {
  return (Object.entries(SWAHILI_BOOKS) as [BookCode, SwahiliBook][]).flatMap(([code, { spoken, written }]) =>
    [spoken, ...written].map((name): [string, BookCode] => [name, code]),
  );
}

const BY_NAME: ReadonlyMap<string, BookCode> = new Map(
  swahiliBookEntries().map(([name, code]) => [normalise(name), code]),
);

/** The book a Kiswahili name or abbreviation names (`Mathayo`, `Kum.`, `1Kor`), or `undefined`. */
export function findSwahiliBook(name: string): BookCode | undefined {
  return BY_NAME.get(normalise(name));
}

/** Every written form, longest first, for building a matcher; `1 Kor` also matches `1Kor`. */
export function swahiliBookNames(): string[] {
  return swahiliBookEntries()
    .map(([name]) => name)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}
