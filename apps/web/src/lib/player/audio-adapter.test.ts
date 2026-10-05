import { describe, expect, it, vi } from 'vitest';

import { createAudioAdapter } from './audio-adapter.ts';
import { FakeAudio, flush, track } from './fixtures/fakes.ts';
import type { AdapterEvents, Track } from './queue.ts';

function events() {
  return {
    time: vi.fn<AdapterEvents['time']>(),
    playing: vi.fn(),
    paused: vi.fn(),
    ended: vi.fn(),
    error: vi.fn(),
  } satisfies AdapterEvents;
}

const withFile: Track = { ...track('a'), audio: { url: 'https://audio.test/a.mp3', durationSeconds: 30 } };

function setup(resolve?: (url: string) => Promise<string>) {
  const element = new FakeAudio();
  const adapter = createAudioAdapter(element, resolve);
  if (adapter === null) throw new Error('no adapter');
  return { element, adapter, on: events() };
}

describe('createAudioAdapter', () => {
  it('is absent without an element, and plays only tracks with a file', () => {
    expect(createAudioAdapter(null)).toBeNull();
    const { adapter } = setup();
    expect(adapter.kind).toBe('audio');
    expect(adapter.supports(withFile)).toBe(true);
    expect(adapter.supports(track('a'))).toBe(false);
    expect(adapter.supports({ ...track('a'), audio: { url: '' } })).toBe(false);
  });

  it('loads the resolved source at the queue speed, keeping pitch, and plays it once ready', async () => {
    const { element, adapter, on } = setup((url) => Promise.resolve(`blob:${url}`));
    adapter.load(withFile, { rate: 1.5, position: 0 }, on);
    adapter.play();
    expect(element.calls).toEqual([]);
    await flush();
    expect(element).toMatchObject({
      src: 'blob:https://audio.test/a.mp3',
      playbackRate: 1.5,
      defaultPlaybackRate: 1.5,
      preservesPitch: true,
    });
    expect(element.calls).toEqual(['load blob:https://audio.test/a.mp3', 'play blob:https://audio.test/a.mp3']);
  });

  it('reports time, play, pause, end and errors from the element', async () => {
    const { element, adapter, on } = setup();
    adapter.load(withFile, { rate: 1, position: 0 }, on);
    await flush();
    element.currentTime = 4;
    element.fire('timeupdate');
    expect(on.time).toHaveBeenLastCalledWith(4, 30);
    element.duration = 31.5;
    element.fire('timeupdate');
    expect(on.time).toHaveBeenLastCalledWith(4, 31.5);
    element.duration = Number.POSITIVE_INFINITY;
    element.fire('timeupdate');
    expect(on.time).toHaveBeenLastCalledWith(4, 30);
    for (const type of ['play', 'pause', 'ended', 'error']) element.fire(type);
    expect([on.playing, on.paused, on.ended, on.error].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it('applies the start position once the metadata is in, and seeks directly after that', async () => {
    const { element, adapter, on } = setup();
    adapter.load({ ...withFile, audio: { url: 'x' } }, { rate: 1, position: 12 }, on);
    await flush();
    adapter.seek(14);
    expect(element.currentTime).toBe(0);
    element.fire('loadedmetadata');
    expect(element.currentTime).toBe(14);
    expect(on.time).toHaveBeenLastCalledWith(14, null);
    element.readyState = 1;
    adapter.seek(3);
    expect(element.currentTime).toBe(3);
    element.fire('loadedmetadata');
    expect(element.currentTime).toBe(3);
  });

  it('changes the rate on the element', () => {
    const { element, adapter } = setup();
    adapter.setRate(0.75);
    expect(element).toMatchObject({ playbackRate: 0.75, defaultPlaybackRate: 0.75 });
  });

  it('reports a refused play as a pause, ignores an aborted one, and reports other failures as errors', async () => {
    const { element, adapter, on } = setup();
    adapter.load(withFile, { rate: 1, position: 0 }, on);
    element.playResult = () => Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
    adapter.play();
    await flush();
    expect(on.paused).toHaveBeenCalledOnce();
    element.playResult = () => Promise.reject(Object.assign(new Error('replaced'), { name: 'AbortError' }));
    adapter.play();
    await flush();
    element.playResult = () => Promise.reject(new Error('decode'));
    adapter.play();
    await flush();
    element.playResult = () => Promise.reject(null);
    adapter.play();
    await flush();
    expect(on.paused).toHaveBeenCalledOnce();
    expect(on.error).toHaveBeenCalledTimes(2);
  });

  it('reports an error when the source cannot be resolved', async () => {
    const { element, adapter, on } = setup(() => Promise.reject(new Error('cache')));
    adapter.load(withFile, { rate: 1, position: 0 }, on);
    adapter.play();
    await flush();
    expect(on.error).toHaveBeenCalledOnce();
    expect(element.calls).toEqual([]);
  });

  it('drops a load, a play and a failure that a newer track or stop overtook', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    const pending = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const { element, adapter, on } = setup((url) => (url === 'slow' ? pending : Promise.resolve(url)));
    adapter.load({ ...withFile, audio: { url: 'slow' } }, { rate: 1, position: 0 }, on);
    adapter.play();
    adapter.load(withFile, { rate: 1, position: 0 }, on);
    fail(new Error('late'));
    await flush();
    expect(on.error).not.toHaveBeenCalled();
    expect(element.src).toBe('https://audio.test/a.mp3');

    let finish: (value: string) => void = () => undefined;
    const later = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const second = setup(() => later);
    second.adapter.load(withFile, { rate: 1, position: 0 }, second.on);
    second.adapter.play();
    second.adapter.stop();
    finish('late-src');
    await flush();
    expect(second.element.src).toBe('');

    const third = setup();
    third.adapter.load(withFile, { rate: 1, position: 0 }, third.on);
    await flush();
    third.element.playResult = () => Promise.reject(new Error('decode'));
    third.adapter.play();
    third.adapter.stop();
    await flush();
    let refuse: (reason: unknown) => void = () => undefined;
    third.adapter.load(withFile, { rate: 1, position: 0 }, third.on);
    await flush();
    third.element.playResult = () =>
      new Promise<void>((_resolve, reject) => {
        refuse = reject;
      });
    third.adapter.play();
    await flush();
    third.adapter.stop();
    refuse(new Error('decode'));
    await flush();
    expect(third.on.error).not.toHaveBeenCalled();
  });

  it('stops: pauses, empties the element and stops listening', async () => {
    const { element, adapter, on } = setup();
    adapter.load(withFile, { rate: 1, position: 0 }, on);
    await flush();
    expect(element.listenerCount()).toBe(6);
    adapter.pause();
    adapter.stop();
    expect(element.calls.slice(-3)).toEqual(['pause', 'pause', 'load ']);
    expect(element.src).toBe('');
    expect(element.listenerCount()).toBe(0);
    element.fire('ended');
    expect(on.ended).not.toHaveBeenCalled();
  });
});
