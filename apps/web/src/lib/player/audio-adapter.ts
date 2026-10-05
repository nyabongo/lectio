/**
 * The audio-file playback adapter (L-085): plays a segment's rendered narration (`audio.url` in the day API, L-082)
 * through one `HTMLAudioElement`.
 *
 * - `resolve` turns the file's URL into the `src` to play: the offline copy in the `lectio-data-audio` cache when
 *   there is one (`offline-audio.ts`), else the URL itself. It is asynchronous, so `play` waits for it.
 * - Speed is `playbackRate` with pitch preserved; the start position is applied once the metadata is known.
 * - The element's `play`/`pause` events are reported, so a pause from outside (a headset button, the OS) shows in
 *   the UI. A `play()` the browser refuses (`NotAllowedError`: no user gesture) reports a pause, not an error; a
 *   missing or undecodable file (`error` event, or any other rejection) reports an error and the queue falls back to
 *   device speech.
 */
import type { AdapterEvents, LoadOptions, PlaybackAdapter, Track } from './queue.ts';

type Listener = () => void;

/** The parts of an `HTMLAudioElement` the adapter uses. */
export interface AudioElementLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch?: boolean;
  readonly readyState: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

/** The `src` to play for a file URL. */
export type SourceResolver = (url: string) => Promise<string>;

const EVENTS = ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended', 'error'] as const;

/** `HTMLMediaElement.HAVE_METADATA`. */
const HAVE_METADATA = 1;

export function createAudioAdapter(
  element: AudioElementLike | null,
  resolve: SourceResolver = (url) => Promise.resolve(url),
): PlaybackAdapter | null {
  if (element === null) return null;
  const audio = element;
  let events: AdapterEvents | null = null;
  let fallbackDuration: number | null = null;
  /** Where to start once the metadata is in. */
  let pending: number | null = null;
  /** Resolves once `src` is set for the current track (or rejects when the track was replaced). */
  let ready: Promise<boolean> = Promise.resolve(false);
  let generation = 0;

  const duration = (): number | null =>
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDuration;
  const report = (): void => events?.time(audio.currentTime, duration());

  const handlers: Record<(typeof EVENTS)[number], Listener> = {
    loadedmetadata() {
      if (pending !== null) audio.currentTime = pending;
      pending = null;
      report();
    },
    timeupdate: report,
    play: () => events?.playing(),
    pause: () => events?.paused(),
    ended: () => events?.ended(),
    error: () => events?.error(),
  };

  function detach(): void {
    for (const type of EVENTS) audio.removeEventListener(type, handlers[type]);
  }

  function setRate(rate: number): void {
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
  }

  return {
    kind: 'audio',
    supports: (track) => track.audio !== null && track.audio.url !== '',
    load(track: Track, options: LoadOptions, bound: AdapterEvents) {
      detach();
      generation += 1;
      const token = generation;
      events = bound;
      fallbackDuration = track.audio?.durationSeconds ?? null;
      pending = options.position > 0 ? options.position : null;
      for (const type of EVENTS) audio.addEventListener(type, handlers[type]);
      ready = resolve((track.audio as NonNullable<Track['audio']>).url).then(
        (src) => {
          if (token !== generation) return false;
          audio.src = src;
          setRate(options.rate);
          audio.load();
          return true;
        },
        () => {
          if (token === generation) events?.error();
          return false;
        },
      );
    },
    play() {
      const token = generation;
      void ready.then((loaded) => {
        if (!loaded || token !== generation) return;
        audio.play().catch((error: unknown) => {
          if (token !== generation) return;
          const name = (error as { name?: unknown } | null)?.name;
          if (name === 'AbortError') return;
          if (name === 'NotAllowedError') events?.paused();
          else events?.error();
        });
      });
    },
    pause() {
      audio.pause();
    },
    seek(position) {
      if (audio.readyState >= HAVE_METADATA) {
        audio.currentTime = position;
        pending = null;
      } else pending = position;
    },
    setRate,
    stop() {
      generation += 1;
      detach();
      events = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
