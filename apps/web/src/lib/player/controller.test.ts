import { describe, expect, it, vi } from 'vitest';

import { STORAGE_KEY } from '../settings.ts';
import { RESUME_SAVE_INTERVAL, createListenController, stepSpeed } from './controller.ts';
import type { ListenEnvironment, ListenUi } from './controller.ts';
import { FakeAdapter, MemoryStorage, flush, track } from './fixtures/fakes.ts';
import type { ListenData, ListenTrack } from './listen.ts';
import type { MediaAction, MediaSessionLike } from './media-session.ts';
import { RESUME_KEY, loadResume, saveResume } from './resume.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const DATE = '2026-09-20';

const listenTrack = (id: string): ListenTrack => ({
  ...track(id),
  reading: 'Gospel · Matthew 20:1–16a',
  fallback: false,
});

const data: Pick<ListenData, 'date' | 'api' | 'album' | 'artwork' | 'tracks' | 'messages'> = {
  date: DATE,
  api: '/lectio/api/v1/days/2026-09-20.json',
  album: 'Listen · Sunday 20 September 2026',
  artwork: [],
  tracks: [listenTrack('a'), listenTrack('b'), listenTrack('c')],
  messages: {
    play: 'Play',
    pause: 'Pause',
    position: '{position} of {duration}',
    playing: 'Now playing: {title}',
    paused: 'Paused: {title}',
    finished: 'All done.',
    unavailable: 'Cannot play.',
    audio: 'Recorded narration',
    speech: 'Device voice',
    fallback: 'Fallback',
  },
};

function fakeUi() {
  return {
    track: vi.fn<ListenUi['track']>(),
    render: vi.fn<ListenUi['render']>(),
    speed: vi.fn<ListenUi['speed']>(),
    announce: vi.fn<ListenUi['announce']>(),
  } satisfies ListenUi;
}

function setup(overrides: Partial<ListenEnvironment> = {}, tracks = data.tracks) {
  const storage = new MemoryStorage();
  const audio = new FakeAdapter('audio');
  const speech = new FakeAdapter('speech');
  const ui = fakeUi();
  let clock = 0;
  const env: ListenEnvironment = {
    storage,
    audio,
    speech,
    mediaSession: null,
    fetchDay: vi.fn(() => Promise.resolve({})),
    now: () => clock,
    ...overrides,
  };
  const tick = (ms: number) => {
    clock += ms;
  };
  return {
    storage,
    audio,
    speech,
    ui,
    env,
    tick,
    make: () => createListenController({ ...data, tracks }, SPEEDS, ui, env),
  };
}

describe('stepSpeed', () => {
  it('steps up and down through the speeds and stops at either end', () => {
    expect(stepSpeed(SPEEDS, 1, 1)).toBe(1.25);
    expect(stepSpeed(SPEEDS, 1, -1)).toBe(0.75);
    expect(stepSpeed(SPEEDS, 2, 1)).toBe(2);
    expect(stepSpeed(SPEEDS, 0.75, -1)).toBe(0.75);
    expect(stepSpeed(SPEEDS, 1.1, 1)).toBe(1.25);
  });
});

describe('createListenController', () => {
  it('starts at the saved speed and resume point, and renders the first state', () => {
    const { storage, ui, make } = setup();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, playbackSpeed: 1.5 }));
    saveResume(storage, DATE, { id: 'b', position: 9 });
    const controller = make();
    expect(controller.player.state).toMatchObject({ index: 1, position: 9, speed: 1.5 });
    expect(ui.track).toHaveBeenCalledWith(1);
    expect(ui.speed).toHaveBeenCalledWith(1.5);
    expect(ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ toggle: 'Play', elapsed: '0:09' }));
  });

  it('renders, announces and saves the resume point as the queue plays', () => {
    const { storage, ui, speech, tick, make } = setup();
    const controller = make();
    controller.player.play();
    expect(ui.announce).toHaveBeenLastCalledWith('Now playing: Title a');
    expect(ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ toggle: 'Pause', source: 'Device voice' }));
    expect(loadResume(storage, DATE)).toMatchObject({ id: 'a', position: 0, source: 'speech' });

    speech.events?.time(2, 20);
    expect(loadResume(storage, DATE)).toMatchObject({ id: 'a', position: 0, source: 'speech' });
    tick(RESUME_SAVE_INTERVAL);
    speech.events?.time(6, 20);
    expect(loadResume(storage, DATE)).toMatchObject({ id: 'a', position: 6, source: 'speech' });

    speech.events?.ended();
    expect(ui.track).toHaveBeenLastCalledWith(1);
    expect(ui.announce).toHaveBeenLastCalledWith('Now playing: Title b');
    expect(loadResume(storage, DATE)).toMatchObject({ id: 'b', position: 0, source: 'speech' });
    controller.player.pause();
    expect(ui.announce).toHaveBeenLastCalledWith('Paused: Title b');
    controller.player.select(2);
    speech.events?.ended();
    expect(ui.announce).toHaveBeenLastCalledWith('All done.');
    expect(loadResume(storage, DATE)).toBeNull();
  });

  it('sets and saves the speed, through the control and the keyboard', () => {
    const { storage, ui, make } = setup();
    const controller = make();
    controller.setSpeed(1.75);
    expect(ui.speed).toHaveBeenLastCalledWith(1.75);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ playbackSpeed: 1.75 });
    expect(controller.key({ key: '>' })).toBe(true);
    expect(controller.key({ key: '>' })).toBe(true);
    expect(controller.player.state.speed).toBe(2);
    expect(controller.key({ key: '<' })).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ playbackSpeed: 1.75 });
  });

  it('answers the keyboard shortcuts and leaves other keys alone', () => {
    const { speech, make } = setup();
    const controller = make();
    expect(controller.key({ key: ' ' })).toBe(false);
    expect(controller.key({ key: ' ', inPlayer: true })).toBe(true);
    expect(controller.player.state.status).toBe('playing');
    speech.events?.time(30, 60);
    controller.key({ key: 'j' });
    expect(controller.player.state.position).toBe(20);
    controller.key({ key: 'ArrowRight' });
    expect(controller.player.state.position).toBe(30);
    controller.key({ key: 'N', shiftKey: true });
    expect(controller.player.state.index).toBe(1);
    controller.key({ key: 'P', shiftKey: true });
    expect(controller.player.state.index).toBe(0);
    controller.key({ key: 'k' });
    expect(controller.player.state.status).toBe('paused');
    expect(controller.key({ key: 'x' })).toBe(false);
    expect(controller.key({ key: 'k', target: { tagName: 'INPUT' } })).toBe(false);
  });

  it('plays the files the day API lists once they are in, and keeps device speech without them', async () => {
    const document = {
      masses: [{ segments: [{ id: 'a', locale: 'en', audio: { url: 'https://audio.test/a.mp3' } }] }],
    };
    const fetchDay = vi.fn(() => Promise.resolve(document));
    const { audio, speech, env, make } = setup({ fetchDay });
    const controller = make();
    await controller.audioReady;
    expect(fetchDay).toHaveBeenCalledWith(data.api);
    controller.player.play();
    expect(audio.calls).toEqual(['load a @0 x1', 'play']);
    expect(speech.calls).toEqual([]);
    expect(env.fetchDay).toHaveBeenCalledOnce();

    const offline = setup({ fetchDay: () => Promise.reject(new Error('offline')) });
    const fallback = offline.make();
    await expect(fallback.audioReady).resolves.toBeUndefined();
    fallback.player.play();
    expect(offline.speech.calls).toEqual(['load a @0 x1', 'play']);
  });

  it('does not look for files without an audio element or with nothing to play', async () => {
    const fetchDay = vi.fn(() => Promise.resolve({}));
    await setup({ fetchDay, audio: null }).make().audioReady;
    await setup({ fetchDay }, []).make().audioReady;
    expect(fetchDay).not.toHaveBeenCalled();
    const empty = setup({ now: undefined }, []);
    const controller = empty.make();
    expect(controller.key({ key: 'k' })).toBe(false);
    controller.save();
    expect(empty.storage.getItem(RESUME_KEY)).toBeNull();
  });

  it('drives and releases the Media Session', async () => {
    const handlers = new Map<MediaAction, unknown>();
    const session: MediaSessionLike = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: (action, handler) => handlers.set(action, handler),
    };
    const { make, storage } = setup({ mediaSession: { session, metadata: (init) => init } });
    const controller = make();
    expect(session.metadata).toMatchObject({ title: 'Title a', artist: 'Gospel · Matthew 20:1–16a' });
    controller.player.play();
    expect(session.playbackState).toBe('playing');
    controller.select(2);
    expect(session.metadata).toMatchObject({ title: 'Title c' });
    controller.save();
    expect(loadResume(storage, DATE)).toMatchObject({ id: 'c', position: 0, source: 'speech' });
    controller.destroy();
    expect(session.playbackState).toBe('none');
    expect(handlers.get('play')).toBeNull();
    await flush();
    expect(storage.getItem(RESUME_KEY)).toContain('"c"');
  });

  it('shows a queue nothing can play as unavailable, ignores the shortcuts, and recovers when files arrive', async () => {
    const document = {
      masses: [{ segments: [{ id: 'b', locale: 'en', audio: { url: 'https://audio.test/b.mp3' } }] }],
    };
    const { ui, storage, make } = setup({ speech: null, fetchDay: () => Promise.resolve(document) });
    saveResume(storage, DATE, { id: 'b', position: 9, source: 'speech', duration: 30 });
    const controller = make();
    expect(ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ unavailable: true, canNext: false }));
    expect(controller.key({ key: 'k' })).toBe(false);
    controller.select(1);
    controller.save();
    // Nothing was loaded, so the saved point still stands.
    expect(loadResume(storage, DATE)).toMatchObject({ id: 'b', position: 9 });
    await controller.audioReady;
    expect(ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ unavailable: false }));
    expect(controller.player.state.status).toBe('idle');
  });
});
