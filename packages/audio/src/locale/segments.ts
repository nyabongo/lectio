/**
 * Narration segments in another language (L-115): the Listen queue built from approved, fresh
 * translations (`passages/i18n/<locale>/<key>.json`, L-112). Segment ids match the English ones
 * (`<passage key>/context`, `<passage key>/note/<note id>`) so a player can switch language per
 * segment; the locale goes into each segment, and so into its audio key (`audio/<locale>/<hash>`),
 * so the two languages never share a file.
 *
 * A translation carries the prose only: the reference, the note's verse, original-language words
 * and their transliteration come from the English passage, which must exist and be approved too.
 */
import type { ReadingSlot } from '@lectio/schema/common';
import type { Passage } from '@lectio/schema/passage';
import { translatableSha256, translationMismatches } from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { passageRef, spokenVerse } from '../script/segments.ts';
import type { NarrationDay, NarrationSegment, NarrationStrings, PassageLookup } from '../script/segments.ts';
import { asSentence, speakable, stripClaimMarkers, stripUrls } from '../script/text.ts';
import type { Transliteration } from '../script/text.ts';
import { SWAHILI_STRINGS, speakSwahiliReferences } from './swahili.ts';

/** How one narration language speaks: its connecting words and its own book names in prose. */
export interface LocaleNarration {
  readonly strings: NarrationStrings;
  /** Rewrites references written with this language's book names; runs before the English matcher. */
  readonly speakReferences: (text: string) => string;
}

/** Built-in narration languages besides English, by language subtag. */
export const LOCALE_NARRATION: Readonly<Record<string, LocaleNarration>> = {
  sw: { strings: SWAHILI_STRINGS, speakReferences: speakSwahiliReferences },
};

/** The narration for `locale` (`sw-KE` falls back to `sw`); throws when there is none. */
export function localeNarration(locale: string): LocaleNarration {
  const narration = LOCALE_NARRATION[locale] ?? LOCALE_NARRATION[String(locale.split('-')[0])];
  if (narration === undefined) throw new RangeError(`No narration for locale ${JSON.stringify(locale)}`);
  return narration;
}

/** Why a translation is not narrated. */
export const SKIP_REASONS = ['missing-source', 'source-unapproved', 'unapproved', 'stale', 'mismatch'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface NarratableOptions {
  /** Narrate translations (and English passages) still pending review. Stale ones never are. */
  readonly includeUnapproved?: boolean;
}

/**
 * `null` when `translation` may be narrated: the English passage exists and is approved, the
 * translation is approved, its `sourceSha256` matches the English passage now (fresh), and its
 * notes and claims line up with the English ones. Otherwise the first reason it may not.
 */
export function skipReason(
  english: Passage | null | undefined,
  translation: TranslatedPassage,
  options: NarratableOptions = {},
): SkipReason | null {
  if (!english) return 'missing-source';
  const reviewed = options.includeUnapproved !== true;
  if (reviewed && english.review.status !== 'approved') return 'source-unapproved';
  if (reviewed && translation.review.status !== 'approved') return 'unapproved';
  if (translation.sourceSha256 !== translatableSha256(english)) return 'stale';
  if (translationMismatches(english, translation).length > 0) return 'mismatch';
  return null;
}

/** Translations of one locale, as a list or keyed by the English passage key. */
export type TranslationLookup =
  readonly TranslatedPassage[] | ReadonlyMap<string, TranslatedPassage | null | undefined>;

export interface BuildLocaleSegmentsOptions extends NarratableOptions {
  /** Only this Mass (e.g. `vigil`); by default every Mass of the day, in order. */
  readonly massId?: string;
  /** How to speak; defaults to {@link localeNarration} for the locale. */
  readonly narration?: LocaleNarration;
}

function byKey<T>(items: readonly T[] | ReadonlyMap<string, T | null | undefined>, key: (item: T) => string) {
  return Array.isArray(items)
    ? new Map((items as readonly T[]).map((item) => [key(item), item]))
    : (items as ReadonlyMap<string, T | null | undefined>);
}

/** One passage in `locale`: its context segment, then one segment per note, in the English order. */
export function translationSegments(
  english: Passage,
  translation: TranslatedPassage,
  slot: ReadingSlot,
  locale: string,
  narration: LocaleNarration,
): NarrationSegment[] {
  const { strings } = narration;
  const entries: Transliteration[] = english.translationNotes.map(({ original }) => ({
    original: original.text,
    translit: original.translit,
  }));
  const say = (text: string): string =>
    speakable(narration.speakReferences(stripUrls(stripClaimMarkers(text))), entries, strings.spokenRef);
  const ref = passageRef(english);
  const title = say(translation.context.title);
  const context: NarrationSegment = {
    id: `${english.key}/context`,
    kind: 'context',
    slot,
    title,
    text: [
      strings.contextIntro(strings.spokenRef(ref), title),
      ...translation.context.paragraphs.map((p) => asSentence(say(p))),
    ].join(' '),
    locale,
    passageKey: english.key,
  };
  const notes = new Map(translation.translationNotes.map((note) => [note.id, note]));
  const segments = [context];
  for (const note of english.translationNotes) {
    // `skipReason` checked that every English note is translated exactly once.
    const translated = notes.get(note.id) as TranslatedPassage['translationNotes'][number];
    const anchor = say(translated.anchor ?? '');
    const translit = say(note.original.translit);
    const intro = strings.noteIntro({
      verse: spokenVerse(ref.book, note.verse, strings),
      anchor,
      language: strings.languages[note.original.lang],
      translit,
      gloss: say(translated.gloss),
    });
    segments.push({
      id: `${english.key}/note/${note.id}`,
      kind: 'translation-note',
      slot,
      title: strings.noteTitle(anchor, translit),
      text: [intro, asSentence(say(translated.summary)), asSentence(say(translated.body))]
        .filter((part) => part !== '')
        .join(' '),
      locale,
      passageKey: english.key,
    });
  }
  return segments;
}

/**
 * The day's narration script in `locale`, like `buildSegments` for English: for each reading in
 * Mass order, the context segment and one segment per note of its translation. A reading is
 * skipped when it has no translation in `locale` or the translation may not be narrated
 * ({@link skipReason}); a passage read twice in one day is narrated once, under its first slot.
 */
export function buildLocaleSegments(
  day: NarrationDay,
  passages: PassageLookup,
  translations: TranslationLookup,
  locale: string,
  options: BuildLocaleSegmentsOptions = {},
): NarrationSegment[] {
  const narration = options.narration ?? localeNarration(locale);
  const english = byKey(passages, (passage: Passage) => passage.key);
  const translated = byKey(translations, (translation: TranslatedPassage) => translation.translationOf);
  const seen = new Set<string>();
  const segments: NarrationSegment[] = [];
  for (const mass of day.masses) {
    if (options.massId !== undefined && mass.id !== options.massId) continue;
    for (const { slot, key } of mass.readings) {
      const translation = translated.get(key);
      if (!translation || seen.has(key) || translation.locale !== locale) continue;
      const source = english.get(key);
      if (skipReason(source, translation, options) !== null) continue;
      seen.add(key);
      segments.push(...translationSegments(source as Passage, translation, slot, locale, narration));
    }
  }
  return segments;
}
