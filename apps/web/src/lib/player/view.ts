/**
 * What the Listen page shows for a player state (L-085), as plain strings: the play button's label, the time and the
 * slider's spoken value, the source line and the live-region announcement. Also `withApiAudio`, which takes the
 * audio files of the queue's segments from the day API document (`masses[].segments[].audio`, L-082).
 *
 * Browser-safe and DOM-free; messages are built at build time by `listenPageView` with `{title}`, `{position}` and
 * `{duration}` left in for `fill`.
 */
import type { PlayerState, Track, TrackAudio } from './queue.ts';

/** The player's strings, with placeholders still in. */
export interface PlayerMessages {
  readonly play: string;
  readonly pause: string;
  /** `{position} of {duration}`. */
  readonly position: string;
  /** `Now playing: {title}`. */
  readonly playing: string;
  /** `Paused: {title}`. */
  readonly paused: string;
  readonly finished: string;
  readonly unavailable: string;
  readonly audio: string;
  readonly speech: string;
  readonly fallback: string;
}

/** `template` with each `{name}` replaced by `params[name]` (unknown names are left as they are). */
export function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => params[name] ?? placeholder);
}

/** `seconds` as `m:ss` (or `h:mm:ss`); unknown or negative times are `0:00`. */
export function formatTime(seconds: number | null): string {
  const total = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export interface PlayerView {
  /** The play/pause button's label (its accessible name). */
  readonly toggle: string;
  readonly playing: boolean;
  readonly elapsed: string;
  readonly total: string;
  /** The slider's `aria-valuetext`: `0:42 of 2:10`. */
  readonly valueText: string;
  /** The slider's range, in whole seconds (at least 1, so it stays operable before the length is known). */
  readonly max: number;
  readonly value: number;
  /** Which voice reads the current track. */
  readonly source: string;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
}

export function playerView(state: PlayerState, count: number, messages: PlayerMessages): PlayerView {
  const playing = state.status === 'playing';
  const duration = state.duration ?? 0;
  const elapsed = formatTime(state.position);
  const total = formatTime(state.duration);
  const source =
    state.source === null
      ? ''
      : state.fallback
        ? messages.fallback
        : messages[state.source === 'audio' ? 'audio' : 'speech'];
  return {
    toggle: playing ? messages.pause : messages.play,
    playing,
    elapsed,
    total,
    valueText: fill(messages.position, { position: elapsed, duration: total }),
    max: Math.max(1, Math.ceil(duration)),
    value: Math.min(Math.floor(state.position), Math.max(1, Math.ceil(duration))),
    source,
    canPrevious: count > 0 && state.status !== 'unavailable',
    canNext: state.index < count - 1 && state.status !== 'unavailable',
  };
}

/**
 * The live-region message for a change, or `null` when there is nothing to say. Track changes are announced while
 * playing ("Now playing: …"); pausing, finishing the queue and an unplayable queue are announced as they happen.
 */
export function announcement(
  state: PlayerState,
  reason: 'track' | 'status' | 'time' | 'speed',
  messages: PlayerMessages,
): string | null {
  const title = state.track?.title ?? '';
  if (reason === 'track') return state.status === 'playing' ? fill(messages.playing, { title }) : null;
  if (reason !== 'status') return null;
  switch (state.status) {
    case 'playing':
      return fill(messages.playing, { title });
    case 'paused':
      return fill(messages.paused, { title });
    case 'finished':
      return messages.finished;
    case 'unavailable':
      return messages.unavailable;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A segment's `audio` from the API when it is a usable file: an http(s) or site-relative URL. */
function apiAudio(value: unknown): TrackAudio | null {
  if (!isRecord(value) || typeof value.url !== 'string' || !/^(https?:\/\/|\/)\S+$/.test(value.url)) return null;
  const duration = value.durationSeconds;
  return {
    url: value.url,
    durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

/**
 * `tracks` with the audio files the day API document lists for them: a segment of `masses[].segments` with the same
 * id and locale and a usable `audio`. Anything else (no document, an older document without segments, `audio: null`)
 * leaves the track as it is, to be read by device speech.
 */
export function withApiAudio<T extends Track>(tracks: readonly T[], document: unknown): T[] {
  const files = new Map<string, TrackAudio>();
  const masses = isRecord(document) && Array.isArray(document.masses) ? (document.masses as unknown[]) : [];
  for (const mass of masses) {
    const segments = isRecord(mass) && Array.isArray(mass.segments) ? (mass.segments as unknown[]) : [];
    for (const segment of segments) {
      if (!isRecord(segment) || typeof segment.id !== 'string' || typeof segment.locale !== 'string') continue;
      const audio = apiAudio(segment.audio);
      const key = `${segment.locale} ${segment.id}`;
      if (audio !== null && !files.has(key)) files.set(key, audio);
    }
  }
  return tracks.map((track) => {
    const audio = files.get(`${track.locale} ${track.id}`);
    return audio === undefined ? track : { ...track, audio };
  });
}
