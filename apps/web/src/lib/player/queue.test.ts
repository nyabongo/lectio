import { describe, expect, it } from 'vitest';

import { FakeAdapter, track } from './fixtures/fakes.ts';
import { RESTART_THRESHOLD, clampSpeed, createPlayer, speechDuration, SPEECH_CHARS_PER_SECOND } from './queue.ts';
import type { ChangeReason, PlayerOptions, PlayerState, Track } from './queue.ts';

const tracks: Track[] = [track('a', 'https://audio.test/a.mp3'), track('b'), track('c', 'https://audio.test/c.mp3')];

function setup(options: Partial<PlayerOptions> = {}) {
  const audio = new FakeAdapter('audio');
  const speech = new FakeAdapter('speech');
  const changes: { state: PlayerState; reason: ChangeReason }[] = [];
  const player = createPlayer({
    tracks,
    audio,
    speech,
    onChange: (state, reason) => changes.push({ state, reason }),
    ...options,
  });
  const reasons = () => changes.map((change) => change.reason);
  return { audio, speech, player, changes, reasons };
}

describe('clampSpeed and speechDuration', () => {
  it('keeps speeds between 0.75× and 2×, and 1× for nonsense', () => {
    expect(clampSpeed(0.5)).toBe(0.75);
    expect(clampSpeed(1.25)).toBe(1.25);
    expect(clampSpeed(3)).toBe(2);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });

  it('estimates how long device speech reads a script', () => {
    expect(speechDuration('x'.repeat(SPEECH_CHARS_PER_SECOND * 4))).toBe(4);
  });
});

describe('createPlayer', () => {
  it('starts idle on the first track, loading nothing until play', () => {
    const { player, audio, speech } = setup();
    expect(player.state).toEqual({
      index: 0,
      track: tracks[0],
      status: 'idle',
      position: 0,
      duration: null,
      speed: 1,
      source: null,
      fallback: false,
    });
    expect(audio.calls).toEqual([]);
    expect(speech.calls).toEqual([]);
  });

  it('plays a track with a file through the audio adapter, at the queue speed', () => {
    const { player, audio, speech, reasons } = setup({ speed: 1.5 });
    player.play();
    expect(audio.calls).toEqual(['load a @0 x1.5', 'play']);
    expect(speech.calls).toEqual([]);
    expect(player.state).toMatchObject({ status: 'playing', source: 'audio', speed: 1.5 });
    expect(reasons()).toEqual(['track', 'status']);
  });

  it('plays a track without a file with device speech, and advances when a track ends', () => {
    const { player, audio, speech } = setup();
    player.play();
    audio.events?.time(4, 10);
    expect(player.state).toMatchObject({ position: 4, duration: 10 });
    audio.events?.ended();
    expect(audio.calls.at(-1)).toBe('stop');
    expect(speech.calls).toEqual(['load b @0 x1', 'play']);
    expect(player.state).toMatchObject({ index: 1, status: 'playing', source: 'speech', position: 0, duration: null });
    speech.events?.ended();
    expect(player.state).toMatchObject({ index: 2, source: 'audio' });
  });

  it('takes the length from the file’s metadata, else from the API, while playing audio', () => {
    const { player, audio } = setup({ tracks: [{ ...tracks[0], audio: { url: 'x', durationSeconds: 42 } } as Track] });
    player.play();
    expect(player.state.duration).toBe(42);
    audio.events?.time(3, null);
    expect(player.state).toMatchObject({ position: 3, duration: 42 });
    audio.events?.time(-1, 40);
    expect(player.state).toMatchObject({ position: 0, duration: 40 });
    const plain = setup();
    plain.player.play();
    plain.audio.events?.time(1, null);
    expect(plain.player.state).toMatchObject({ position: 1, duration: null });
  });

  it('keeps an unknown length unknown for device speech, and the point reached when it finishes', () => {
    const { player, speech } = setup({ tracks: [track('a')] });
    player.play();
    speech.events?.time(3, null);
    expect(player.state).toMatchObject({ position: 3, duration: null });
    speech.events?.ended();
    expect(player.state).toMatchObject({ status: 'finished', position: 3 });
  });

  it('finishes after the last track and starts again from the top on play', () => {
    const { player, audio, speech } = setup({ start: { index: 2, position: 0 } });
    player.play();
    audio.events?.time(9, 9);
    audio.events?.ended();
    expect(player.state).toMatchObject({ index: 2, status: 'finished', position: 9, source: null });
    player.play();
    expect(player.state).toMatchObject({ index: 0, status: 'playing', position: 0 });
    expect(audio.calls.at(-2)).toBe('load a @0 x1');
    expect(speech.calls).toEqual([]);
  });

  it('pauses, resumes and toggles', () => {
    const { player, audio, reasons } = setup();
    player.pause();
    expect(player.state.status).toBe('idle');
    player.toggle();
    player.toggle();
    expect(player.state.status).toBe('paused');
    expect(audio.calls.at(-1)).toBe('pause');
    player.play();
    expect(audio.calls.at(-1)).toBe('play');
    player.play();
    expect(audio.calls.filter((call) => call === 'play')).toHaveLength(2);
    expect(reasons().slice(-3)).toEqual(['status', 'status', 'status']);
  });

  it('follows pauses and plays from outside (a headset button, a refused autoplay)', () => {
    const { player, audio } = setup();
    player.play();
    audio.events?.paused();
    expect(player.state.status).toBe('paused');
    audio.events?.paused();
    audio.events?.playing();
    expect(player.state.status).toBe('playing');
  });

  it('moves to the next and previous track, playing only when it was playing', () => {
    const { player, audio, speech } = setup();
    player.next();
    expect(player.state).toMatchObject({ index: 1, status: 'idle', source: 'speech' });
    expect(speech.calls).toEqual(['load b @0 x1']);
    player.play();
    player.next();
    expect(player.state).toMatchObject({ index: 2, status: 'playing' });
    player.next();
    expect(player.state.index).toBe(2);
    player.pause();
    player.previous();
    expect(player.state).toMatchObject({ index: 1, status: 'paused' });
    expect(audio.calls).toContain('stop');
  });

  it('restarts the current track on previous once it is past the threshold, and at the first track', () => {
    const { player, audio } = setup();
    player.play();
    audio.events?.time(RESTART_THRESHOLD + 1, 30);
    player.previous();
    expect(audio.calls.at(-1)).toBe('seek 0');
    expect(player.state).toMatchObject({ index: 0, position: 0 });
    player.previous();
    expect(player.state.index).toBe(0);
  });

  it('goes back to the start of the last track after finishing', () => {
    const { player, audio } = setup({ start: { index: 2, position: 0 } });
    player.play();
    audio.events?.time(20, 20);
    audio.events?.ended();
    player.previous();
    expect(player.state).toMatchObject({ index: 2, status: 'paused', position: 0, source: 'audio' });
  });

  it('plays a chosen track from its start', () => {
    const { player, speech } = setup();
    player.select(1);
    expect(speech.calls).toEqual(['load b @0 x1', 'play']);
    expect(player.state).toMatchObject({ index: 1, status: 'playing' });
    player.select(10);
    expect(player.state.index).toBe(2);
  });

  it('seeks within the track, clamped to its length, and by a delta', () => {
    const { player, audio } = setup();
    player.seek(5);
    expect(player.state.position).toBe(5);
    player.play();
    expect(audio.calls[0]).toBe('load a @5 x1');
    audio.events?.time(5, 20);
    player.seek(50);
    expect(audio.calls.at(-1)).toBe('seek 20');
    player.seekBy(-30);
    expect(audio.calls.at(-1)).toBe('seek 0');
    player.seekBy(10);
    expect(player.state.position).toBe(10);
  });

  it('changes speed on the adapter and reports it once', () => {
    const { player, audio, reasons } = setup();
    player.setSpeed(1.25);
    player.play();
    expect(audio.calls[0]).toBe('load a @0 x1.25');
    player.setSpeed(9);
    player.setSpeed(2);
    expect(audio.calls.at(-1)).toBe('rate 2');
    expect(reasons().filter((reason) => reason === 'speed')).toHaveLength(2);
  });

  it('falls back from a missing file to device speech at the same point of the segment', () => {
    const script = 'x'.repeat(SPEECH_CHARS_PER_SECOND * 20);
    const { player, audio, speech } = setup({ tracks: [track('a', 'https://audio.test/a.mp3', script), track('b')] });
    player.play();
    audio.events?.time(5, 10);
    audio.events?.error();
    expect(speech.calls).toEqual(['load a @10 x1', 'play']);
    expect(player.state).toMatchObject({ index: 0, status: 'playing', source: 'speech', fallback: true });
    speech.events?.ended();
    expect(player.state).toMatchObject({ index: 1, fallback: false });
  });

  it('falls back from the start when the file fails before its length is known, without starting', () => {
    const { player, audio, speech } = setup();
    player.next();
    player.previous();
    audio.events?.error();
    expect(speech.calls.at(-1)).toBe('load a @0 x1');
    expect(player.state).toMatchObject({ status: 'idle', source: 'speech', fallback: true });
  });

  it('skips a track device speech cannot read either, and ends the queue when none can be played', () => {
    const { player, audio, speech } = setup();
    player.play();
    audio.events?.error();
    speech.events?.error();
    expect(player.state).toMatchObject({ index: 1, status: 'playing', source: 'speech' });
    speech.events?.error();
    expect(player.state).toMatchObject({ index: 2, source: 'audio' });
    audio.events?.error();
    speech.events?.error();
    expect(player.state.status).toBe('unavailable');
    player.play();
    expect(player.state.status).toBe('unavailable');
  });

  it('skips to the next track when the last playable one fails while paused, without playing', () => {
    const { player, speech } = setup({ tracks: [track('a'), track('b')] });
    player.play();
    speech.events?.playing();
    player.pause();
    speech.events?.error();
    expect(player.state).toMatchObject({ index: 0, status: 'paused', source: null });
  });

  it('finishes when the last track fails while playing', () => {
    const { player, speech } = setup({ tracks: [track('a'), track('b')], start: { index: 1, position: 0 } });
    player.play();
    speech.events?.error();
    expect(player.state.status).toBe('finished');
  });

  it('skips tracks no adapter supports, and is unavailable without any adapter', () => {
    const speech = new FakeAdapter('speech', (candidate) => candidate.id !== 'a');
    const player = createPlayer({ tracks: [track('a'), track('b')], audio: null, speech });
    player.play();
    expect(player.state).toMatchObject({ index: 1, status: 'playing' });

    const none = createPlayer({ tracks: [track('a'), track('b')], audio: null, speech: null });
    expect(none.state.status).toBe('unavailable');
    none.play();
    expect(none.state).toMatchObject({ status: 'unavailable', source: null });
  });

  it('skips an unplayable track it was moved to, and becomes playable once a file is found', () => {
    const audio = new FakeAdapter('audio');
    const player = createPlayer({ tracks: [track('a', 'https://audio.test/a.mp3'), track('b')], audio, speech: null });
    player.next();
    expect(player.state).toMatchObject({ index: 1, status: 'paused', source: null });
    player.play();
    expect(player.state.status).toBe('finished');

    const later = createPlayer({ tracks: [track('a')], audio, speech: null });
    expect(later.state.status).toBe('unavailable');
    later.replaceTracks([track('a', 'https://audio.test/a.mp3')]);
    expect(later.state.status).toBe('idle');
    later.play();
    expect(later.state).toMatchObject({ status: 'playing', source: 'audio' });
  });

  it('ignores events from an adapter it has moved on from', () => {
    const { player, audio, speech } = setup();
    player.play();
    const stale = audio.events;
    player.next();
    stale?.time(99, 99);
    stale?.ended();
    stale?.error();
    stale?.playing();
    stale?.paused();
    expect(player.state).toMatchObject({ index: 1, position: 0, status: 'playing' });
    expect(speech.calls).toEqual(['load b @0 x1', 'play']);
  });

  it('starts from a resume point, clamped to the queue', () => {
    expect(setup({ start: { index: 1, position: 12 } }).player.state).toMatchObject({ index: 1, position: 12 });
    expect(setup({ start: { index: 7, position: -3 } }).player.state).toMatchObject({ index: 2, position: 0 });
  });

  it('swaps in tracks with files found later, for the next load only', () => {
    const { player, audio, speech } = setup({ tracks: [track('a'), track('b')] });
    player.play();
    expect(player.replaceTracks([track('a', 'https://audio.test/a.mp3')])).toBe(false);
    expect(player.replaceTracks([track('a'), track('x')])).toBe(false);
    expect(player.replaceTracks([track('a', 'https://audio.test/a.mp3'), track('b', 'https://audio.test/b.mp3')])).toBe(
      true,
    );
    expect(player.state.source).toBe('speech');
    speech.events?.ended();
    expect(audio.calls).toEqual(['load b @0 x1', 'play']);
  });

  it('does nothing with an empty queue', () => {
    const player = createPlayer({ tracks: [], audio: new FakeAdapter('audio'), speech: new FakeAdapter('speech') });
    expect(player.state).toMatchObject({ status: 'unavailable', track: null });
    player.play();
    player.next();
    player.previous();
    player.seek(3);
    player.select(0);
    expect(player.state).toMatchObject({ status: 'unavailable', position: 0 });
  });

  it('stops the adapter for good on destroy', () => {
    const { player, audio } = setup();
    player.play();
    const events = audio.events;
    player.destroy();
    events?.ended();
    expect(audio.calls.at(-1)).toBe('stop');
    expect(player.state).toMatchObject({ index: 0, source: null });
  });
});
