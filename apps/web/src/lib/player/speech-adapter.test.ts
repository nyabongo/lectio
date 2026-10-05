import { describe, expect, it, vi } from 'vitest';

import { FakeSynth, FakeUtterance, track } from './fixtures/fakes.ts';
import { SPEECH_CHARS_PER_SECOND } from './queue.ts';
import type { AdapterEvents, Track } from './queue.ts';
import { CHUNK_LENGTH, browserSpeech, chunkScript, createSpeechAdapter, wordStart } from './speech-adapter.ts';

const CPS = SPEECH_CHARS_PER_SECOND;

function events() {
  return {
    time: vi.fn<AdapterEvents['time']>(),
    playing: vi.fn(),
    paused: vi.fn(),
    ended: vi.fn(),
    error: vi.fn(),
  } satisfies AdapterEvents;
}

function setup(script = 'First sentence here. Second one follows.') {
  const synth = new FakeSynth();
  const adapter = createSpeechAdapter({ synth, utterance: (text) => new FakeUtterance(text) });
  if (adapter === null) throw new Error('no adapter');
  const on = events();
  const item: Track = { ...track('a', null, script), locale: 'en' };
  return { synth, adapter, on, item };
}

describe('chunkScript', () => {
  it('cuts at sentence ends into chunks that join back into the script', () => {
    const script = `${'A short sentence. '.repeat(20)}The end!`;
    const chunks = chunkScript(script);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(script);
    expect(chunks.every((chunk) => chunk.text.length <= CHUNK_LENGTH)).toBe(true);
    for (const chunk of chunks) expect(script.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
  });

  it('keeps a long sentence whole, closing quotes with their sentence, and nothing for an empty script', () => {
    const long = `${'word '.repeat(60)}end.`;
    expect(chunkScript(`${long} Next.`, 50).map((chunk) => chunk.text)).toEqual([`${long} `, 'Next.']);
    expect(chunkScript('He said “stop.” Then left.', 10).map((chunk) => chunk.text)).toEqual([
      'He said “stop.” ',
      'Then left.',
    ]);
    expect(chunkScript('')).toEqual([]);
  });
});

describe('wordStart', () => {
  it('moves back to the start of the word, within the script', () => {
    expect(wordStart('hello world', 8)).toBe(6);
    expect(wordStart('hello world', 6)).toBe(6);
    expect(wordStart('hello world', -4)).toBe(0);
    expect(wordStart('hello world', 99)).toBe(6);
  });
});

describe('createSpeechAdapter', () => {
  it('is absent without speech synthesis, and reads only tracks with a script', () => {
    expect(createSpeechAdapter(null)).toBeNull();
    const { adapter } = setup();
    expect(adapter.kind).toBe('speech');
    expect(adapter.supports(track('a', null, 'Words.'))).toBe(true);
    expect(adapter.supports(track('a', null, '  '))).toBe(false);
  });

  it('reads each chunk in turn in the segment’s language and voice, at the queue speed', () => {
    const script = `${'One sentence of the script. '.repeat(10)}Last.`;
    const { synth, adapter, on, item } = setup(script);
    adapter.load(item, { rate: 1.5, position: 0 }, on);
    expect(on.time).toHaveBeenLastCalledWith(0, script.length / CPS);
    adapter.play();
    expect(on.playing).toHaveBeenCalledOnce();
    const first = synth.last() as FakeUtterance;
    expect(first).toMatchObject({ lang: 'en-GB', rate: 1.5, voice: { name: 'Daniel', lang: 'en-GB' } });
    first.onboundary?.({ charIndex: 10 });
    expect(on.time).toHaveBeenLastCalledWith(10 / CPS, script.length / CPS);
    first.onend?.({});
    expect(synth.spoken).toHaveLength(2);
    let guard = 0;
    while (on.ended.mock.calls.length === 0 && guard++ < 10) synth.last()?.onend?.({});
    expect(synth.spoken.map((utterance) => utterance.text).join('')).toBe(script);
    expect(on.ended).toHaveBeenCalledOnce();
    expect(on.time).toHaveBeenLastCalledWith(script.length / CPS, script.length / CPS);
  });

  it('reads Kiswahili with a Kiswahili voice, and leaves the voice to the engine when there is none', () => {
    const { synth, adapter, on } = setup();
    adapter.load({ ...track('a', null, 'Habari.'), locale: 'sw' }, { rate: 1, position: 0 }, on);
    adapter.play();
    expect(synth.last()).toMatchObject({ lang: 'sw-KE', voice: { name: 'Zuri' } });
    synth.voices = [];
    adapter.pause();
    adapter.play();
    expect(synth.last()).toMatchObject({ lang: 'sw-KE', voice: null });
  });

  it('starts at a resume point, at the start of its word', () => {
    const { synth, adapter, on, item } = setup('First sentence here. Second one follows.');
    adapter.load(item, { rate: 1, position: 8 / CPS }, on);
    adapter.play();
    expect(synth.last()?.text).toBe('sentence here. Second one follows.');
  });

  it('pauses by cancelling, ignores the cancelled utterance, and resumes from the last word', () => {
    const { synth, adapter, on, item } = setup();
    adapter.load(item, { rate: 1, position: 0 }, on);
    adapter.play();
    const first = synth.last() as FakeUtterance;
    first.onboundary?.({ charIndex: 8 });
    adapter.pause();
    expect(synth.cancels).toBe(1);
    expect(on.error).not.toHaveBeenCalled();
    first.onend?.({});
    first.onboundary?.({ charIndex: 30 });
    expect(synth.spoken).toHaveLength(1);
    adapter.pause();
    expect(synth.cancels).toBe(1);
    adapter.play();
    expect(synth.last()?.text).toBe('sentence here. Second one follows.');
  });

  it('restarts at the new point on seek while reading, and only moves the point while paused', () => {
    const { synth, adapter, on, item } = setup();
    adapter.seek(1);
    adapter.load(item, { rate: 1, position: 0 }, on);
    adapter.seek(25 / CPS);
    expect(synth.spoken).toHaveLength(0);
    expect(on.time).toHaveBeenLastCalledWith(21 / CPS, item.script.length / CPS);
    adapter.play();
    expect(synth.last()?.text).toBe('Second one follows.');
    adapter.seek(0);
    expect(synth.cancels).toBe(1);
    expect(synth.last()?.text).toBe('First sentence here. Second one follows.');
  });

  it('restarts at the new rate while reading, and keeps it for later', () => {
    const { synth, adapter, on, item } = setup();
    adapter.load(item, { rate: 1, position: 0 }, on);
    adapter.setRate(1.25);
    expect(synth.spoken).toHaveLength(0);
    adapter.play();
    expect(synth.last()?.rate).toBe(1.25);
    adapter.setRate(2);
    expect(synth.spoken).toHaveLength(2);
    expect(synth.last()?.rate).toBe(2);
  });

  it('reports a real error once, and none after stop', () => {
    const { synth, adapter, on, item } = setup();
    adapter.load(item, { rate: 1, position: 0 }, on);
    adapter.play();
    synth.last()?.onerror?.({ error: 'canceled' });
    expect(on.error).not.toHaveBeenCalled();
    synth.last()?.onerror?.({});
    expect(on.error).toHaveBeenCalledOnce();
    synth.last()?.onerror?.({ error: 'synthesis-failed' });
    expect(on.error).toHaveBeenCalledOnce();

    adapter.play();
    const utterance = synth.last() as FakeUtterance;
    adapter.stop();
    utterance.onerror?.({ error: 'synthesis-failed' });
    utterance.onend?.({});
    expect(on.error).toHaveBeenCalledOnce();
    adapter.play();
    expect(synth.last()).toBe(utterance);
  });
});

describe('browserSpeech', () => {
  it('wraps the browser API, or gives null without it', () => {
    const synth = new FakeSynth();
    const env = browserSpeech({ speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
    expect(env?.synth).toBe(synth);
    expect(env?.utterance('Hi')).toBeInstanceOf(FakeUtterance);
    expect(browserSpeech({ speechSynthesis: synth })).toBeNull();
    expect(browserSpeech({})).toBeNull();
  });
});
