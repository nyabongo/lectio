/**
 * The original-language text of a passage, read from the repository corpus (openly licensed
 * critical editions): Greek (SBLGNT) for the New Testament; Hebrew and Aramaic (OSHB) for the
 * Hebrew Old Testament; the Greek Septuagint (`grc-lxx`) for the deuterocanonical books and the
 * Greek parts of Esther and Daniel. The Latin Vulgate, an ancient translation, is only a last resort.
 */
import type { Corpus } from '@lectio/corpus';
import {
  chapterLabel,
  enumerateVerses,
  fromKey,
  getBook,
  isLetteredChapter,
  mapVerse,
  notInOriginal,
  toSourceVerse,
  verseCounts,
} from '@lectio/refs';
import type { Book, Scheme, VerseId } from '@lectio/refs';

/**
 * How an edition numbers its verse files: a versification scheme of `@lectio/refs`, or `source`
 * for the numbering of the underlying `.vrs` source text. OSHB follows the Masoretic numbering:
 * Lectio's Dn 3:91-100 is its Dn 3:24-33, and the Greek additions (Dn 3:24-90, 13, 14) are not in it.
 */
export type EditionNumbering = Scheme | 'source';

/** A corpus edition and how its verse files are numbered. */
export interface EditionChoice {
  readonly edition: string;
  readonly scheme: EditionNumbering;
}

export const GREEK_NT: EditionChoice = { edition: 'grc-sblgnt', scheme: 'original' };
export const HEBREW_OT: EditionChoice = { edition: 'hbo-oshb', scheme: 'source' };
export const GREEK_LXX: EditionChoice = { edition: 'grc-lxx', scheme: 'lxx' };
export const LATIN_VULGATE: EditionChoice = { edition: 'lat-vulgate-clementine', scheme: 'vulgate' };

/** Editions to try for a book, in order: the first that has a verse supplies it. */
export function defaultEditions(book: Pick<Book, 'testament' | 'languages'>): readonly EditionChoice[] {
  if (book.testament === 'NT') return [GREEK_NT];
  if (book.languages.includes('hebrew')) return [HEBREW_OT, GREEK_LXX, LATIN_VULGATE];
  return [GREEK_LXX, LATIN_VULGATE];
}

export interface OriginalVerse {
  /** `chapter:verse` in the passage's own (original) numbering, as translation notes cite it. */
  readonly verse: string;
  readonly edition: string;
  readonly language: string;
  /** The verse's surface forms joined by spaces, cleaned for the prompt (see {@link cleanSurface}). */
  readonly text: string;
}

export interface OriginalEdition {
  readonly edition: string;
  readonly name: string;
  readonly language: string;
  readonly licence: string;
}

export interface OriginalText {
  readonly verses: readonly OriginalVerse[];
  /** Editions that supplied at least one verse, in first-use order. */
  readonly editions: readonly OriginalEdition[];
  /** Verses (`chapter:verse`) no edition has. */
  readonly missing: readonly string[];
}

export interface LoadOriginalOptions {
  /** Editions per book. Default {@link defaultEditions}. */
  readonly editionsFor?: (book: Book) => readonly EditionChoice[];
}

const label = (verse: VerseId): string => `${chapterLabel(verse.book, verse.c)}:${String(verse.v)}`;

/** Hebrew cantillation marks (U+0591–U+05AF); vowel points are kept. */
const CANTILLATION = /[֑-֯]/gu;

/**
 * A surface form as the prompt shows it: OSHB's `/` morpheme separators and the cantillation
 * marks are removed (the corpus checks ignore both), so the model never copies them into notes.
 */
export function cleanSurface(surface: string): string {
  return surface.replaceAll('/', '').replace(CANTILLATION, '');
}

/** Where a verse (Lectio's `original` numbering) sits in an edition's files, or `undefined` when it is not there. */
export function locateVerse(
  verse: VerseId,
  scheme: EditionNumbering,
): { readonly chapter: string; readonly verse: number } | undefined {
  try {
    if (scheme === 'source') {
      // The Greek additions are not in the source text; other books' source numbering is never read.
      if (notInOriginal(verse)) return undefined;
      const source = toSourceVerse(verse);
      if (source.book !== getBook(verse.book).usfm) return undefined;
      return { chapter: String(source.c), verse: source.v };
    }
    // Esther's lettered chapters (A–F) keep their letter and verse numbers in the editions that have them.
    if (scheme === 'original' || isLetteredChapter(verse.book, verse.c)) {
      return { chapter: chapterLabel(verse.book, verse.c), verse: verse.v };
    }
    const mapped = mapVerse(verse, 'original', scheme);
    return { chapter: String(mapped.c), verse: mapped.v };
  } catch {
    return undefined;
  }
}

async function findVerse(
  corpus: Corpus,
  verse: VerseId,
  choices: readonly EditionChoice[],
): Promise<{ choice: EditionChoice; text: string } | undefined> {
  for (const choice of choices) {
    const at = locateVerse(verse, choice.scheme);
    if (at === undefined) continue;
    const tokens = await corpus.getVerse(choice.edition, verse.book, at.chapter, at.verse);
    if (tokens !== undefined && tokens.length > 0) {
      return { choice, text: tokens.map(([surface]) => cleanSurface(surface)).join(' ') };
    }
  }
  return undefined;
}

/** Reads every verse of the passage `key` from the corpus. */
export async function loadOriginalText(
  corpus: Corpus,
  key: string,
  options: LoadOriginalOptions = {},
): Promise<OriginalText> {
  const ref = fromKey(key);
  const book = getBook(ref.book);
  const choices = (options.editionsFor ?? defaultEditions)(book);
  const verses: OriginalVerse[] = [];
  const missing: string[] = [];
  const editions = new Map<string, OriginalEdition>();
  for (const verse of enumerateVerses(ref, verseCounts('original'))) {
    const found = await findVerse(corpus, verse, choices);
    if (found === undefined) {
      missing.push(label(verse));
      continue;
    }
    let edition = editions.get(found.choice.edition);
    if (edition === undefined) {
      const source = await corpus.source(found.choice.edition);
      edition = {
        edition: found.choice.edition,
        name: source.name,
        language: source.language,
        licence: source.licence,
      };
      editions.set(edition.edition, edition);
    }
    verses.push({ verse: label(verse), edition: edition.edition, language: edition.language, text: found.text });
  }
  return { verses, editions: [...editions.values()], missing };
}

/** The original text as Markdown for the prompt. */
export function formatOriginalText(original: OriginalText): string {
  const lines: string[] = [];
  for (const edition of original.editions) {
    const caveat =
      edition.language === 'lat' ? ' This is an ancient translation, not the original: cite it only as a witness.' : '';
    lines.push(`Edition \`${edition.edition}\`: ${edition.name} (${edition.language}, ${edition.licence}).${caveat}`);
  }
  if (lines.length > 0) lines.push('');
  for (const verse of original.verses) lines.push(`- ${verse.verse} (${verse.edition}): ${verse.text}`);
  if (original.missing.length > 0) {
    if (original.verses.length > 0) lines.push('');
    lines.push(`The corpus has no original-language text for: ${original.missing.join(', ')}.`);
  }
  return lines.join('\n');
}
