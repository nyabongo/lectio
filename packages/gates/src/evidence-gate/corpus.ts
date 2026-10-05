/**
 * Corpus lookups for the evidence gate: which in-repo edition holds the original text of a verse
 * in a language (grc → SBLGNT for the New Testament and the Septuagint for the Old, hbo/arc →
 * OSHB, lat → Clementine Vulgate), how a canonical verse is numbered in that edition, and whether
 * the words of a phrase occur in a run of verses (surface or lemma, after the corpus normalisers:
 * accent-insensitive Greek, stem-aware Hebrew).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { lemmaKey, openCorpus, phraseWords, tokenForms } from '@lectio/corpus';
import type { Language, Token } from '@lectio/corpus';
import { SCHEMES, getBook, mapVerse, toSourceVerse } from '@lectio/refs';
import type { BookCode, Scheme, VerseId } from '@lectio/refs';

export const EDITIONS = {
  greekNt: 'grc-sblgnt',
  greekOt: 'grc-lxx',
  hebrew: 'hbo-oshb',
  latin: 'lat-vulgate-clementine',
} as const;

/** What the gate needs from the corpus; {@link openEvidenceCorpus} reads the in-repo one. */
export interface EvidenceCorpus {
  /** The edition's language and versification scheme, or undefined when the corpus lacks the edition. */
  edition(id: string): Promise<{ readonly language: Language; readonly versification: string } | undefined>;
  /** Whether the edition has any chapter of the book. */
  hasBook(edition: string, book: string): Promise<boolean>;
  /** The verse's tokens (in the edition's own numbering), or undefined when it is not there. */
  getVerse(edition: string, book: string, chapter: number, verse: number): Promise<readonly Token[] | undefined>;
}

/** The corpus under `root` (normally `<repo>/corpus`). */
export function openEvidenceCorpus(root: string): EvidenceCorpus {
  const corpus = openCorpus(root);
  let editions: Promise<string[]> | undefined;
  return {
    async edition(id) {
      editions ??= corpus.editions();
      if (!(await editions).includes(id)) return undefined;
      const { language, versification } = await corpus.source(id);
      return { language, versification };
    },
    hasBook: (edition, book) => Promise.resolve(existsSync(join(root, edition, book))),
    getVerse: (edition, book, chapter, verse) => corpus.getVerse(edition, book, chapter, verse),
  };
}

/** A language the corpus can check: the original languages of translation notes. */
export type CorpusLanguage = 'grc' | 'hbo' | 'arc' | 'lat';

const CORPUS_LANGUAGES: ReadonlySet<string> = new Set<CorpusLanguage>(['grc', 'hbo', 'arc', 'lat']);

export function isCorpusLanguage(lang: string | undefined): lang is CorpusLanguage {
  return lang !== undefined && CORPUS_LANGUAGES.has(lang);
}

const LANGUAGE_NAMES: Readonly<Record<CorpusLanguage, string>> = {
  grc: 'Greek',
  hbo: 'Hebrew',
  arc: 'Aramaic',
  lat: 'Latin',
};

export function languageName(lang: CorpusLanguage): string {
  return LANGUAGE_NAMES[lang];
}

/** The edition for `lang` in `book`, or a reason the book has no original text in that language. */
export function editionFor(
  lang: CorpusLanguage,
  book: BookCode,
): { readonly edition: string } | { readonly reason: string } {
  const info = getBook(book);
  if (lang === 'lat') return { edition: EDITIONS.latin };
  if (lang === 'grc') return { edition: info.testament === 'NT' ? EDITIONS.greekNt : EDITIONS.greekOt };
  if (info.languages.includes('hebrew') || info.languages.includes('aramaic')) return { edition: EDITIONS.hebrew };
  return { reason: `${info.name} has no Hebrew or Aramaic original` };
}

function schemeOf(versification: string): Scheme {
  return (SCHEMES as readonly string[]).includes(versification) ? (versification as Scheme) : 'original';
}

/**
 * The chapter and verse of canonical (`original`) verse `verse` in an edition numbered by
 * `versification`: mapped to the edition's scheme, then to the `.vrs` numbering the corpus files
 * use when that stays in the same book (OSHB stores Lectio's Daniel 3:91 as 3:24). Undefined when
 * the scheme has no counterpart.
 */
export function editionVerse(verse: VerseId, versification: string): { c: number; v: number } | undefined {
  const scheme = schemeOf(versification);
  let mapped: VerseId;
  try {
    mapped = scheme === 'original' ? verse : mapVerse(verse, 'original', scheme);
    const source = toSourceVerse(mapped, scheme);
    if (source.book === getBook(verse.book).usfm) return { c: source.c, v: source.v };
  } catch {
    return undefined;
  }
  return { c: mapped.c, v: mapped.v };
}

export type VerseLookup =
  | {
      readonly kind: 'ok';
      readonly edition: string;
      readonly language: Language;
      /** Tokens of every verse found, in order. */
      readonly tokens: readonly Token[];
      /** Canonical verses the edition lacks. */
      readonly missing: readonly VerseId[];
    }
  /** The text cannot be checked (no such edition or book in the corpus yet): needs review, not a failure. */
  | { readonly kind: 'unavailable'; readonly reason: string }
  /** The book has no original text in that language: a failure. */
  | { readonly kind: 'no-original'; readonly reason: string };

/** The tokens of canonical verses `verses` (all of one book) in the edition for `lang`. */
export async function lookupVerses(
  corpus: EvidenceCorpus,
  lang: CorpusLanguage,
  book: BookCode,
  verses: readonly VerseId[],
): Promise<VerseLookup> {
  const choice = editionFor(lang, book);
  if ('reason' in choice) return { kind: 'no-original', reason: choice.reason };
  const { edition } = choice;
  const info = await corpus.edition(edition);
  if (info === undefined) {
    return { kind: 'unavailable', reason: `the corpus has no edition ${edition} yet` };
  }
  if (!(await corpus.hasBook(edition, book))) {
    return { kind: 'unavailable', reason: `${edition} has no ${getBook(book).name}` };
  }
  const tokens: Token[] = [];
  const missing: VerseId[] = [];
  for (const verse of verses) {
    const at = editionVerse(verse, info.versification);
    const found = at === undefined ? undefined : await corpus.getVerse(edition, book, at.c, at.v);
    if (found === undefined) missing.push(verse);
    else tokens.push(...found);
  }
  return { kind: 'ok', edition, language: info.language, tokens, missing };
}

/** Splits text at ellipses (`…`, `...`) into the runs of words it quotes. */
export function phrasePieces(language: Language, text: string): string[][] {
  return text
    .split(/…|\.{3,}/u)
    .map((piece) => phraseWords(language, piece))
    .filter((words) => words.length > 0);
}

/** A predicate for one normalised query word against each token (surface or lemma). */
export function tokenMatcher(language: Language, tokens: readonly Token[]): (index: number, word: string) => boolean {
  const forms = tokens.map(
    ([surface, lemma, morph]) =>
      [
        new Set(tokenForms(language, surface, morph === undefined ? {} : { morph })),
        new Set(tokenForms(language, lemma, { field: 'lemma' })),
      ] as const,
  );
  return (index, word) => {
    const [surface, lemma] = forms[index] as (typeof forms)[number];
    return surface.has(word) || lemma.has(lemmaKey(word));
  };
}

/** Whether each ellipsis-separated piece of `text` occurs as consecutive tokens, pieces in order. */
export function phraseInTokens(language: Language, tokens: readonly Token[], text: string): boolean {
  const pieces = phrasePieces(language, text);
  if (pieces.length === 0) return false;
  const matches = tokenMatcher(language, tokens);
  let from = 0;
  for (const words of pieces) {
    let found = -1;
    for (let start = from; start + words.length <= tokens.length && found < 0; start += 1) {
      if (words.every((word, offset) => matches(start + offset, word))) found = start;
    }
    if (found < 0) return false;
    from = found + words.length;
  }
  return true;
}

/**
 * The words of `text` that match no token (surface or lemma), as written, in order; empty when
 * every word occurs. Words need not be adjacent: a note may quote words the verse separates.
 */
export function wordsNotInTokens(language: Language, tokens: readonly Token[], text: string): string[] {
  const matches = tokenMatcher(language, tokens);
  return text
    .split(/[\s־]+|…|\.{3,}/u)
    .filter((part) => phraseWords(language, part).some((word) => !tokens.some((_, index) => matches(index, word))));
}
