/**
 * Lock-screen and hardware controls for the Listen queue (L-085), and its keyboard shortcuts.
 *
 * `bindMediaSession` keeps the Media Session API in step with the player: metadata for the current segment (its title,
 * the reading it belongs to, the day, and the site icon as artwork), the playback state, the position (where the
 * browser supports `setPositionState`), and handlers for play, pause, stop, previous and next track, seek to a point
 * and skip back or forward. Browsers without `navigator.mediaSession` get a no-op; an action a browser does not know
 * is skipped (`setActionHandler` throws for it).
 *
 * `shortcutFor` maps a key press to a player action without hijacking anything: keys typed into a field, a select or
 * an editable element, presses with Ctrl, Alt or Meta, and Space or Enter on a button or link (their own activation)
 * are left alone.
 */
import type { Player, PlayerState } from './queue.ts';

/** How far the skip buttons and arrow keys move, in seconds. */
export const SKIP_SECONDS = 10;

export interface MediaImageLike {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
}

export interface MediaMetadataInit {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artwork: readonly MediaImageLike[];
}

export type MediaAction =
  'play' | 'pause' | 'stop' | 'previoustrack' | 'nexttrack' | 'seekto' | 'seekbackward' | 'seekforward';

export interface ActionDetails {
  readonly seekTime?: number | null;
  readonly seekOffset?: number | null;
}

/** The parts of `navigator.mediaSession` the binding uses. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: MediaAction, handler: ((details: ActionDetails) => void) | null): void;
  setPositionState?(state?: { duration: number; playbackRate: number; position: number }): void;
}

export interface MediaSessionEnvironment {
  readonly session: MediaSessionLike;
  /** `new MediaMetadata(init)`. */
  readonly metadata: (init: MediaMetadataInit) => unknown;
}

/** What the lock screen shows for a track. */
export interface TrackInfo {
  /** The reading the segment belongs to (`Gospel · Matthew 20:1–16a`). */
  readonly reading: string;
}

export interface MediaSessionOptions {
  /** The album line: the day (`Listen · Sunday 20 September 2026`). */
  readonly album: string;
  readonly artwork: readonly MediaImageLike[];
  /** Per track id: the reading line. */
  readonly tracks: ReadonlyMap<string, TrackInfo>;
}

export interface MediaSessionBinding {
  /** Call on every player change. */
  update(state: PlayerState, reason: 'track' | 'status' | 'time' | 'speed'): void;
  /** Removes the handlers and clears the metadata. */
  release(): void;
}

const ACTIONS: readonly MediaAction[] = [
  'play',
  'pause',
  'stop',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
];

/** The handler for each Media Session action. */
export function mediaActions(player: Player): Record<MediaAction, (details: ActionDetails) => void> {
  return {
    play: () => player.play(),
    pause: () => player.pause(),
    stop: () => player.pause(),
    previoustrack: () => player.previous(),
    nexttrack: () => player.next(),
    seekto: (details) => {
      if (typeof details.seekTime === 'number') player.seek(details.seekTime);
    },
    seekbackward: (details) => player.seekBy(-(details.seekOffset ?? SKIP_SECONDS)),
    seekforward: (details) => player.seekBy(details.seekOffset ?? SKIP_SECONDS),
  };
}

/** The binding where there is no Media Session: does nothing. */
export const NO_MEDIA_SESSION: MediaSessionBinding = { update: () => undefined, release: () => undefined };

export function bindMediaSession(
  env: MediaSessionEnvironment | null,
  player: Player,
  options: MediaSessionOptions,
): MediaSessionBinding {
  if (env === null) return NO_MEDIA_SESSION;
  const { session } = env;
  const handlers = mediaActions(player);
  for (const action of ACTIONS) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // This browser does not support the action.
    }
  }

  const setMetadata = (state: PlayerState): void => {
    if (state.track === null) {
      session.metadata = null;
      return;
    }
    session.metadata = env.metadata({
      title: state.track.title,
      artist: options.tracks.get(state.track.id)?.reading ?? '',
      album: options.album,
      artwork: options.artwork,
    });
  };

  const setPosition = (state: PlayerState): void => {
    if (typeof session.setPositionState !== 'function') return;
    try {
      if (state.duration === null || !(state.duration > 0)) session.setPositionState();
      else
        session.setPositionState({
          duration: state.duration,
          playbackRate: state.speed,
          position: Math.min(state.position, state.duration),
        });
    } catch {
      // An inconsistent state (position past the end while a file loads) is skipped, never thrown.
    }
  };

  const binding: MediaSessionBinding = {
    update(state, reason) {
      if (reason === 'track') setMetadata(state);
      session.playbackState = state.status === 'playing' ? 'playing' : state.track === null ? 'none' : 'paused';
      setPosition(state);
    },
    release() {
      for (const action of ACTIONS) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Not supported, so never set.
        }
      }
      session.metadata = null;
      session.playbackState = 'none';
    },
  };
  binding.update(player.state, 'track');
  return binding;
}

/** The browser's Media Session, or `null` where there is none. */
export function browserMediaSession(scope: {
  navigator?: { mediaSession?: MediaSessionLike };
  MediaMetadata?: new (init: MediaMetadataInit) => unknown;
}): MediaSessionEnvironment | null {
  const session = scope.navigator?.mediaSession;
  const Metadata = scope.MediaMetadata;
  if (session === undefined || Metadata === undefined) return null;
  return { session, metadata: (init) => new Metadata({ ...init, artwork: [...init.artwork] }) };
}

/** The player actions keyboard shortcuts trigger. */
export type ShortcutAction = 'toggle' | 'back' | 'forward' | 'next' | 'previous' | 'slower' | 'faster';

/** The parts of a `KeyboardEvent` (and its target) the shortcut map reads. */
export interface KeyPress {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: {
    readonly tagName?: string;
    readonly isContentEditable?: boolean;
    readonly getAttribute?: (name: string) => string | null;
  } | null;
}

/** Keys and what they do; listed on the page in this order. */
export const SHORTCUTS: Readonly<Record<string, ShortcutAction>> = {
  ' ': 'toggle',
  k: 'toggle',
  ArrowLeft: 'back',
  j: 'back',
  ArrowRight: 'forward',
  l: 'forward',
  N: 'next',
  P: 'previous',
  '<': 'slower',
  '>': 'faster',
};

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATES = new Set(['BUTTON', 'A', 'SUMMARY']);
const OWN_ARROWS = new Set(['slider', 'tab', 'radio', 'menuitem', 'option', 'listbox']);

/** The action for a key press, or `null` when the page should leave it alone. */
export function shortcutFor(press: KeyPress): ShortcutAction | null {
  if (press.ctrlKey === true || press.altKey === true || press.metaKey === true) return null;
  const target = press.target ?? null;
  const tag = target?.tagName?.toUpperCase() ?? '';
  if (TYPING.has(tag) || target?.isContentEditable === true) return null;
  if ((press.key === ' ' || press.key === 'Enter') && ACTIVATES.has(tag)) return null;
  const role = target?.getAttribute?.('role') ?? '';
  if (press.key.startsWith('Arrow') && OWN_ARROWS.has(role)) return null;
  const key = press.key.length === 1 && press.shiftKey !== true ? press.key.toLowerCase() : press.key;
  return SHORTCUTS[key] ?? null;
}
