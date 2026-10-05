/**
 * Normalisers make word comparison insensitive to the marks editions and writers disagree on: Greek accents and
 * breathings, Hebrew pointing and cantillation, Latin spelling variants. Each returns the bare comparison form of
 * one word (or a short run of words, collapsed to single spaces).
 */
import type { Language } from './format.ts';

/** Any combining mark (accents, breathings, iota subscript, niqqud, cantillation, macrons…). */
const MARKS = /\p{M}/gu;
/** Punctuation, symbols and invisible format characters (ZWJ, LRM…). */
const PUNCTUATION = /[\p{P}\p{S}\p{Cf}]/gu;
/** Greek elision and spacing breathing/koronis marks that are letters or symbols, not punctuation. */
const GREEK_ELISION = /[\u02BC\u1FBD\u1FBF\u1FFE]/gu;
/** Hebrew points, accents and punctuation: niqqud, cantillation, maqaf, paseq, sof pasuq (U+0591–U+05C7). */
const HEBREW_POINTS = /[\u0591-\u05C7]/gu;
const SPACES = /\s+/gu;

function tidy(text: string): string {
  return text.replace(SPACES, ' ').trim();
}

/**
 * Greek: NFD, strip accents and breathings, lower-case, final and lunate sigma to σ, strip punctuation and elision
 * marks.
 */
export function normaliseGreek(text: string): string {
  return tidy(
    text
      .normalize('NFD')
      .replace(MARKS, '')
      .replace(GREEK_ELISION, '')
      .replace(PUNCTUATION, '')
      .toLowerCase()
      .replace(/[ςϲ]/gu, 'σ'),
  );
}

/** Hebrew and Aramaic: strip niqqud, cantillation, maqaf and sof pasuq, fold final letter forms, strip punctuation. */
export function normaliseHebrew(text: string): string {
  return tidy(
    text
      .normalize('NFD')
      .replace(HEBREW_POINTS, '')
      .replace(MARKS, '')
      .replace(PUNCTUATION, '')
      .replace(/ך/gu, 'כ')
      .replace(/ם/gu, 'מ')
      .replace(/ן/gu, 'נ')
      .replace(/ף/gu, 'פ')
      .replace(/ץ/gu, 'צ'),
  );
}

/** Latin: lower-case, strip diacritics, æ/ǽ→ae, œ→oe, j→i, strip punctuation. */
export function normaliseLatin(text: string): string {
  return tidy(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(MARKS, '')
      .replace(/æ/gu, 'ae')
      .replace(/œ/gu, 'oe')
      .replace(PUNCTUATION, '')
      .replace(/j/gu, 'i'),
  );
}

/** The normaliser for an edition's language. */
export function normaliserFor(language: Language): (text: string) => string {
  switch (language) {
    case 'grc':
      return normaliseGreek;
    case 'hbo':
    case 'arc':
      return normaliseHebrew;
    case 'lat':
      return normaliseLatin;
  }
}

/**
 * A Strong's number with an OSHB homograph letter, after any prefix codes: `1254 a`, `6213a`, `c6213 a`. Group 1 is
 * the number with its prefixes, group 2 the letter.
 */
const HOMOGRAPH = /^([A-Za-z]*[0-9]+) ?([A-Za-z])$/u;
/** A query word that is a (prefixed) Strong's number, or a lone Latin letter that may be its homograph letter. */
const STRONGS_NUMBER = /^[A-Za-z]*[0-9]+$/u;
const LATIN_LETTER = /^[A-Za-z]$/u;

/**
 * The canonical spelling of a normalised lemma or lemma query: a homograph letter is joined to its number and
 * lower-cased (`1254 a`, `1254A` and `1254a` all become `1254a`; `c6213 a` becomes `c6213a`). Any other word is
 * returned unchanged. Corpus lemmas and lemma queries are both compared in this form.
 */
export function lemmaKey(word: string): string {
  return word.replace(HOMOGRAPH, (_match, number: string, letter: string) => `${number}${letter.toLowerCase()}`);
}

/** Whether a token field is the surface form or the lemma. */
export type TokenField = 'surface' | 'lemma';

export interface TokenFormsOptions {
  /** Default `'surface'`. Lemmas get the homograph rule; surfaces use `morph` to find the stem. */
  readonly field?: TokenField;
  /** The token's OSHB morphology code (its third element), e.g. `HR/Ncmsc/Sp3ms`. Used for Hebrew/Aramaic surfaces. */
  readonly morph?: string;
}

/** A morph segment after the stem: a pronominal or paragogic suffix (`S…`), or the Aramaic postfixed article (`Td`). */
function isSuffixCode(code: string): boolean {
  return code.startsWith('S') || code === 'Td';
}

/**
 * The index of the stem among `count` "/" segments. OSHB morph codes have one segment per surface segment; the stem
 * is the last segment that is not a suffix. Without a morph, or when the counts differ, the stem is the last segment.
 */
function stemIndex(count: number, morph: string | undefined): number {
  const codes = morph === undefined ? [] : morph.split('/');
  let stem = count - 1;
  if (codes.length !== count) return stem;
  while (stem > 0 && isSuffixCode(codes[stem] as string)) stem -= 1;
  return stem;
}

/** Every contiguous run of `segments` that contains `stem`, joined, without empties or duplicates. */
function runsContaining(segments: readonly string[], stem: number, into: Set<string>): void {
  for (let start = 0; start <= stem; start += 1) {
    for (let end = stem + 1; end <= segments.length; end += 1) into.add(segments.slice(start, end).join(''));
  }
}

/**
 * The normalised forms a corpus token (surface or lemma) matches.
 *
 * Hebrew and Aramaic editions such as OSHB split a word with "/" into prefixes, a stem and suffixes: `הַ/שָּׁמַ֖יִם`
 * (morph `HTd/Ncmpa`, lemma `d/8064`), `לְ/מִינ֔/וֹ` (morph `HR/Ncmsc/Sp3ms`, lemma `l/4327`). The token matches every
 * contiguous run of its segments that contains the stem: `מין`, `למין`, `מינו` and `למינו` all match `לְ/מִינ֔/וֹ`.
 * A prefix or suffix never matches on its own (`ל` and `ו` do not match it, `ה` does not match `הַ/שָּׁמַ֖יִם`), so a
 * query cannot pass on an article, a conjunction or a pronominal suffix alone.
 *
 * The stem is found from `morph` (see stemIndex): trailing segments coded `S…` (suffixes) or `Td` (the Aramaic
 * postfixed article, as in `מַלְכָּ/א` `ANcmsd/Td`) are suffixes; everything before the stem is a prefix. Without a
 * morph, or when its segment count differs from the surface's, the stem is the last segment. OSHB lemmas list no
 * suffixes, so a lemma's stem is always its last segment: lemma `d` does not match `d/8064`, `8064` and `d8064` do.
 *
 * Lemmas only: OSHB writes some Strong's numbers with a homograph letter (`1254 a`, `c/6213 a`). Lemma forms use the
 * lemmaKey spelling (`1254a`) and also include the bare number, so `1254` matches `1254 a`, and `6213` matches
 * `c/6213 a`. Queries must be passed through lemmaKey too (`openCorpus` does this), so `1254a`, `1254 a` and `1254A`
 * all match only that homograph: `1254 b` does not match `1254 a`.
 *
 * Other languages have one segment: the whole normalised token. An empty token matches nothing.
 */
export function tokenForms(language: Language, text: string, options: TokenFormsOptions = {}): string[] {
  const field = options.field ?? 'surface';
  const normalise = normaliserFor(language);
  const hebrew = language === 'hbo' || language === 'arc';
  const segments = (hebrew ? text.split('/') : [text]).map((part) => normalise(part));
  const last = segments.length - 1;
  const forms = new Set<string>();
  if (field === 'surface') {
    runsContaining(segments, hebrew ? stemIndex(segments.length, options.morph) : last, forms);
  } else {
    segments[last] = lemmaKey(segments[last] as string);
    runsContaining(segments, last, forms);
    const bare = HOMOGRAPH.exec(segments[last] as string)?.[1];
    if (bare !== undefined) runsContaining([...segments.slice(0, last), bare], last, forms);
  }
  forms.delete('');
  return [...forms];
}

/** Languages whose corpus lemmas are Strong's numbers (OSHB-style `1254 a`). */
const STRONGS_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['hbo', 'arc']);

/**
 * Splits a phrase into normalised words at whitespace and at the Hebrew maqaf, which joins words in writing but
 * separates tokens in the corpus. A "/" morpheme separator inside a query word is stripped, so the word compares
 * as a whole. In Hebrew and Aramaic, whose lemmas are Strong's numbers with suffix letters, a Strong's number
 * followed by a lone Latin letter is one word in its lemmaKey spelling, so the lemma phrase `7225 1254 a 430` has
 * three words (`7225`, `1254a`, `430`); other languages keep the letter as a word of its own.
 */
export function phraseWords(language: Language, phrase: string): string[] {
  const normalise = normaliserFor(language);
  const strongs = STRONGS_LANGUAGES.has(language);
  const words: string[] = [];
  for (const part of phrase.split(/[\s־]+/u)) {
    const word = normalise(part);
    const previous = words.at(-1);
    if (strongs && previous !== undefined && LATIN_LETTER.test(word) && STRONGS_NUMBER.test(previous)) {
      words[words.length - 1] = lemmaKey(`${previous} ${word}`);
    } else if (word !== '') {
      words.push(word);
    }
  }
  return words;
}
