/**
 * The Listen page's controller (L-085): wires the queue state machine to the page, the reader's settings, the resume
 * point, the Media Session and the day API, through injected interfaces so it runs (and is tested) without a DOM.
 *
 * - Speed starts at Settings → Default playback speed and every change is saved back there.
 * - The resume point (segment and position) is saved per day on every track change and pause, and every few seconds
 *   while playing; hearing the queue to the end forgets it.
 * - Audio files are looked up in the day API document once the page has loaded; until then (or without one) device
 *   speech reads each segment.
 * - Keyboard shortcuts come from `shortcutFor`; the page passes key presses in and calls `preventDefault` when the
 *   controller handled one.
 *
 * The page-side `ListenUi` renders what `playerView` and `announcement` return; it keeps the DOM stable (the queue
 * list is never re-rendered) so keyboard focus is never lost while the queue moves on.
 */
import type { SettingsStorage } from '../settings.ts';
import { loadSettings, updateSettings } from '../settings.ts';
import type { ListenData } from './listen.ts';
import { NO_MEDIA_SESSION, bindMediaSession, shortcutFor, SKIP_SECONDS } from './media-session.ts';
import type { KeyPress, MediaSessionBinding, MediaSessionEnvironment } from './media-session.ts';
import { createPlayer } from './queue.ts';
import type { ChangeReason, PlaybackAdapter, Player, PlayerState } from './queue.ts';
import { clearResume, loadResume, resumeStart, saveResume } from './resume.ts';
import { announcement, playerView, withApiAudio } from './view.ts';
import type { PlayerView } from './view.ts';

/** What the page renders. */
export interface ListenUi {
  /** The current track changed: mark it in the list and show its title and reading. */
  track(index: number): void;
  /** The controls, time and source line. */
  render(view: PlayerView): void;
  speed(speed: number): void;
  /** Says `message` in the live region. */
  announce(message: string): void;
}

export interface ListenEnvironment {
  readonly storage: SettingsStorage | null;
  readonly audio: PlaybackAdapter | null;
  readonly speech: PlaybackAdapter | null;
  readonly mediaSession: MediaSessionEnvironment | null;
  /** Fetches the day API document (JSON), or rejects. */
  readonly fetchDay: (url: string) => Promise<unknown>;
  /** Milliseconds now, for throttling resume saves. */
  readonly now?: () => number;
}

export interface ListenController {
  readonly player: Player;
  /** Resolves once the day API's audio files are applied (or the lookup failed). */
  readonly audioReady: Promise<void>;
  /** Plays track `index` from its start (the queue list's buttons). */
  select(index: number): void;
  /** Sets and saves the speed (the speed control). */
  setSpeed(speed: number): void;
  /** A key press; true when it was a shortcut the controller handled (the page then prevents the default). */
  key(press: KeyPress): boolean;
  /** Saves the resume point now (the page is being hidden or left). */
  save(): void;
  destroy(): void;
}

/** While playing, the resume point is saved at most this often (ms). */
export const RESUME_SAVE_INTERVAL = 5000;

/** The next speed up (`1`) or down (`-1`) from `speed` among `speeds`, or `speed` at either end. */
export function stepSpeed(speeds: readonly number[], speed: number, direction: 1 | -1): number {
  const sorted = [...speeds].sort((a, b) => a - b);
  const next =
    direction > 0
      ? sorted.find((candidate) => candidate > speed)
      : sorted.reverse().find((candidate) => candidate < speed);
  return next ?? speed;
}

export function createListenController(
  data: Pick<ListenData, 'date' | 'api' | 'album' | 'artwork' | 'tracks' | 'messages'>,
  speeds: readonly number[],
  ui: ListenUi,
  env: ListenEnvironment,
): ListenController {
  const now = env.now ?? Date.now;
  const { tracks, messages, date } = data;
  const settings = loadSettings(env.storage);
  const start = resumeStart(
    loadResume(env.storage, date),
    tracks.map((track) => track.id),
  );
  let lastSave = 0;
  // Bound once the player exists; the player reports no change before that.
  let media: MediaSessionBinding = NO_MEDIA_SESSION;

  const save = (state: PlayerState): void => {
    lastSave = now();
    if (state.track === null) return;
    if (state.status === 'finished') clearResume(env.storage, date);
    else saveResume(env.storage, date, { id: state.track.id, position: state.position });
  };

  const onChange = (state: PlayerState, reason: ChangeReason): void => {
    if (reason === 'track') ui.track(state.index);
    if (reason === 'speed') ui.speed(state.speed);
    ui.render(playerView(state, tracks.length, messages));
    const message = announcement(state, reason, messages);
    if (message !== null) ui.announce(message);
    media.update(state, reason);
    if (reason === 'track' || reason === 'status' || now() - lastSave >= RESUME_SAVE_INTERVAL) save(state);
  };

  const player = createPlayer({
    tracks,
    audio: env.audio,
    speech: env.speech,
    speed: settings.playbackSpeed,
    start,
    onChange,
  });
  media = bindMediaSession(env.mediaSession, player, {
    album: data.album,
    artwork: data.artwork,
    tracks: new Map(tracks.map((track) => [track.id, { reading: track.reading }])),
  });
  ui.track(player.state.index);
  ui.speed(player.state.speed);
  ui.render(playerView(player.state, tracks.length, messages));

  const audioReady =
    env.audio === null || tracks.length === 0
      ? Promise.resolve()
      : env.fetchDay(data.api).then(
          (document) => {
            player.replaceTracks(withApiAudio(tracks, document));
          },
          () => undefined,
        );

  const setSpeed = (speed: number): void => {
    player.setSpeed(speed);
    updateSettings(env.storage, { playbackSpeed: player.state.speed });
  };

  return {
    player,
    audioReady,
    select: (index) => player.select(index),
    setSpeed,
    key(press) {
      const action = shortcutFor(press);
      if (action === null || tracks.length === 0) return false;
      switch (action) {
        case 'toggle':
          player.toggle();
          break;
        case 'back':
          player.seekBy(-SKIP_SECONDS);
          break;
        case 'forward':
          player.seekBy(SKIP_SECONDS);
          break;
        case 'next':
          player.next();
          break;
        case 'previous':
          player.previous();
          break;
        case 'slower':
          setSpeed(stepSpeed(speeds, player.state.speed, -1));
          break;
        case 'faster':
          setSpeed(stepSpeed(speeds, player.state.speed, 1));
          break;
      }
      return true;
    },
    save: () => save(player.state),
    destroy() {
      save(player.state);
      player.destroy();
      media.release();
    },
  };
}
