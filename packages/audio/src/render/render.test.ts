import { describe, expect, it, vi } from 'vitest';

import { FakeClock, FakeTtsProvider, MemoryObjectStorage, ProviderError, wav } from '@lectio/providers';
import type { TtsProvider, TtsRequest, TtsResult } from '@lectio/providers';

import type { NarrationSegment } from '../script/segments.ts';
import { MANIFEST_KEY, emptyManifest, readManifest } from './manifest.ts';
import type { AudioManifest } from './manifest.ts';
import { planRender } from './plan.ts';
import type { RenderPlan } from './plan.ts';
import { AUDIO_CACHE_CONTROL, CharacterBudgetError, render, wavDurationMs } from './render.ts';

function segment(id: string, text: string): NarrationSegment {
  return { id, kind: 'translation-note', slot: 'gospel', title: id, text, locale: 'en', passageKey: 'MT.20.1-16' };
}

const VOICES = { en: 'en-KE-AsiliaNeural' };
const SEGMENTS = [segment('a', 'The evil eye.'), segment('b', 'Good, not generous.'), segment('c', 'A denarius.')];

const planFor = (segments: readonly NarrationSegment[], manifest: AudioManifest = emptyManifest()): RenderPlan =>
  planRender(segments, manifest, { voices: VOICES, ttsVersion: 'fake-1', format: 'wav' });

const noSleep = (): Promise<void> => Promise.resolve();

/** A TTS double that fails scripted attempts per text, then delegates to the fake. */
class FlakyTts implements TtsProvider {
  readonly formats = ['wav'] as const;
  readonly fake = new FakeTtsProvider();
  readonly calls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;

  readonly failures: Record<string, unknown[]>;

  constructor(failures: Record<string, unknown[]> = {}) {
    this.failures = failures;
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    this.calls.push(request.text);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await Promise.resolve();
    this.inFlight--;
    const failure = this.failures[request.text]?.shift();
    if (failure !== undefined) throw failure;
    return this.fake.synthesize(request);
  }
}

describe('render', () => {
  it('synthesizes, stores and records every planned file, then writes the manifest', async () => {
    const storage = new MemoryObjectStorage();
    const tts = new FakeTtsProvider();
    const clock = new FakeClock({ start: '2026-10-05T06:00:00.000Z' });
    const plan = planFor(SEGMENTS);
    const result = await render(plan, tts, storage, {
      manifest: emptyManifest(),
      clock,
      publicBaseUrl: 'https://cdn.example/',
    });

    expect(result.rendered).toEqual(plan.items.map((item) => item.key).sort());
    expect(result.adopted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.characters).toBe(plan.characters);
    expect(tts.requests.map((r) => [r.voice, r.format])).toEqual(SEGMENTS.map(() => ['en-KE-AsiliaNeural', 'wav']));

    const [first] = plan.items;
    const stored = await storage.get(first?.key as string);
    expect(stored?.info).toMatchObject({ contentType: 'audio/wav', cacheControl: AUDIO_CACHE_CONTROL });
    expect(result.manifest.entries[first?.key as string]).toEqual({
      url: `https://cdn.example/${first?.key as string}`,
      bytes: stored?.body.length,
      durationMs: (first?.characters as number) * 50,
      voice: 'en-KE-AsiliaNeural',
      ttsVersion: 'fake-1',
      format: 'wav',
      createdAt: '2026-10-05T06:00:00.000Z',
      contentType: 'audio/wav',
      characters: first?.characters,
    });
    expect(await readManifest(storage)).toEqual(result.manifest);
  });

  it('renders nothing on a second run and one file when one note changes', async () => {
    const storage = new MemoryObjectStorage();
    const tts = new FakeTtsProvider();
    const first = await render(planFor(SEGMENTS), tts, storage, { manifest: emptyManifest() });
    expect(first.rendered).toHaveLength(3);
    const manifestBytes = (await storage.get(MANIFEST_KEY))?.body;

    const manifest = await readManifest(storage);
    const again = planFor(SEGMENTS, manifest);
    expect(again.items).toEqual([]);
    const second = await render(again, tts, storage, { manifest });
    expect(second.rendered).toEqual([]);
    expect(tts.requests).toHaveLength(3);
    expect((await storage.get(MANIFEST_KEY))?.body).toEqual(manifestBytes);

    const edited = [SEGMENTS[0], segment('b', 'Good, not merely generous.'), SEGMENTS[2]] as NarrationSegment[];
    const changed = planFor(edited, manifest);
    expect(changed.items.map((item) => item.segmentIds)).toEqual([['b']]);
    const third = await render(changed, tts, storage, { manifest });
    expect(third.rendered).toEqual([changed.items[0]?.key]);
    expect(tts.requests).toHaveLength(4);
    expect(Object.keys((await readManifest(storage)).entries)).toHaveLength(4);
  });

  it('adopts files already in storage instead of synthesizing them again', async () => {
    const storage = new MemoryObjectStorage();
    const plan = planFor(SEGMENTS.slice(0, 2));
    const [wavItem, mp3Item] = plan.items as [RenderPlan['items'][0], RenderPlan['items'][0]];
    const audio = wav(new Uint8Array(500), 1000);
    await storage.put(wavItem.key, audio, { contentType: 'audio/wav' });
    await storage.put(mp3Item.key, new Uint8Array([0xff, 0xfb]), { contentType: 'audio/mpeg' });
    const tts = new FakeTtsProvider();
    const get = vi.spyOn(storage, 'get');
    const result = await render(plan, tts, storage, { manifest: emptyManifest() });
    expect(tts.requests).toEqual([]);
    expect(get.mock.calls).toEqual([[wavItem.key]]);
    expect(result.adopted).toEqual([wavItem.key, mp3Item.key].sort());
    expect(result.manifest.entries[wavItem.key]).toMatchObject({
      bytes: audio.length,
      durationMs: 500,
      characters: wavItem.characters,
      ttsVersion: 'fake-1',
      format: 'wav',
    });
    expect(result.manifest.entries[mp3Item.key]).toMatchObject({
      bytes: 2,
      durationMs: null,
      contentType: 'audio/mpeg',
    });
    expect(result.manifest.entries[wavItem.key]?.url).toBe(wavItem.key);
  });

  it('retries retryable provider errors with doubling delays', async () => {
    const text = SEGMENTS[0]?.text as string;
    const tts = new FlakyTts({
      [text]: [new ProviderError('rate-limited', 'slow down'), new ProviderError('unavailable', 'down')],
    });
    const sleep = vi.fn(noSleep);
    const result = await render(planFor(SEGMENTS.slice(0, 1)), tts, new MemoryObjectStorage(), {
      manifest: emptyManifest(),
      retryDelayMs: 100,
      sleep,
    });
    expect(result.rendered).toHaveLength(1);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
    expect(tts.calls).toEqual([text, text, text]);
  });

  it('records failures (non-retryable, retries exhausted, non-Error throws) and keeps the successes', async () => {
    const [a, b, c] = SEGMENTS.map((s) => s.text) as [string, string, string];
    const tts = new FlakyTts({
      [a]: [new ProviderError('invalid-request', 'bad')],
      [b]: [new ProviderError('timeout', 't1'), new ProviderError('timeout', 't2')],
      [c]: ['boom'],
    });
    const storage = new MemoryObjectStorage();
    const plan = planFor([...SEGMENTS, segment('d', 'Fine.')]);
    const result = await render(plan, tts, storage, { manifest: emptyManifest(), retries: 1, sleep: noSleep });
    expect(result.failed.map((f) => f.error.message).sort()).toEqual(['bad', 'boom', 't2']);
    expect(tts.calls.filter((t) => t === a)).toHaveLength(1);
    expect(tts.calls.filter((t) => t === b)).toHaveLength(2);
    expect(result.rendered).toEqual([plan.items[3]?.key]);
    expect(Object.keys((await readManifest(storage)).entries)).toEqual([plan.items[3]?.key]);
  });

  it('retries a failed upload without synthesizing (and billing) the text again', async () => {
    const storage = new MemoryObjectStorage();
    const put = storage.put.bind(storage);
    let failures = 1;
    vi.spyOn(storage, 'put').mockImplementation((key, body, options) => {
      if (key !== MANIFEST_KEY && failures-- > 0) return Promise.reject(new ProviderError('unavailable', 'r2 down'));
      return put(key, body, options);
    });
    const tts = new FakeTtsProvider();
    const plan = planFor(SEGMENTS.slice(0, 1));
    const result = await render(plan, tts, storage, { manifest: emptyManifest(), sleep: noSleep });
    expect(result.rendered).toHaveLength(1);
    expect(tts.requests).toHaveLength(1);
    expect(result.characters).toBe(plan.characters);
  });

  it('records the characters billed for a file whose upload failed, so the month budget still counts them', async () => {
    const clock = new FakeClock({ start: '2026-10-05T06:00:00.000Z' });
    const storage = new MemoryObjectStorage();
    const put = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementation((key, body, options) =>
      key === MANIFEST_KEY ? put(key, body, options) : Promise.reject(new ProviderError('invalid-request', 'denied')),
    );
    const plan = planFor(SEGMENTS.slice(0, 2));
    const earlier: AudioManifest = { ...emptyManifest(), billedWithoutFile: { '2026-09': 5 } };
    const result = await render(plan, new FakeTtsProvider(), storage, { manifest: earlier, clock, sleep: noSleep });
    expect(result.failed).toHaveLength(2);
    expect(result.characters).toBe(plan.characters);
    const billed = { '2026-09': 5, '2026-10': plan.characters };
    expect(result.manifest.billedWithoutFile).toEqual(billed);
    expect((await readManifest(storage)).billedWithoutFile).toEqual(billed);
  });

  it('drops the entry of a stale file it could not render again, and writes that down', async () => {
    const storage = new MemoryObjectStorage();
    const first = await render(planFor(SEGMENTS.slice(0, 2)), new FakeTtsProvider(), storage, {
      manifest: emptyManifest(),
    });
    const [lost, kept] = Object.keys(first.manifest.entries).sort() as [string, string];
    const plan = planRender(SEGMENTS.slice(0, 2), first.manifest, {
      voices: VOICES,
      ttsVersion: 'fake-1',
      format: 'wav',
      storedKeys: [kept],
    });
    expect(plan.stale).toEqual([lost]);
    const text = plan.items[0]?.text as string;
    const tts = new FlakyTts({ [text]: [new ProviderError('invalid-request', 'no')] });
    const fresh = new MemoryObjectStorage();
    const result = await render(plan, tts, fresh, { manifest: first.manifest });
    expect(result.failed.map((f) => f.key)).toEqual([lost]);
    expect(Object.keys(result.manifest.entries)).toEqual([kept]);
    expect(Object.keys((await readManifest(fresh)).entries)).toEqual([kept]);
  });

  it('does not write the manifest when nothing succeeded', async () => {
    const storage = new MemoryObjectStorage();
    const tts = new FlakyTts({ [SEGMENTS[0]?.text as string]: [new ProviderError('invalid-request', 'bad')] });
    const result = await render(planFor(SEGMENTS.slice(0, 1)), tts, storage, { manifest: emptyManifest() });
    expect(result.failed).toHaveLength(1);
    expect(await storage.head(MANIFEST_KEY)).toBeNull();
  });

  it('keeps at most `concurrency` syntheses in flight', async () => {
    const tts = new FlakyTts();
    const many = Array.from({ length: 9 }, (_, i) => segment(String(i), `Note number ${String(i)}.`));
    const result = await render(planFor(many), tts, new MemoryObjectStorage(), {
      manifest: emptyManifest(),
      concurrency: 2,
    });
    expect(result.rendered).toHaveLength(9);
    expect(tts.maxInFlight).toBe(2);
  });

  it('refuses a plan over the character budget before any call', async () => {
    const tts = new FakeTtsProvider();
    const plan = planFor(SEGMENTS);
    const run = render(plan, tts, new MemoryObjectStorage(), { manifest: emptyManifest(), maxCharacters: 10 });
    await expect(run).rejects.toThrow(CharacterBudgetError);
    await expect(run).rejects.toMatchObject({ characters: plan.characters, budget: 10 });
    expect(tts.requests).toEqual([]);
    const exact = await render(plan, tts, new MemoryObjectStorage(), {
      manifest: emptyManifest(),
      maxCharacters: plan.characters,
    });
    expect(exact.rendered).toHaveLength(3);
  });

  it('validates its options and the format', async () => {
    const storage = new MemoryObjectStorage();
    const tts = new FakeTtsProvider();
    const plan = planFor(SEGMENTS);
    const manifest = emptyManifest();
    await expect(render(plan, tts, storage, { manifest, concurrency: 0 })).rejects.toThrow('concurrency');
    await expect(render(plan, tts, storage, { manifest, retries: -1 })).rejects.toThrow('retries');
    await expect(render(plan, tts, storage, { manifest, retries: 0.5 })).rejects.toThrow('retries');
    const mp3Plan = planRender(SEGMENTS, manifest, { voices: VOICES, ttsVersion: 'fake-1', format: 'mp3' });
    await expect(render(mp3Plan, tts, storage, { manifest })).rejects.toThrow('cannot produce mp3');
  });

  it('waits with real timers by default', async () => {
    vi.useFakeTimers();
    try {
      const text = SEGMENTS[0]?.text as string;
      const tts = new FlakyTts({ [text]: [new ProviderError('timeout', 'slow')] });
      const run = render(planFor(SEGMENTS.slice(0, 1)), tts, new MemoryObjectStorage(), { manifest: emptyManifest() });
      await vi.advanceTimersByTimeAsync(1000);
      expect((await run).rendered).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('wavDurationMs', () => {
  it('reads PCM WAV headers and rejects anything else', () => {
    expect(wavDurationMs(wav(new Uint8Array(2000), 1000))).toBe(2000);
    expect(wavDurationMs(new Uint8Array(10))).toBeNull();
    expect(wavDurationMs(new Uint8Array(60))).toBeNull();
    const zeroRate = wav(new Uint8Array(10), 1000);
    new DataView(zeroRate.buffer).setUint32(28, 0, true);
    expect(wavDurationMs(zeroRate)).toBeNull();
    const offset = new Uint8Array(100);
    offset.set(wav(new Uint8Array(20), 1000), 10);
    expect(wavDurationMs(offset.subarray(10, 74))).toBe(20);
  });
});
