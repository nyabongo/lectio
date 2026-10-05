/**
 * The narration script for one day: the Listen queue's segments, in order. Each passage gives a
 * context segment, then one segment per translation note. Segments carry only Lectio's own
 * commentary; the reading text is never narrated (ADR 0003).
 */
import type { ResolvedDay } from '@lectio/content';
import { formatRef, fromKey, tryParseRef } from '@lectio/refs';
import type { Ref } from '@lectio/refs';
import type { ReadingSlot } from '@lectio/schema/common';
import type { ORIGINAL_LANGUAGES, Passage, TranslationNote } from '@lectio/schema/passage';

import { asSentence, speakable } from './text.ts';
import type { Transliteration } from './text.ts';

export const SEGMENT_KINDS = ['context', 'translation-note'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/** One item of the Listen queue. */
export interface NarrationSegment {
  /** Stable across years and days: `<passage key>/context` or `<passage key>/note/<note id>`. */
  readonly id: string;
  readonly kind: SegmentKind;
  /** The reading slot the passage sits in on this day (the first one, if it appears twice). */
  readonly slot: ReadingSlot;
  /** Short label for the queue (the context title, or the note's anchor and transliteration). */
  readonly title: string;
  /** What the voice reads: plain prose, no markers, URLs or non-Latin script. */
  readonly text: string;
  /** Locale of the text (and of the voice that should read it). */
  readonly locale: string;
  readonly passageKey: string;
}

export type OriginalLanguage = (typeof ORIGINAL_LANGUAGES)[number];

/** Connecting words for one narration language. */
export interface NarrationStrings {
  /** Spoken names of the original languages. */
  readonly languages: Readonly<Record<OriginalLanguage, string>>;
  /** Opens a context segment; `ref` is already in spoken form. */
  contextIntro(ref: string, title: string): string;
  /** Opens a translation-note segment; `verse` is already in spoken form. */
  noteIntro(parts: {
    readonly verse: string;
    readonly anchor: string;
    readonly language: string;
    readonly translit: string;
    readonly gloss: string;
  }): string;
  /** The queue label for a translation note. */
  noteTitle(anchor: string, translit: string): string;
}

const ENGLISH: NarrationStrings = {
  languages: { grc: 'Greek', hbo: 'Hebrew', arc: 'Aramaic', lat: 'Latin' },
  contextIntro: (ref, title) => `Context for ${ref}. ${asSentence(title)}`,
  noteIntro: ({ verse, anchor, language, translit, gloss }) =>
    `Translation note on ${verse}, the ${anchor.includes(' ') ? 'words' : 'word'} “${anchor}”. ` +
    `The ${language} is ${translit}, literally “${gloss}”.`,
  noteTitle: (anchor, translit) => `${anchor} · ${translit}`,
};

/** Built-in narration strings by language subtag. Spoken references (L-005) are English-only so far. */
export const NARRATION_STRINGS: Readonly<Record<string, NarrationStrings>> = { en: ENGLISH };

/** The strings for `locale` (`en-KE` falls back to `en`); throws when there are none. */
export function narrationStrings(locale: string): NarrationStrings {
  const strings = NARRATION_STRINGS[locale] ?? NARRATION_STRINGS[String(locale.split('-')[0])];
  if (strings === undefined) throw new RangeError(`No narration strings for locale ${JSON.stringify(locale)}`);
  return strings;
}

/** A day's Masses and readings: a calendar day (`@lectio/schema/calendar`) or a `ResolvedDay` both fit. */
export interface NarrationDay {
  readonly masses: readonly {
    readonly id: string;
    readonly readings: readonly { readonly slot: ReadingSlot; readonly key: string }[];
  }[];
}

/** The passages to narrate, as a list or keyed by passage key. */
export type PassageLookup = readonly Passage[] | ReadonlyMap<string, Passage | null | undefined>;

export interface BuildSegmentsOptions {
  /** Only this Mass (e.g. `vigil`); by default every Mass of the day, in order. */
  readonly massId?: string;
  /** Narrate passages still pending review; off by default, since Listen plays approved notes only. */
  readonly includeUnapproved?: boolean;
  /** Connecting words; defaults to {@link narrationStrings} for the locale. */
  readonly strings?: NarrationStrings;
}

/** The passages of a resolved day (from `@lectio/content`), ready for {@link buildSegments}. */
export function passagesOf(day: ResolvedDay): Passage[] {
  return day.masses.flatMap((mass) => mass.readings.flatMap((reading) => (reading.passage ? [reading.passage] : [])));
}

function toMap(passages: PassageLookup): ReadonlyMap<string, Passage | null | undefined> {
  return Array.isArray(passages)
    ? new Map((passages as readonly Passage[]).map((passage) => [passage.key, passage]))
    : (passages as ReadonlyMap<string, Passage | null | undefined>);
}

/** The passage's reference as printed (`Mt 20:1-16a`), or its key when that does not parse. */
function passageRef(passage: Passage): Ref {
  const parsed = tryParseRef(passage.ref);
  return parsed.ok ? parsed.value : fromKey(passage.key);
}

/** `20:15` in `book` → `Matthew chapter 20, verse 15`. */
function spokenVerse(book: Ref['book'], verse: string): string {
  const [c, v] = verse.split(':').map(Number);
  const point = { c: Number(c), v: Number(v) };
  return formatRef({ book, segments: [{ start: point, end: point }] }, { style: 'spoken' });
}

function transliterations(passage: Passage): Transliteration[] {
  return passage.translationNotes.map(({ original }) => ({ original: original.text, translit: original.translit }));
}

function contextSegment(
  passage: Passage,
  slot: ReadingSlot,
  locale: string,
  strings: NarrationStrings,
  ref: Ref,
): NarrationSegment {
  const say = (text: string): string => speakable(text, transliterations(passage));
  const title = say(passage.context.title);
  const paragraphs = passage.context.paragraphs.map((paragraph) => asSentence(say(paragraph)));
  return {
    id: `${passage.key}/context`,
    kind: 'context',
    slot,
    title,
    text: [strings.contextIntro(formatRef(ref, { style: 'spoken' }), title), ...paragraphs].join(' '),
    locale,
    passageKey: passage.key,
  };
}

function noteSegment(
  passage: Passage,
  note: TranslationNote,
  slot: ReadingSlot,
  locale: string,
  strings: NarrationStrings,
  ref: Ref,
): NarrationSegment {
  const say = (text: string): string => speakable(text, transliterations(passage));
  const anchor = say(note.anchor);
  const translit = say(note.original.translit);
  const intro = strings.noteIntro({
    verse: spokenVerse(ref.book, note.verse),
    anchor,
    language: strings.languages[note.original.lang],
    translit,
    gloss: say(note.original.gloss),
  });
  return {
    id: `${passage.key}/note/${note.id}`,
    kind: 'translation-note',
    slot,
    title: strings.noteTitle(anchor, translit),
    text: [intro, asSentence(say(note.summary)), asSentence(say(note.body))].filter((part) => part !== '').join(' '),
    locale,
    passageKey: passage.key,
  };
}

/**
 * The day's narration script: for each reading in Mass order, the passage's context segment and
 * then one segment per translation note. A passage is skipped when it is missing, written in
 * another locale or (unless `includeUnapproved`) not yet approved; a passage read twice in one day
 * is narrated once, under its first slot.
 */
export function buildSegments(
  day: NarrationDay,
  passages: PassageLookup,
  locale: string,
  options: BuildSegmentsOptions = {},
): NarrationSegment[] {
  const strings = options.strings ?? narrationStrings(locale);
  const byKey = toMap(passages);
  const seen = new Set<string>();
  const segments: NarrationSegment[] = [];
  for (const mass of day.masses) {
    if (options.massId !== undefined && mass.id !== options.massId) continue;
    for (const { slot, key } of mass.readings) {
      const passage = byKey.get(key);
      if (!passage || seen.has(key) || passage.locale !== locale) continue;
      if (passage.review.status !== 'approved' && options.includeUnapproved !== true) continue;
      seen.add(key);
      const ref = passageRef(passage);
      segments.push(contextSegment(passage, slot, locale, strings, ref));
      for (const note of passage.translationNotes)
        segments.push(noteSegment(passage, note, slot, locale, strings, ref));
    }
  }
  return segments;
}
