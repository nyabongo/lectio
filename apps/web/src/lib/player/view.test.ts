import { describe, expect, it } from 'vitest';

import { track } from './fixtures/fakes.ts';
import type { PlayerState } from './queue.ts';
import { announcement, fill, formatTime, playerView, withApiAudio } from './view.ts';
import type { PlayerMessages } from './view.ts';

const messages: PlayerMessages = {
  play: 'Play',
  pause: 'Pause',
  position: '{position} of {duration}',
  playing: 'Now playing: {title}',
  paused: 'Paused: {title}',
  finished: 'All done.',
  unavailable: 'Cannot play.',
  audio: 'Recorded narration',
  speech: "Read by your device's voice",
  fallback: 'The recording could not be played.',
};

const state = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  index: 0,
  track: track('a'),
  status: 'idle',
  position: 0,
  duration: null,
  speed: 1,
  source: null,
  fallback: false,
  ...overrides,
});

describe('fill and formatTime', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('{a} and {b}', { a: '1' })).toBe('1 and {b}');
  });

  it('writes times as m:ss or h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(null)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('playerView', () => {
  it('shows a paused track that has not started', () => {
    expect(playerView(state(), 3, messages)).toEqual({
      toggle: 'Play',
      playing: false,
      elapsed: '0:00',
      total: '0:00',
      valueText: '0:00 of 0:00',
      max: 1,
      value: 0,
      source: '',
      canPrevious: true,
      canNext: true,
      unavailable: false,
    });
  });

  it('shows a playing track, its source and where it is', () => {
    const view = playerView(
      state({ status: 'playing', position: 42.7, duration: 130.2, source: 'audio', index: 2 }),
      3,
      messages,
    );
    expect(view).toMatchObject({
      toggle: 'Pause',
      playing: true,
      valueText: '0:42 of 2:10',
      max: 131,
      value: 42,
      source: 'Recorded narration',
      canNext: false,
    });
    expect(playerView(state({ source: 'speech' }), 3, messages).source).toBe("Read by your device's voice");
    expect(playerView(state({ source: 'speech', fallback: true }), 3, messages).source).toBe(
      'The recording could not be played.',
    );
  });

  it('disables the queue controls when nothing can play', () => {
    expect(playerView(state({ status: 'unavailable' }), 3, messages)).toMatchObject({
      canPrevious: false,
      canNext: false,
      unavailable: true,
    });
    expect(playerView(state({ track: null }), 0, messages)).toMatchObject({ canPrevious: false, canNext: false });
  });
});

describe('announcement', () => {
  it('announces a new track while playing, and each status change', () => {
    expect(announcement(state({ status: 'playing' }), 'track', messages)).toBe('Now playing: Title a');
    expect(announcement(state(), 'track', messages)).toBeNull();
    expect(announcement(state({ status: 'playing' }), 'status', messages)).toBe('Now playing: Title a');
    expect(announcement(state({ status: 'paused' }), 'status', messages)).toBe('Paused: Title a');
    expect(announcement(state({ status: 'finished' }), 'status', messages)).toBe('All done.');
    expect(announcement(state({ status: 'unavailable', track: null }), 'status', messages)).toBe('Cannot play.');
    expect(announcement(state({ status: 'idle' }), 'status', messages)).toBeNull();
    expect(announcement(state({ status: 'playing' }), 'time', messages)).toBeNull();
    expect(announcement(state({ track: null, status: 'paused' }), 'status', messages)).toBe('Paused: ');
  });
});

describe('withApiAudio', () => {
  const tracks = [track('MT.20.1-16/context'), track('MT.20.1-16/note/a'), { ...track('MT.20.1-16/note/b') }];

  it('takes each segment’s file from the day document by id and locale', () => {
    const document = {
      masses: [
        {
          segments: [
            { id: 'MT.20.1-16/context', locale: 'en', audio: { url: 'https://audio.test/c.mp3', durationSeconds: 61 } },
            { id: 'MT.20.1-16/note/a', locale: 'sw', audio: { url: 'https://audio.test/sw.mp3' } },
            { id: 'MT.20.1-16/note/b', locale: 'en', audio: null },
          ],
        },
        {
          segments: [
            { id: 'MT.20.1-16/context', locale: 'en', audio: { url: 'https://audio.test/other.mp3' } },
            { id: 'MT.20.1-16/note/a', locale: 'en', audio: { url: '/lectio/audio/a.mp3', durationSeconds: 0 } },
          ],
        },
      ],
    };
    const result = withApiAudio(tracks, document);
    expect(result.map((item) => item.audio)).toEqual([
      { url: 'https://audio.test/c.mp3', durationSeconds: 61 },
      { url: '/lectio/audio/a.mp3', durationSeconds: null },
      null,
    ]);
    expect(result[2]).toBe(tracks[2]);
  });

  it('ignores documents without segments and entries that are not usable files', () => {
    for (const document of [null, 'x', {}, { masses: 'x' }, { masses: [null, { segments: {} }] }])
      expect(withApiAudio(tracks, document)).toEqual(tracks);
    const odd = {
      masses: [
        {
          segments: [
            null,
            { id: 1, locale: 'en' },
            { id: 'MT.20.1-16/context', locale: 1 },
            { id: 'MT.20.1-16/context', locale: 'en', audio: { url: 'javascript:alert(1)' } },
            { id: 'MT.20.1-16/context', locale: 'en', audio: { url: 3 } },
            { id: 'MT.20.1-16/context', locale: 'en', audio: [] },
            { id: 'MT.20.1-16/note/a', locale: 'en', audio: { url: 'http://a.test/x', durationSeconds: 'long' } },
          ],
        },
      ],
    };
    expect(withApiAudio(tracks, odd).map((item) => item.audio)).toEqual([
      null,
      { url: 'http://a.test/x', durationSeconds: null },
      null,
    ]);
  });
});
