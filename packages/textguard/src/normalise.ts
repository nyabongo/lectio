/**
 * English normaliser and tokeniser.
 *
 * Both the index builder and the guard tokenise with these functions, so a run
 * is found regardless of case, accents, curly or straight apostrophes,
 * punctuation and line breaks. Hyphens and dashes separate words. Number-only
 * tokens (inline verse numbers such as "16" or "¹⁷") are transparent: they are
 * dropped, so a run is not split by the verse numbers quoted inside it.
 */

/** Bumped whenever normalisation or hashing changes; recorded in SOURCE.json (older indexes must be rebuilt). */
export const NORMALISER_VERSION = 2;

/** A word in the original text: its normalised form and its UTF-16 offsets (`end` exclusive). */
export interface Token {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’ʼ][\p{L}\p{N}]+)*/gu;
const MARKS = /\p{M}/gu;
const NOT_WORD_CHAR = /[^\p{L}\p{N}]/gu;
const NUMBER_ONLY = /^\p{N}+$/u;
const LIGATURES: Readonly<Record<string, string>> = { æ: 'ae', œ: 'oe', ß: 'ss', ø: 'o', ð: 'd', þ: 'th' };
const LIGATURE = /[æœßøðþ]/gu;

/** Lower-cases and strips diacritics, apostrophes and ligatures: `Lord’s` → `lords`, `Æneas` → `aeneas`. */
export function normaliseWord(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(LIGATURE, (ch) => LIGATURES[ch] as string)
    .replace(NOT_WORD_CHAR, '');
}

/** Splits text into normalised words with their offsets in the original string; skips number-only tokens. */
export function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = normaliseWord(match[0]);
    if (word === '' || NUMBER_ONLY.test(word)) continue;
    tokens.push({ word, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}
