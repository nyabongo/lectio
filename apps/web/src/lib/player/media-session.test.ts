import { describe, expect, it, vi } from 'vitest';

import { FakeAdapter, track } from './fixtures/fakes.ts';
import {
  SHORTCUTS,
  SKIP_SECONDS,
  bindMediaSession,
  browserMediaSession,
  mediaActions,
  shortcutFor,
} from './media-session.ts';
import type { ActionDetails, MediaAction, MediaMetadataInit, MediaSessionLike } from './media-session.ts';
import { createPlayer } from './queue.ts';
import type { Player } from './queue.ts';

class FakeSession implements MediaSessionLike {
  metadata: unknown = undefined;
  playbackState: 'none' | 'paused' | 'playing' = 'none';
  readonly handlers = new Map<MediaAction, ((details: ActionDetails) => void) | null>();
  readonly positions: unknown[] = [];
  unsupported = new Set<MediaAction>();
  positionThrows = false;

  setActionHandler(action: MediaAction, handler: ((details: ActionDetails) => void) | null): void {
    if (this.unsupported.has(action)) throw new TypeError(`unsupported ${action}`);
    this.handlers.set(action, handler);
  }

  setPositionState(state?: { duration: number; playbackRate: number; position: number }): void {
    if (this.positionThrows) throw new TypeError('bad state');
    this.positions.push(state);
  }
}

const tracks = [track('a', 'https://audio.test/a.mp3'), track('b')];
const options = {
  album: 'Listen · Sunday 20 September 2026',
  artwork: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  tracks: new Map([['a', { reading: 'Gospel · Matthew 20:1–16a' }]]),
};

function setup(session = new FakeSession()) {
  const audio = new FakeAdapter('audio');
  const speech = new FakeAdapter('speech');
  let binding: ReturnType<typeof bindMediaSession> | null = null;
  const player = createPlayer({
    tracks,
    audio,
    speech,
    onChange: (state, reason) => binding?.update(state, reason),
  });
  binding = bindMediaSession(
    { session, metadata: (init: MediaMetadataInit) => ({ ...init, kind: 'metadata' }) },
    player,
    options,
  );
  return { session, player, audio, speech, binding };
}

describe('mediaActions', () => {
  it('maps every action to the player', () => {
    const player = {
      play: vi.fn(),
      pause: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      seek: vi.fn(),
      seekBy: vi.fn(),
    } as unknown as Player;
    const actions = mediaActions(player);
    actions.play({});
    actions.pause({});
    actions.stop({});
    actions.previoustrack({});
    actions.nexttrack({});
    actions.seekto({ seekTime: 12 });
    actions.seekto({});
    actions.seekbackward({});
    actions.seekbackward({ seekOffset: 5 });
    actions.seekforward({ seekOffset: null });
    actions.seekforward({ seekOffset: 30 });
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.pause).toHaveBeenCalledTimes(2);
    expect(player.previous).toHaveBeenCalledOnce();
    expect(player.next).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(12);
    expect(vi.mocked(player.seekBy).mock.calls).toEqual([[-SKIP_SECONDS], [-5], [SKIP_SECONDS], [30]]);
  });
});

describe('bindMediaSession', () => {
  it('shows the current segment, its reading and the day, and keeps the state in step', () => {
    const { session, player, audio } = setup();
    expect(session.metadata).toEqual({
      kind: 'metadata',
      title: 'Title a',
      artist: 'Gospel · Matthew 20:1–16a',
      album: options.album,
      artwork: options.artwork,
    });
    expect(session.playbackState).toBe('paused');
    expect(session.positions.at(-1)).toBeUndefined();

    player.play();
    expect(session.playbackState).toBe('playing');
    audio.events?.time(5, 20);
    expect(session.positions.at(-1)).toEqual({ duration: 20, playbackRate: 1, position: 5 });
    player.setSpeed(1.5);
    expect(session.positions.at(-1)).toEqual({ duration: 20, playbackRate: 1.5, position: 5 });
    audio.events?.time(25, 20);
    expect(session.positions.at(-1)).toEqual({ duration: 20, playbackRate: 1.5, position: 20 });

    audio.events?.ended();
    expect(session.metadata).toMatchObject({ title: 'Title b', artist: '' });
  });

  it('drives the player from lock-screen actions', () => {
    const { session, player } = setup();
    session.handlers.get('play')?.({});
    expect(player.state.status).toBe('playing');
    session.handlers.get('nexttrack')?.({});
    expect(player.state.index).toBe(1);
    session.handlers.get('pause')?.({});
    expect(player.state.status).toBe('paused');
  });

  it('skips actions and position updates the browser rejects, and releases its handlers', () => {
    const session = new FakeSession();
    session.unsupported.add('seekto');
    session.positionThrows = true;
    const { binding, player } = setup(session);
    expect(session.handlers.has('seekto')).toBe(false);
    expect(() => player.play()).not.toThrow();
    binding.release();
    expect([...session.handlers.values()].every((handler) => handler === null)).toBe(true);
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
  });

  it('works without setPositionState, clears metadata for an empty queue, and is a no-op without a session', () => {
    const session = new FakeSession() as MediaSessionLike & { setPositionState?: unknown };
    delete session.setPositionState;
    Object.defineProperty(session, 'setPositionState', { value: undefined });
    const empty = createPlayer({ tracks: [], audio: null, speech: null });
    bindMediaSession({ session, metadata: () => ({}) }, empty, options);
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');

    const noop = bindMediaSession(null, empty, options);
    expect(() => {
      noop.update(empty.state, 'track');
      noop.release();
    }).not.toThrow();
  });
});

describe('browserMediaSession', () => {
  it('wraps navigator.mediaSession and MediaMetadata, or gives null without them', () => {
    const session = new FakeSession();
    class Metadata {
      readonly init: MediaMetadataInit;

      constructor(init: MediaMetadataInit) {
        this.init = init;
      }
    }
    const env = browserMediaSession({ navigator: { mediaSession: session }, MediaMetadata: Metadata });
    expect(env?.session).toBe(session);
    const metadata = env?.metadata({ title: 't', artist: 'a', album: 'b', artwork: options.artwork });
    expect(metadata).toBeInstanceOf(Metadata);
    expect((metadata as Metadata).init.artwork).not.toBe(options.artwork);
    expect(browserMediaSession({ navigator: {}, MediaMetadata: Metadata })).toBeNull();
    expect(browserMediaSession({ navigator: { mediaSession: session } })).toBeNull();
    expect(browserMediaSession({})).toBeNull();
  });
});

describe('shortcutFor', () => {
  const on = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra });

  it('maps the documented keys', () => {
    expect(Object.entries(SHORTCUTS).map(([key]) => shortcutFor({ key, shiftKey: /^[A-Z<>]$/.test(key) }))).toEqual(
      Object.values(SHORTCUTS),
    );
    expect(shortcutFor({ key: 'K' })).toBe('toggle');
    expect(shortcutFor({ key: 'n' })).toBeNull();
    expect(shortcutFor({ key: 'J', shiftKey: true })).toBeNull();
    expect(shortcutFor({ key: 'Escape' })).toBeNull();
  });

  it('leaves fields, editable text, modified keys and button activation alone', () => {
    for (const tag of ['input', 'TEXTAREA', 'select']) expect(shortcutFor({ key: 'k', target: on(tag) })).toBeNull();
    expect(shortcutFor({ key: 'k', target: on('DIV', { isContentEditable: true }) })).toBeNull();
    expect(shortcutFor({ key: 'k', ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: 'k', altKey: true })).toBeNull();
    expect(shortcutFor({ key: 'k', metaKey: true })).toBeNull();
    expect(shortcutFor({ key: ' ', target: on('BUTTON') })).toBeNull();
    expect(shortcutFor({ key: 'Enter', target: on('a') })).toBeNull();
    expect(shortcutFor({ key: 'k', target: on('BUTTON') })).toBe('toggle');
    expect(shortcutFor({ key: ' ', target: on('BODY') })).toBe('toggle');
    expect(shortcutFor({ key: ' ', target: null })).toBe('toggle');
  });

  it('leaves arrow keys to widgets that use them', () => {
    const slider = on('DIV', { getAttribute: (name: string) => (name === 'role' ? 'slider' : null) });
    expect(shortcutFor({ key: 'ArrowLeft', target: slider })).toBeNull();
    expect(shortcutFor({ key: 'k', target: slider })).toBe('toggle');
    const plain = on('DIV', { getAttribute: () => null });
    expect(shortcutFor({ key: 'ArrowRight', target: plain })).toBe('forward');
  });
});
