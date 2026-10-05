/**
 * The web player's language (L-113): which narration segments a Listen queue plays on a page in another locale, and
 * which device voice reads a segment that has no audio file.
 *
 * Narration segments have the same id in every language (`<passage key>/context`, `<passage key>/note/<note id>`,
 * L-115), and a locale's segments exist only for approved, up-to-date translations. So on a `/sw/` page the queue
 * keeps the English order and takes, for each segment, the Kiswahili one when there is one and the English one
 * otherwise (`localeQueue`). Device text-to-speech (the player's fallback when an audio file is missing, L-085) then
 * reads each segment in its own language: a Kiswahili segment with a Kiswahili voice, an English fallback with an
 * English one (`pickVoice`, `speechSettings`).
 *
 * Pure and browser-safe: the queue state machine and the `speechSynthesis` adapter (L-085, `lib/player/queue.ts`)
 * call these with the page locale and `speechSynthesis.getVoices()`.
 */
import { intlLocale } from '../i18n.ts';

/** The parts of a narration segment the queue needs (`NarrationSegment` in @lectio/audio has them). */
export interface LocaleSegment {
  /** The same in every language: `MT.20.1-16/context`, `MT.20.1-16/note/v15-evil-eye`. */
  readonly id: string;
  /** The language the segment's text (and audio) is in. */
  readonly locale: string;
}

/** One queue entry: the segment to play and whether it stands in for a missing translation. */
export interface QueueEntry<S extends LocaleSegment> {
  readonly segment: S;
  /** `true` when the page is in another language and this segment is the English one in its place. */
  readonly fallback: boolean;
}

/**
 * The queue a page in `locale` plays: the default locale's segments, in their order, each replaced by the segment
 * with the same id in `localised` when there is one. On a default-locale page `localised` is ignored. Segments of
 * `localised` in another language than `locale`, or with no English counterpart, are never queued.
 */
export function localeQueue<S extends LocaleSegment>(
  english: readonly S[],
  localised: readonly S[],
  locale: string,
  defaultLocale = 'en',
): QueueEntry<S>[] {
  if (locale === defaultLocale) return english.map((segment) => ({ segment, fallback: false }));
  const byId = new Map(
    localised.filter((segment) => segment.locale === locale).map((segment) => [segment.id, segment]),
  );
  return english.map((segment) => {
    const translated = byId.get(segment.id);
    return translated === undefined ? { segment, fallback: true } : { segment: translated, fallback: false };
  });
}

/** The parts of a `SpeechSynthesisVoice` the choice reads. */
export interface VoiceLike {
  readonly name: string;
  /** BCP 47 tag; some engines write `sw_KE`. */
  readonly lang: string;
  readonly localService?: boolean;
  readonly default?: boolean;
}

/** `sw_KE` → `sw-ke`: tags compared case-insensitively, with either separator. */
function normaliseTag(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}

/** The language subtag of a tag: `sw-KE` → `sw`. */
function primary(tag: string): string {
  return normaliseTag(tag).split('-')[0] as string;
}

/**
 * The device voice for text in `locale`, or `null` when the device has none for the language (the player then
 * leaves the utterance's `lang` to pick one, or skips the segment). Preference: the regional voice the site formats
 * that locale with (`sw-KE`, `en-GB`: `intlLocale`), then the bare language (`sw`), then any region of it (`sw-TZ`);
 * within each, an on-device voice before a network one, then the engine's default, then the list order.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], locale: string): V | null {
  const regional = normaliseTag(intlLocale(locale));
  const language = primary(locale);
  const rank = (voice: V): number => {
    const tag = normaliseTag(voice.lang);
    if (tag === regional) return 0;
    if (tag === language) return 1;
    return primary(tag) === language ? 2 : -1;
  };
  const candidates = voices
    .map((voice, index) => ({ voice, index, rank: rank(voice) }))
    .filter((candidate) => candidate.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.voice.localService === true) - Number(a.voice.localService === true) ||
        Number(b.voice.default === true) - Number(a.voice.default === true) ||
        a.index - b.index,
    );
  return candidates[0]?.voice ?? null;
}

/** What a `SpeechSynthesisUtterance` for one segment is set to: its `lang` and, when the device has one, its voice. */
export interface SpeechSettings<V extends VoiceLike> {
  /** The regional tag of the segment's language (`sw-KE` for Kiswahili): the engine's hint when `voice` is `null`. */
  readonly lang: string;
  readonly voice: V | null;
}

/** The device-speech settings for `segment`: its own language's voice (an English fallback is read in English). */
export function speechSettings<V extends VoiceLike>(segment: LocaleSegment, voices: readonly V[]): SpeechSettings<V> {
  return { lang: intlLocale(segment.locale), voice: pickVoice(voices, segment.locale) };
}
