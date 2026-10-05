/**
 * Turns Lectio's written notes into text a TTS voice can read: claim markers and URLs removed,
 * original-language words replaced by the note's transliteration, scripture references in spoken
 * form (`Mt 6:22-23` → `Matthew chapter 6, verses 22 to 23`).
 *
 * These functions only ever see Lectio's own commentary (context paragraphs, note summaries and
 * bodies); reading text is never stored or narrated (ADR 0003).
 */
import { findBook, formatRef, tryParseRef } from '@lectio/refs';
import type { Ref } from '@lectio/refs';

/** Says a parsed reference in the narration language. */
export type SpokenRef = (ref: Ref) => string;

/**
 * English spoken references (L-005's `spoken` style): `Matthew chapter 20, verses 1 to 16`.
 * Sub-verse letters (`16a`) are dropped: the `Ref` still carries them in `part`, so another
 * language's {@link SpokenRef} may say them, but in English "verse 16a" is noise to a listener.
 */
export const englishSpokenRef: SpokenRef = (ref) => formatRef(ref, { style: 'spoken' });

/** A claim marker such as `[c3]`, with the space before it. */
const CLAIM_MARKER = /\s*\[c[1-9][0-9]*\]/g;

/**
 * An http(s) or `www.` URL, including balanced `(...)` groups (`.../Evil_eye_(folklore)`), not
 * counting trailing sentence punctuation or a closing bracket that belongs to the prose.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)(?:[^\s<>"()]|\([^\s<>"()]*\))*(?:[^\s<>"().,;:!?\]'’”]|\([^\s<>"()]*\))/gi;

/** A run of Greek or Hebrew script (letters, combining marks, internal spaces and Hebrew punctuation). */
const ORIGINAL_SCRIPT_RUN =
  /[\p{Script=Greek}\p{Script=Hebrew}](?:[\p{Script=Greek}\p{Script=Hebrew}\p{M}\s]*[\p{Script=Greek}\p{Script=Hebrew}\p{M}])?/gu;

/** Chapter and verse (`22:1`, `16a`, `1-16`, `9-12:8`), or a bare verse when `verse` is optional. */
const refPart = (sep: '' | '?') =>
  String.raw`\d{1,3}(?:[:.]\d{1,3})${sep}[a-g]?(?:[-–—]\d{1,3}(?:[:.]\d{1,3})?[a-g]?)?(?![\d:])`;
const REF_PART = refPart('?');
/** After `;` a part starts a new chapter, so prose only counts it with chapter and verse (`; 16:1`). */
const CHAPTER_VERSE_PART = refPart('');

/**
 * A reference in running prose: a capitalised book name (optionally numbered, `1 Cor`, or with
 * `of`, `Song of Songs`), then chapter and verses, with further parts after `,` or `;`.
 */
const PROSE_REF = new RegExp(
  String.raw`\b((?:[1-3] ?)?[A-Z][A-Za-z]*\.?(?: of [A-Z][a-z]+)?) (${REF_PART}(?:, ?${REF_PART}|; ?${CHAPTER_VERSE_PART})*)`,
  'g',
);

/** Removes every `[cN]` claim marker. */
export function stripClaimMarkers(text: string): string {
  return text.replace(CLAIM_MARKER, '');
}

/** Removes URLs (a voice reading a URL aloud helps no one). */
export function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, '');
}

/** An original-language phrase and how to say it. */
export interface Transliteration {
  readonly original: string;
  readonly translit: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every phrase that may be replaced, longest first: each whole original, then each of its words
 * when the original and the transliteration have the same number of words.
 */
function replacementTable(entries: readonly Transliteration[]): [string, string][] {
  const table = new Map<string, string>();
  for (const entry of entries) {
    const original = entry.original.normalize('NFC').trim();
    const translit = entry.translit.normalize('NFC').trim();
    if (original === '' || translit === '') continue;
    if (!table.has(original)) table.set(original, translit);
    const words = original.split(/\s+/);
    const spoken = translit.split(/\s+/);
    if (words.length > 1 && words.length === spoken.length) {
      words.forEach((word, i) => {
        if (!table.has(word)) table.set(word, String(spoken[i]));
      });
    }
  }
  return [...table].sort(([a], [b]) => b.length - a.length);
}

/**
 * Speaks Greek, Hebrew and Aramaic through the notes' transliterations: each original phrase
 * (or one of its words) becomes its transliteration. Only whole words match, so `ἐν` never hits
 * the start of `ἐντολή`. Any Greek or Hebrew script left over has no
 * reliable pronunciation and is dropped rather than mangled by the voice.
 */
export function speakOriginals(text: string, entries: readonly Transliteration[]): string {
  let result = text.normalize('NFC');
  for (const [original, translit] of replacementTable(entries)) {
    const wholeWord = new RegExp(`(?<![\\p{L}\\p{M}])${escapeRegExp(original)}(?![\\p{L}\\p{M}])`, 'gu');
    result = result.replace(wholeWord, translit);
  }
  return result.replace(ORIGINAL_SCRIPT_RUN, '');
}

/**
 * Rewrites scripture references in prose to their spoken form through `spokenRef` (English by default):
 * `(Deut 15:9; Prov 28:22)` → `(Deuteronomy chapter 15, verse 9; Proverbs chapter 28, verse 22)`.
 * Only a known book name followed by chapter and verse (or a chapter of a one-chapter book or a
 * psalm) counts; anything that does not parse is left as written.
 */
export function speakReferences(text: string, spokenRef: SpokenRef = englishSpokenRef): string {
  return text.replace(PROSE_REF, (match: string, name: string, passage: string) => {
    const book = findBook(name);
    if (book === undefined) {
      // `Gospel of Matthew 5:3`: the book name may start after the `of`.
      const of = name.indexOf(' of ');
      return of < 0 ? match : match.slice(0, of + 4) + speakReferences(match.slice(of + 4), spokenRef);
    }
    if (!passage.includes(':') && !passage.includes('.') && !book.singleChapter && book.code !== 'PS') return match;
    // A trailing `,` or `;` part that fails to parse (prose such as `Mt 6:22; 30 people`) is
    // dropped one part at a time until the reference parses.
    let parts = passage;
    for (;;) {
      const parsed = tryParseRef(`${name} ${parts}`);
      if (parsed.ok) return `${spokenRef(parsed.value)}${passage.slice(parts.length)}`;
      const cut = Math.max(parts.lastIndexOf(','), parts.lastIndexOf(';'));
      if (cut < 0) return match;
      parts = parts.slice(0, cut);
    }
  });
}

/** Collapses whitespace and repairs the gaps that removals leave behind (`( )`, ` .`, `( x`). */
export function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\(\s*[,;:]?\s*\)/g, '')
    .replace(/[“"]\s*[”"]/g, '')
    .replace(/\(\s+/g, '(')
    .replace(/\s*[,;:]\s*\)/g, ')')
    .replace(/\s+([.,;:!?)])/g, '$1')
    .replace(/([,;:])(?=[.,;:!?])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ends `text` with a full stop unless it already ends in sentence punctuation. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return /[.!?…]["'’”)]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Everything needed to make one piece of Lectio prose speakable. */
export function speakable(
  text: string,
  entries: readonly Transliteration[],
  spokenRef: SpokenRef = englishSpokenRef,
): string {
  return tidy(speakReferences(speakOriginals(stripUrls(stripClaimMarkers(text)), entries), spokenRef));
}
