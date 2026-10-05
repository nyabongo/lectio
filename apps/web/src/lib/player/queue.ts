/**
 * The Listen queue's state machine (L-085): one day's narration segments played in order, through one of two
 * playback adapters.
 *
 * - `audio`: an `HTMLAudioElement` playing the segment's rendered file (`audio-adapter.ts`);
 * - `speech`: the device's text-to-speech reading the segment's script (`speech-adapter.ts`), used when a segment has
 *   no audio file (`audio: null` in the day API) or its file fails to load or play.
 *
 * Transitions: `load` (choose the adapter for the current track), `play`, `pause`, `next`, `previous`, `seek`,
 * `ended` (advance, or finish after the last track), `setSpeed` and `error` (fall back from audio to speech at the
 * same point of the segment; when speech fails too the segment is skipped). Events from an adapter that has since
 * been replaced are ignored, so a late `ended` or `error` never moves the queue twice.
 *
 * Positions and durations are in seconds of the segment at 1× (an audio element's `currentTime`; the speech adapter
 * estimates them from the script's length), so a resume point survives a speed change. Browser-safe, no DOM: the
 * Listen page wires it to real adapters, and tests drive it with fakes.
 */

/** A rendered narration file (`audio` of a segment in the day API, L-082). */
export interface TrackAudio {
  readonly url: string;
  readonly durationSeconds?: number | null | undefined;
}

/** One item of the queue: a narration segment as the Listen page plays it. */
export interface Track {
  /** The segment id, the same in every language: `MT.20.1-16/context`, `MT.20.1-16/note/v15-evil-eye`. */
  readonly id: string;
  /** Short label (the context title, or a note's anchor and transliteration). */
  readonly title: string;
  /** The language of `script` and of the voice that reads it. */
  readonly locale: string;
  /** What device speech reads when there is no audio file. */
  readonly script: string;
  /** The rendered file, or `null` when there is none (device speech reads `script`). */
  readonly audio: TrackAudio | null;
}

export type Source = 'audio' | 'speech';

/** What an adapter reports back while a track is loaded. */
export interface AdapterEvents {
  /** The playback point moved (seconds at 1×) and the track's length, when known. */
  time(position: number, duration: number | null): void;
  /** Playback started or resumed, including from outside (a headset button acting on the audio element). */
  playing(): void;
  /** Playback stopped without finishing (from outside, or the browser refused to start it). */
  paused(): void;
  /** The track played to its end. */
  ended(): void;
  /** The track cannot be played by this adapter (missing file, decode error, no voice). */
  error(): void;
}

export interface LoadOptions {
  /** Playback rate (the queue's speed). */
  readonly rate: number;
  /** Where to start, in seconds at 1×. */
  readonly position: number;
}

/** A way of playing tracks: the audio element or device speech. */
export interface PlaybackAdapter {
  readonly kind: Source;
  /** Whether this adapter can play `track` at all (audio needs a file; speech needs a script and the API). */
  supports(track: Track): boolean;
  /** Prepares `track` without starting it; `events` stay bound until `stop`. */
  load(track: Track, options: LoadOptions, events: AdapterEvents): void;
  play(): void;
  pause(): void;
  seek(position: number): void;
  setRate(rate: number): void;
  /** Stops and unloads the track; no event fires after this. */
  stop(): void;
}

/**
 * - `idle`: loaded, never started; `playing`; `paused`;
 * - `finished`: the last track ended (play starts the queue again);
 * - `unavailable`: nothing in the queue can be played on this device.
 */
export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'finished' | 'unavailable';

export interface PlayerState {
  readonly index: number;
  readonly track: Track | null;
  readonly status: PlayerStatus;
  /** Seconds at 1× into the current track. */
  readonly position: number;
  /** The current track's length in seconds at 1×, when known. */
  readonly duration: number | null;
  readonly speed: number;
  /** Which adapter plays the current track (`null` when none can). */
  readonly source: Source | null;
  /** True when the current track has a file that failed, and device speech reads it instead. */
  readonly fallback: boolean;
}

/** Why the state changed: `track` when another track was loaded (announce it, update the Media Session). */
export type ChangeReason = 'track' | 'status' | 'time' | 'speed';

export interface PlayerOptions {
  readonly tracks: readonly Track[];
  /** Adapters in order of preference for a track with a file; `null` when the browser lacks one. */
  readonly audio: PlaybackAdapter | null;
  readonly speech: PlaybackAdapter | null;
  /** Starting speed (from Settings). */
  readonly speed?: number;
  /** Where to start (a saved resume point). */
  readonly start?: { readonly index: number; readonly position: number };
  readonly onChange?: (state: PlayerState, reason: ChangeReason) => void;
}

export interface Player {
  readonly state: PlayerState;
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  previous(): void;
  /** Plays track `index` from its start. */
  select(index: number): void;
  seek(position: number): void;
  seekBy(delta: number): void;
  setSpeed(speed: number): void;
  /**
   * Swaps in updated tracks (the same ids in the same order, e.g. with audio files found later). The track now
   * loaded keeps playing as it is; the new ones apply from the next load. Returns false (and changes nothing) when the
   * ids differ.
   */
  replaceTracks(next: readonly Track[]): boolean;
  /** Stops playback for good (the page is going away). */
  destroy(): void;
}

/** `previous` restarts the current track instead of going back when it is further in than this (seconds). */
export const RESTART_THRESHOLD = 3;

/**
 * Device speech reads about this many characters a second at 1×: the speech adapter's estimate of a track's length
 * and position, since `speechSynthesis` reports neither.
 */
export const SPEECH_CHARS_PER_SECOND = 15;

/** The estimated length in seconds at 1× of `script` read by device speech. */
export function speechDuration(script: string): number {
  return script.length / SPEECH_CHARS_PER_SECOND;
}

export const MIN_SPEED = 0.75;
export const MAX_SPEED = 2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A speed within the supported range (0.75–2×); anything that is not a finite number is 1×. */
export function clampSpeed(speed: number): number {
  return Number.isFinite(speed) ? clamp(speed, MIN_SPEED, MAX_SPEED) : 1;
}

export function createPlayer(options: PlayerOptions): Player {
  const { audio, speech } = options;
  let tracks = options.tracks;
  const last = tracks.length - 1;
  let index = clamp(Math.trunc(options.start?.index ?? 0), 0, Math.max(0, last));
  let status: PlayerStatus = 'idle';
  let position = Math.max(0, options.start?.position ?? 0);
  let duration: number | null = null;
  let speed = clampSpeed(options.speed ?? 1);
  let adapter: PlaybackAdapter | null = null;
  let fallback = false;
  /** Bumped on every load, so events from a replaced adapter are dropped. */
  let generation = 0;
  /** Tracks no adapter could play, so a queue of them ends instead of looping. */
  const failed = new Set<number>();

  const state = (): PlayerState => ({
    index,
    track: tracks[index] ?? null,
    status,
    position,
    duration,
    speed,
    source: adapter?.kind ?? null,
    fallback,
  });
  const emit = (reason: ChangeReason): void => options.onChange?.(state(), reason);
  const playable = (track: Track): boolean => [audio, speech].some((candidate) => candidate?.supports(track) === true);

  const setStatus = (next: PlayerStatus): void => {
    if (status === next) return;
    status = next;
    emit('status');
  };

  function events(token: number, current: PlaybackAdapter): AdapterEvents {
    const live = (): boolean => token === generation;
    return {
      time(at, length) {
        if (!live()) return;
        position = Math.max(0, at);
        duration =
          length ?? (current.kind === 'audio' ? ((tracks[index] as Track).audio?.durationSeconds ?? null) : null);
        emit('time');
      },
      playing() {
        if (!live()) return;
        failed.delete(index);
        setStatus('playing');
      },
      paused() {
        if (live() && status === 'playing') setStatus('paused');
      },
      ended() {
        if (live()) advance();
      },
      error() {
        if (live()) recover(current);
      },
    };
  }

  /** Loads the current track with `preferred` (or the best adapter for it) and starts it when `autoplay`. */
  function load(autoplay: boolean, preferred: PlaybackAdapter | null = null): void {
    adapter?.stop();
    generation += 1;
    const track = tracks[index] as Track;
    const chosen = preferred ?? [audio, speech].find((candidate) => candidate?.supports(track) === true) ?? null;
    adapter = chosen;
    if (preferred === null) fallback = false;
    duration = chosen?.kind === 'audio' ? (track.audio?.durationSeconds ?? null) : null;
    emit('track');
    if (chosen === null) {
      skip(autoplay);
      return;
    }
    chosen.load(track, { rate: speed, position }, events(generation, chosen));
    if (autoplay) {
      status = 'playing';
      chosen.play();
      emit('status');
    } else if (status === 'playing' || status === 'finished') setStatus('paused');
  }

  /** The current track cannot be played: skip it while playing, or report the queue unavailable. */
  function skip(autoplay: boolean): void {
    failed.add(index);
    if (failed.size >= tracks.length) {
      setStatus('unavailable');
      return;
    }
    if (autoplay && index < last) {
      index += 1;
      position = 0;
      load(true);
      return;
    }
    setStatus(autoplay ? 'finished' : 'paused');
  }

  /** An adapter failed on the current track: device speech takes over where audio stopped, else skip it. */
  function recover(current: PlaybackAdapter): void {
    const track = tracks[index] as Track;
    if (current.kind === 'audio' && speech?.supports(track) === true) {
      // Audio seconds are not speech seconds: carry over the fraction already heard.
      const heard = duration !== null && duration > 0 ? Math.min(1, position / duration) : 0;
      position = heard * speechDuration(track.script);
      fallback = true;
      load(status === 'playing', speech);
      return;
    }
    adapter?.stop();
    adapter = null;
    generation += 1;
    skip(status === 'playing');
  }

  function advance(): void {
    if (index < last) {
      index += 1;
      position = 0;
      load(true);
      return;
    }
    position = duration ?? position;
    (adapter as PlaybackAdapter).stop();
    adapter = null;
    generation += 1;
    setStatus('finished');
    emit('time');
  }

  function goTo(target: number, autoplay: boolean): void {
    if (tracks.length === 0) return;
    index = clamp(target, 0, last);
    position = 0;
    load(autoplay);
  }

  const player: Player = {
    get state() {
      return state();
    },
    play() {
      if (status === 'playing' || status === 'unavailable' || tracks.length === 0) return;
      if (status === 'finished') {
        failed.clear();
        goTo(0, true);
        return;
      }
      if (adapter === null) {
        load(true);
        return;
      }
      status = 'playing';
      adapter.play();
      emit('status');
    },
    pause() {
      if (status !== 'playing') return;
      adapter?.pause();
      setStatus('paused');
    },
    toggle() {
      if (status === 'playing') player.pause();
      else player.play();
    },
    next() {
      if (index < last) goTo(index + 1, status === 'playing');
    },
    previous() {
      if (status === 'finished') {
        goTo(last, false);
        return;
      }
      if (position > RESTART_THRESHOLD || index === 0) {
        player.seek(0);
        return;
      }
      goTo(index - 1, status === 'playing');
    },
    select(target) {
      failed.delete(target);
      goTo(target, true);
    },
    seek(at) {
      if (tracks.length === 0) return;
      position = clamp(at, 0, duration ?? Number.POSITIVE_INFINITY);
      adapter?.seek(position);
      emit('time');
    },
    seekBy(delta) {
      player.seek(position + delta);
    },
    setSpeed(next) {
      const clamped = clampSpeed(next);
      if (clamped === speed) return;
      speed = clamped;
      adapter?.setRate(speed);
      emit('speed');
    },
    replaceTracks(next) {
      if (next.length !== tracks.length || next.some((track, i) => track.id !== tracks[i]?.id)) return false;
      tracks = next;
      if (status === 'unavailable' && tracks.some(playable)) {
        failed.clear();
        setStatus('idle');
      }
      return true;
    },
    destroy() {
      adapter?.stop();
      adapter = null;
      generation += 1;
    },
  };

  if (!tracks.some(playable)) status = 'unavailable';
  return player;
}
