/**
 * Text helpers for the licence guard: the prose fields of a passage note, quoted spans inside
 * them, and word counts. Words are counted with the guard's own tokeniser (`@lectio/textguard`),
 * so every limit means the same thing in every rule: number-only tokens (verse numbers) are not
 * words, and case, accents and punctuation do not matter.
 */
import { tokenise } from '@lectio/textguard';
import type { Token } from '@lectio/textguard';

/** One prose field of a passage note and where it lives. */
export interface NoteField {
  /** RFC 6901 pointer into the passage file. */
  readonly pointer: string;
  /** The field's text with claim markers (`[c1]`) blanked out, so offsets still match the file. */
  readonly text: string;
  /** The claim the field belongs to (`claims[].text`). */
  readonly claimId?: string;
}

/** One source excerpt and where it lives. */
export interface ExcerptField {
  readonly pointer: string;
  readonly sourceId: string;
  readonly text: string;
}

/** A web source the note cites, with the URL to fetch. */
export interface WebSourceRef {
  readonly pointer: string;
  readonly sourceId: string;
  readonly url: string;
  readonly archivedUrl?: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const MARKER = /\[c[0-9]+\]/gu;

/** Blanks out claim markers: they are not words, and `c1` must not count towards a quotation or run. */
export function maskMarkers(text: string): string {
  return text.replace(MARKER, (marker) => ' '.repeat(marker.length));
}

/**
 * Every prose field Lectio writes in a passage or a translation: the summary, context title and
 * paragraphs, translation-note summaries, bodies and glosses (`original.gloss` in a passage,
 * `gloss` in a translation), and claim texts. Reads defensively: a field of
 * the wrong type is skipped (the schema gate reports it).
 */
export function noteFields(passage: unknown): NoteField[] {
  if (!isObject(passage)) return [];
  const fields: NoteField[] = [];
  const add = (pointer: string, value: unknown, claimId?: string): void => {
    const raw = asString(value);
    if (raw === undefined) return;
    const text = maskMarkers(raw);
    if (text.trim() === '') return;
    fields.push(claimId === undefined ? { pointer, text } : { pointer, text, claimId });
  };
  add('/summary', passage['summary']);
  const context = passage['context'];
  if (isObject(context)) {
    add('/context/title', context['title']);
    asArray(context['paragraphs']).forEach((paragraph, i) => {
      add(`/context/paragraphs/${String(i)}`, paragraph);
    });
  }
  asArray(passage['translationNotes']).forEach((note, i) => {
    if (!isObject(note)) return;
    const base = `/translationNotes/${String(i)}`;
    add(`${base}/summary`, note['summary']);
    add(`${base}/body`, note['body']);
    // A translation's note carries its gloss directly.
    add(`${base}/gloss`, note['gloss']);
    const original = note['original'];
    if (isObject(original)) add(`${base}/original/gloss`, original['gloss']);
  });
  asArray(passage['claims']).forEach((claim, i) => {
    if (!isObject(claim)) return;
    add(`/claims/${String(i)}/text`, claim['text'], asString(claim['id']));
  });
  return fields;
}

/** Every `sources[].excerpt`. */
export function excerptFields(passage: unknown): ExcerptField[] {
  if (!isObject(passage)) return [];
  const excerpts: ExcerptField[] = [];
  asArray(passage['sources']).forEach((source, i) => {
    if (!isObject(source)) return;
    const text = asString(source['excerpt']);
    if (text === undefined) return;
    excerpts.push({
      pointer: `/sources/${String(i)}/excerpt`,
      sourceId: asString(source['id']) ?? `#${String(i)}`,
      text,
    });
  });
  return excerpts;
}

/** Every `sources[]` entry of type `web` that has a URL. */
export function webSources(passage: unknown): WebSourceRef[] {
  if (!isObject(passage)) return [];
  const sources: WebSourceRef[] = [];
  asArray(passage['sources']).forEach((source, i) => {
    if (!isObject(source) || source['type'] !== 'web') return;
    const url = asString(source['url']);
    if (url === undefined || url.trim() === '') return;
    const archivedUrl = asString(source['archivedUrl']);
    sources.push({
      pointer: `/sources/${String(i)}`,
      sourceId: asString(source['id']) ?? `#${String(i)}`,
      url,
      ...(archivedUrl === undefined ? {} : { archivedUrl }),
    });
  });
  return sources;
}

/** Number of words in `text` (number-only tokens do not count). */
export function wordCount(text: string): number {
  return tokenise(text).length;
}

const LATIN = /\p{Script=Latin}/u;

/** Number of English (Latin-script) words: quoted Greek or Hebrew is original language, not a translation. */
export function englishWordCount(text: string): number {
  return tokenise(text).filter(({ word }) => LATIN.test(word)).length;
}

/** A quoted span: offsets of the text between the quote marks (`end` exclusive). */
export interface QuotedSpan {
  readonly start: number;
  readonly end: number;
  /** True when the closing mark is missing and the span runs to the end of the field. */
  readonly unterminated: boolean;
}

const OPEN_BEFORE = /[\s([{“”"„«‘—–-]/u;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const SPACE = /\s/u;

interface QuoteFamily {
  /** Marks that may open a quotation, at the start of a word. */
  readonly openers: string;
  /** Marks that may close one, at the end of a word. */
  readonly closers: string;
  /** Whether an unclosed opener runs to the end of the field (`true`) or is ignored. */
  readonly unclosedRunsToEnd: boolean;
}

/**
 * Double quotes are one family, so mismatched and regional pairs still pair up: `“…”`, `“…"`,
 * `"…"`, German `„…“` and Swedish `”…”`. Single quotes are another (`‘…’`, `'…'`); an unclosed
 * single mark is ignored because it is more likely an apostrophe than a quotation.
 */
const FAMILIES: readonly QuoteFamily[] = [
  { openers: '“”"„', closers: '“”"', unclosedRunsToEnd: true },
  { openers: "‘'", closers: "’'", unclosedRunsToEnd: false },
];

/**
 * Spans of one family. A mark opens only at the start of a word (after a space or opening
 * punctuation, before a non-space) and closes only at the end of one (after a non-space, before
 * a non-letter; a combining mark counts as part of the letter), so the apostrophes in `owner’s` and `’tis` are not quotes.
 */
function familySpans(text: string, family: QuoteFamily): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  let from = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const before = i === 0 ? ' ' : text.charAt(i - 1);
    const after = i + 1 < text.length ? text.charAt(i + 1) : ' ';
    if (from >= 0 && family.closers.includes(ch) && !SPACE.test(before) && !WORD_CHAR.test(after)) {
      spans.push({ start: from, end: i, unterminated: false });
      from = -1;
    } else if (from < 0 && family.openers.includes(ch) && OPEN_BEFORE.test(before) && !SPACE.test(after)) {
      from = i + 1;
    }
  }
  if (from >= 0 && family.unclosedRunsToEnd) spans.push({ start: from, end: text.length, unterminated: true });
  return spans;
}

/** Spans between guillemets `«…»` (French style puts spaces inside). An unclosed mark runs to the end. */
function guillemetSpans(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  let from = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (from < 0 && ch === '«') from = i + 1;
    else if (from >= 0 && ch === '»') {
      spans.push({ start: from, end: i, unterminated: false });
      from = -1;
    }
  }
  if (from >= 0) spans.push({ start: from, end: text.length, unterminated: true });
  return spans;
}

/** Every quoted span in `text`, ordered by start offset. Nested quotes are reported on their own too. */
export function quotedSpans(text: string): QuotedSpan[] {
  const spans = [...FAMILIES.flatMap((family) => familySpans(text, family)), ...guillemetSpans(text)];
  return spans.sort((a, b) => a.start - b.start);
}

/** Up to `max` words of `text` from `start` to `end`, with an ellipsis when cut: for messages. */
export function preview(text: string, start = 0, end = text.length, max = 8): string {
  const tokens: Token[] = tokenise(text.slice(start, end));
  if (tokens.length === 0) return text.slice(start, end).trim();
  const last = tokens[Math.min(tokens.length, max) - 1] as Token;
  const shown = text.slice(start + (tokens[0] as Token).start, start + last.end).replace(/\s+/gu, ' ');
  return tokens.length > max ? `${shown}…` : shown;
}
