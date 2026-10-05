/**
 * The Listen page's view model (L-085), built at build time for `/[date]/listen/` and its `/<locale>/` mirrors.
 *
 * The queue is the day's narration script (`buildSegments` in @lectio/audio, the same segments the render pipeline
 * narrates and the day API lists under `masses[].segments`, L-082): for each reading with approved notes, in Mass
 * order, its context and then each translation note. On a page in another locale each segment is its translation
 * where one is approved and fresh, else the English one (`localeQueue`, L-113), and those English stand-ins are
 * marked `lang="en"` with an "English only" badge.
 *
 * Tracks are rendered into the page as the "Up next" list, grouped by reading, so the queue is readable without
 * JavaScript, and handed to the player as JSON (`ListenData`). Audio files are not known at build time here: the
 * player looks them up in the day API document at run time (`withApiAudio` in view.ts), so a segment without a file
 * is read by device speech. Reading text is never involved: segments carry Lectio's commentary only.
 */
import { buildLocaleSegments, buildSegments, passagesOf } from '@lectio/audio';
import type { NarrationDay, NarrationSegment } from '@lectio/audio';
import { approvedOnly } from '@lectio/content';
import type { ContentRepo, ResolvedDay } from '@lectio/content';
import type { Reading } from '@lectio/schema/calendar';
import type { IsoDate } from '@lectio/shared';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { dayPath, dayView } from '../day.ts';
import type { DayConfig, DayEnv, DayView } from '../day.ts';
import { localeRepo, translationSource } from '../notes-locale.ts';
import { PLAYBACK_SPEEDS } from '../settings.ts';
import type { TranslationSource } from '../notes-locale.ts';
import { localeQueue } from './locale.ts';
import type { MediaImageLike } from './media-session.ts';
import type { Track } from './queue.ts';
import type { PlayerMessages } from './view.ts';

/** One track as the page lists it and the player plays it. */
export interface ListenTrack extends Track {
  /** The reading line: `Gospel · Matthew 20:1–16a`. */
  readonly reading: string;
  /** True when this is the English segment standing in on a page in another language. */
  readonly fallback: boolean;
  /** The segment's language when it differs from the page's, for `lang`. */
  readonly lang?: string | undefined;
}

/** The tracks of one reading. */
export interface ListenGroup {
  readonly id: string;
  readonly heading: string;
  /** The index of the group's first track in the queue. */
  readonly start: number;
  readonly tracks: readonly ListenTrack[];
}

/** What the player script reads from the page (`<script type="application/json">`). */
export interface ListenData {
  readonly date: IsoDate;
  readonly lang: string;
  /** The day API document for the page's locale, where segments may carry audio files. */
  readonly api: string;
  readonly album: string;
  readonly artwork: readonly MediaImageLike[];
  readonly tracks: readonly ListenTrack[];
  readonly messages: PlayerMessages;
}

export interface ListenPageView {
  readonly day: DayView;
  readonly pageTitle: string;
  readonly description: string;
  readonly dayHref: string;
  readonly backToDay: string;
  readonly count: string;
  readonly groups: readonly ListenGroup[];
  readonly speeds: readonly { readonly value: number; readonly label: string }[];
  readonly data: ListenData;
}

export interface ListenContext {
  readonly config: DayConfig;
  /** The English content repository (`siteContext().repo`). */
  readonly repo: ContentRepo;
  /** Where translations come from; defaults to the repository's `passages/i18n/`. */
  readonly translations?: TranslationSource;
  /** The site base (`import.meta.env.BASE_URL`), for the API and artwork URLs. */
  readonly base: string;
}

/** Speeds offered on the page: the ones Settings offers (0.75× to 2×), so a change can be saved there. */
export const SPEEDS: readonly number[] = PLAYBACK_SPEEDS;

/** The day API document for `date` in `lang`, relative to the site base. */
export function dayApiPath(date: IsoDate, lang: string, defaultLocale: string): string {
  return lang === defaultLocale ? `api/v1/days/${date}.json` : `api/v1/${lang}/days/${date}.json`;
}

/**
 * The Masses and readings of `day` as the narration builders take them. Spelled out through `Reading` because
 * `astro check` sees the schema types as `any` and so loses the members `ResolvedReading` inherits from it.
 */
function narrationDay(day: ResolvedDay): NarrationDay {
  return {
    masses: day.masses.map((mass) => ({
      id: mass.id,
      readings: mass.readings.map((reading) => {
        const { slot, key }: Reading = reading;
        return { slot, key };
      }),
    })),
  };
}

/** The narration segments a page in `lang` plays for `day` (approved notes only), and which are English stand-ins. */
export function listenSegments(
  day: ResolvedDay,
  lang: string,
  defaultLocale: string,
  translations: TranslationSource,
): { readonly segment: NarrationSegment; readonly fallback: boolean }[] {
  const approved = approvedOnly(day);
  const passages = passagesOf(approved);
  const narration = narrationDay(approved);
  const english = buildSegments(narration, passages, defaultLocale);
  if (lang === defaultLocale) return localeQueue(english, [], lang, defaultLocale);
  const localised: TranslatedPassage[] = passages.flatMap((passage) => {
    const translation = translations(lang, passage.key);
    return translation === null ? [] : [translation];
  });
  let segments: NarrationSegment[] = [];
  try {
    segments = buildLocaleSegments(narration, passages, localised, lang);
  } catch {
    // No narration strings for this language: every segment stays English.
  }
  return localeQueue(english, segments, lang, defaultLocale);
}

/** The view model of the Listen page for `date` in `env.lang`, or `null` when no committed calendar has that date. */
export function listenPageView(env: DayEnv, context: ListenContext, date: IsoDate): ListenPageView | null {
  const { lang } = env;
  const { t } = env.messages;
  const english = context.repo.resolveDay(date);
  if (english === null) return null;
  const { defaultLocale } = context.config.site;
  const translations = context.translations ?? translationSource(context.repo.root);
  const shown = localeRepo(context.repo, lang, { defaultLocale, translations }).resolveDay(date) as ResolvedDay;
  const day = dayView(env, shown, { config: context.config });

  // The reading line of each slot, from its first appearance in the day (later Masses are walked first, so the first
  // one is written last and wins).
  const readings = new Map<string, string>();
  for (const mass of [...day.masses].reverse())
    for (const reading of [...mass.readings].reverse())
      readings.set(reading.slot, t(lang, 'listen.group', { slot: reading.slotLabel, ref: reading.refLabel }));

  const segments = listenSegments(english, lang, defaultLocale, translations);
  const tracks: ListenTrack[] = segments.map(({ segment, fallback }) => ({
    id: segment.id,
    title: segment.title,
    locale: segment.locale,
    script: segment.text,
    audio: null,
    // Every segment comes from one of the day's readings.
    reading: readings.get(segment.slot) as string,
    fallback,
    lang: segment.locale === lang ? undefined : segment.locale,
  }));

  // Segments come passage by passage, so a new passage key starts a new group.
  const groups: ListenGroup[] = [];
  segments.forEach(({ segment }, index) => {
    const track = tracks[index] as ListenTrack;
    const last = groups.at(-1);
    if (last?.id === segment.passageKey) (last.tracks as ListenTrack[]).push(track);
    else groups.push({ id: segment.passageKey, heading: track.reading, start: index, tracks: [track] });
  });

  const withBase = (path: string): string => `${context.base.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`;
  return {
    day,
    pageTitle: t(lang, 'listen.pageTitle', { date: day.dateLabel }),
    description: t(lang, 'listen.description', { date: day.dateLabel }),
    dayHref: env.paths(dayPath(date)),
    backToDay: t(lang, 'listen.backToDay', { date: day.dateLabel }),
    count: t(lang, 'listen.noteCount', { count: tracks.length }),
    groups,
    speeds: SPEEDS.map((value) => ({ value, label: t(lang, 'listen.controls.speedOption', { speed: String(value) }) })),
    data: {
      date,
      lang,
      api: withBase(dayApiPath(date, lang, defaultLocale)),
      album: day.pageTitle,
      artwork: [
        { src: withBase('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: withBase('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
      ],
      tracks,
      messages: {
        play: t(lang, 'listen.controls.play'),
        pause: t(lang, 'listen.controls.pause'),
        position: t(lang, 'listen.controls.position', { position: '{position}', duration: '{duration}' }),
        playing: t(lang, 'listen.status.playing', { title: '{title}' }),
        paused: t(lang, 'listen.status.paused', { title: '{title}' }),
        finished: t(lang, 'listen.status.finished'),
        unavailable: t(lang, 'listen.status.unavailable'),
        audio: t(lang, 'listen.source.audio'),
        speech: t(lang, 'listen.source.speech'),
        fallback: t(lang, 'listen.source.fallback'),
      },
    },
  };
}

/** Static paths for `pages/[date]/listen/index.astro`: every calendar day when `features.listen` is on, else none. */
export function listenPagePaths(
  dates: readonly IsoDate[],
  config: Pick<DayConfig, 'site'>,
): { readonly params: { readonly date: IsoDate } }[] {
  return config.site.features.listen ? dates.map((date) => ({ params: { date } })) : [];
}
