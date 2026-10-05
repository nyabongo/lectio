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
 * The normalised forms a corpus token (surface or lemma) matches. Hebrew and Aramaic editions such as OSHB mark
 * morpheme boundaries with "/" (`הַ/שָּׁמַ֖יִם`, lemma `d/8064`): the token matches every contiguous run of its
 * segments, so the whole word (`השמים`), the bare word without its prefixes (`שמים`, `8064`) and any prefix run all
 * match. Other languages have one form: the whole normalised token. An empty token matches nothing.
 */
export function tokenForms(language: Language, text: string): string[] {
  const normalise = normaliserFor(language);
  const raw = language === 'hbo' || language === 'arc' ? text.split('/') : [text];
  const segments = raw.map((part) => normalise(part)).filter((part) => part !== '');
  const forms: string[] = [];
  for (let start = 0; start < segments.length; start += 1) {
    for (let end = start + 1; end <= segments.length; end += 1) {
      forms.push(segments.slice(start, end).join(''));
    }
  }
  return forms;
}

/**
 * Splits a phrase into normalised words at whitespace and at the Hebrew maqaf, which joins words in writing but
 * separates tokens in the corpus. A "/" morpheme separator inside a query word is stripped, so the word compares
 * as a whole.
 */
export function phraseWords(language: Language, phrase: string): string[] {
  const normalise = normaliserFor(language);
  return phrase
    .split(/[\s\u05BE]+/u)
    .map((word) => normalise(word))
    .filter((word) => word !== '');
}
