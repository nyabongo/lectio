/**
 * The original-language text of a passage, read from the repository corpus (openly licensed
 * critical editions, never a translation): Greek for the New Testament, Hebrew for the Hebrew Old
 * Testament and the Latin Vulgate for books or verses the Hebrew edition lacks (the deuterocanonical
 * books, the Greek additions to Esther and Daniel).
 */
import type { Corpus } from '@lectio/corpus';
import { enumerateVerses, fromKey, getBook, mapVerse, verseCounts } from '@lectio/refs';
import type { Book, Scheme, VerseId } from '@lectio/refs';

/** A corpus edition and the versification scheme its verse files follow. */
export interface EditionChoice {
  readonly edition: string;
  readonly scheme: Scheme;
}

export const GREEK_NT: EditionChoice = { edition: 'grc-sblgnt', scheme: 'original' };
export const HEBREW_OT: EditionChoice = { edition: 'hbo-oshb', scheme: 'original' };
export const LATIN_VULGATE: EditionChoice = { edition: 'lat-vulgate-clementine', scheme: 'vulgate' };

/** Editions to try for a book, in order: the first that has a verse supplies it. */
export function defaultEditions(book: Pick<Book, 'testament' | 'languages'>): readonly EditionChoice[] {
  if (book.testament === 'NT') return [GREEK_NT];
  if (book.languages.includes('hebrew')) return [HEBREW_OT, LATIN_VULGATE];
  return [LATIN_VULGATE];
}

export interface OriginalVerse {
  /** `chapter:verse` in the passage's own (original) numbering, as translation notes cite it. */
  readonly verse: string;
  readonly edition: string;
  readonly language: string;
  /** The verse's surface forms joined by spaces. */
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

const label = (verse: VerseId): string => `${String(verse.c)}:${String(verse.v)}`;

async function findVerse(
  corpus: Corpus,
  verse: VerseId,
  choices: readonly EditionChoice[],
): Promise<{ choice: EditionChoice; text: string } | undefined> {
  for (const choice of choices) {
    let mapped: VerseId = verse;
    if (choice.scheme !== 'original') {
      try {
        mapped = mapVerse(verse, 'original', choice.scheme);
      } catch {
        continue;
      }
    }
    const tokens = await corpus.getVerse(choice.edition, mapped.book, mapped.c, mapped.v);
    if (tokens !== undefined && tokens.length > 0) {
      return { choice, text: tokens.map(([surface]) => surface).join(' ') };
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
    lines.push(`Edition \`${edition.edition}\`: ${edition.name} (${edition.language}, ${edition.licence}).`);
  }
  if (lines.length > 0) lines.push('');
  for (const verse of original.verses) lines.push(`- ${verse.verse} (${verse.edition}): ${verse.text}`);
  if (original.missing.length > 0) {
    if (original.verses.length > 0) lines.push('');
    lines.push(`The corpus has no original-language text for: ${original.missing.join(', ')}.`);
  }
  return lines.join('\n');
}
