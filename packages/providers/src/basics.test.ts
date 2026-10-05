import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FAKE_EPOCH, FakeClock, systemClock } from './clock.ts';
import { BudgetExceededError, LlmOutputError, ProviderError } from './errors.ts';
import { seededRandom, sha256Hex, stableStringify } from './hash.ts';
import { FsObjectStorage, MemoryObjectStorage, assertValidKey } from './storage.ts';
import { FAKE_TTS_MS_PER_CHAR, FAKE_TTS_SAMPLE_RATE, FakeTtsProvider, wav } from './tts.ts';
import { FakeWebSearch, FixtureSourceFetcher, MemorySourceFetcher } from './web.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sources');

describe('hash helpers', () => {
  it('serialises with sorted keys and hashes stably', () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: undefined, e: null }] })).toBe('{"a":[{"d":1,"e":null}],"b":1}');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(sha256Hex('abc'));
  });

  it('derives the same pseudo-random sequence from the same seed', () => {
    const a = seededRandom('x');
    const b = seededRandom('x');
    const values = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(values);
    for (const value of values) expect(value >= 0 && value < 1).toBe(true);
    expect(seededRandom('y')()).not.toBe(values[0]);
  });
});

describe('errors', () => {
  it('marks transient failures as retryable', () => {
    expect(new ProviderError('rate-limited', 'slow down').retryable).toBe(true);
    expect(new ProviderError('timeout', 't').retryable).toBe(true);
    expect(new ProviderError('not-found', 'gone').retryable).toBe(false);
    expect(new ProviderError('not-found', 'gone', { retryable: true }).retryable).toBe(true);
    const cause = new Error('socket');
    expect(new ProviderError('unavailable', 'down', { cause }).cause).toBe(cause);
    expect(new ProviderError('conflict', 'c').name).toBe('ProviderError');
    expect(new LlmOutputError('bad', '{').name).toBe('LlmOutputError');
    expect(new BudgetExceededError('run', 1, 2)).toBeInstanceOf(Error);
  });
});

describe('FakeClock', () => {
  it('starts at the fake epoch and moves only when told', () => {
    const clock = new FakeClock();
    expect(clock.now().toISOString()).toBe(FAKE_EPOCH);
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z');
    clock.set('2026-02-01T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-02-01T00:00:00.000Z');
    clock.set(Date.parse('2026-03-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('steps after every read when asked to', () => {
    const clock = new FakeClock({ start: 0, stepMs: 10 });
    expect([clock.now().getTime(), clock.now().getTime()]).toEqual([0, 10]);
  });

  it('never runs backwards and rejects bad instants', () => {
    const clock = new FakeClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.set('2025-01-01T00:00:00Z')).toThrow(RangeError);
    expect(() => clock.set('nonsense')).toThrow(RangeError);
    expect(() => new FakeClock({ start: 'nonsense' })).toThrow(/invalid fake clock start/);
  });

  it('exposes the system clock', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(5000);
  });
});

describe('FakeWebSearch', () => {
  it('records queries and caps canned and generated results', async () => {
    const search = new FakeWebSearch({
      results: { q: [1, 2, 3].map((i) => ({ url: `https://example.org/${i}`, title: `${i}`, snippet: '' })) },
    });
    expect(await search.search({ query: 'q', maxResults: 2 })).toHaveLength(2);
    expect(await search.search({ query: 'other' })).toHaveLength(3);
    expect(await search.search({ query: 'other', maxResults: 1 })).toHaveLength(1);
    expect(search.queries.map((q) => q.query)).toEqual(['q', 'other', 'other']);
  });
});

describe('source fetchers', () => {
  it('serves in-memory pages with defaults and stamps them from the clock', async () => {
    const clock = new FakeClock({ start: '2026-10-05T00:00:00Z' });
    const fetcher = new MemorySourceFetcher({}, clock).set('https://example.org/a', {
      status: 500,
      text: 'error page',
      contentType: 'text/plain',
    });
    fetcher.set('https://example.org/b', {});
    expect(await fetcher.fetch('https://example.org/a')).toEqual({
      status: 500,
      text: 'error page',
      contentType: 'text/plain',
      retrievedAt: '2026-10-05T00:00:00.000Z',
      finalUrl: 'https://example.org/a',
      fromArchive: false,
    });
    expect(await fetcher.fetch('https://example.org/b')).toMatchObject({
      status: 200,
      text: '',
      contentType: 'text/html; charset=utf-8',
    });
    expect(fetcher.fetched).toEqual(['https://example.org/a', 'https://example.org/b']);
  });

  it('reports redirects and falls back to the archive only when the page fails', async () => {
    const fetcher = new MemorySourceFetcher({
      'https://example.org/old': { text: 'moved', finalUrl: 'https://example.org/new' },
      'https://example.org/down': { status: 503 },
      'https://archive.test/down': { text: 'archived copy' },
      'https://archive.test/gone': { status: 404 },
    });
    expect(await fetcher.fetch('https://example.org/old', { archivedUrl: 'https://archive.test/down' })).toMatchObject({
      text: 'moved',
      finalUrl: 'https://example.org/new',
      fromArchive: false,
    });
    expect(await fetcher.fetch('https://example.org/down', { archivedUrl: 'https://archive.test/down' })).toMatchObject(
      {
        status: 200,
        text: 'archived copy',
        finalUrl: 'https://archive.test/down',
        fromArchive: true,
      },
    );
    expect(await fetcher.fetch('https://example.org/down', { archivedUrl: 'https://archive.test/gone' })).toMatchObject(
      {
        status: 503,
        finalUrl: 'https://example.org/down',
        fromArchive: false,
      },
    );
    expect(await fetcher.fetch('https://example.org/none', { archivedUrl: 'https://archive.test/none' })).toMatchObject(
      {
        status: 404,
        fromArchive: false,
      },
    );
  });

  it('retries reading a fixture index that failed once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lectio-fixtures-'));
    try {
      const fetcher = new FixtureSourceFetcher(dir);
      await expect(fetcher.fetch('https://x.test/')).rejects.toMatchObject({ code: 'ENOENT' });
      writeFileSync(join(dir, 'index.json'), JSON.stringify({ 'https://x.test/': { text: 'now present' } }));
      expect(await fetcher.fetch('https://x.test/')).toMatchObject({ status: 200, text: 'now present' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a fixture directory through its index', async () => {
    const fetcher = new FixtureSourceFetcher(fixtures);
    const page = await fetcher.fetch('https://example.org/codex-history');
    expect(page).toMatchObject({ status: 200, contentType: 'text/plain; charset=utf-8', retrievedAt: FAKE_EPOCH });
    expect(page.text).toMatch(/^Fixture page for unit tests\./);
    expect(await fetcher.fetch('https://example.org/moved')).toMatchObject({
      status: 301,
      text: '',
      contentType: 'text/html; charset=utf-8',
    });
    expect((await fetcher.fetch('https://example.org/missing')).status).toBe(404);
    expect(await fetcher.fetch('https://example.org/empty')).toMatchObject({ status: 200, text: '' });
    await expect(fetcher.fetch('https://example.org/escape')).rejects.toThrow(/escapes the fixture directory/);
    expect(fetcher.fetched).toHaveLength(5);
  });

  it('rejects absolute fixture paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lectio-fixtures-'));
    try {
      writeFileSync(join(dir, 'index.json'), JSON.stringify({ 'https://x.test/': { file: '/etc/hostname' } }));
      await expect(new FixtureSourceFetcher(dir).fetch('https://x.test/')).rejects.toThrow(RangeError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('FakeTtsProvider', () => {
  it('produces a tiny, valid WAV whose length follows the text', async () => {
    const tts = new FakeTtsProvider();
    const result = await tts.synthesize({ text: 'Héllo', voice: 'v', format: 'wav' });
    const samples = (5 * FAKE_TTS_MS_PER_CHAR * FAKE_TTS_SAMPLE_RATE) / 1000;
    expect(result).toMatchObject({ format: 'wav', contentType: 'audio/wav', durationMs: 250, characters: 5 });
    expect(result.audio.length).toBe(44 + samples);
    const view = new DataView(result.audio.buffer);
    expect(new TextDecoder().decode(result.audio.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(result.audio.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(36 + samples);
    expect(view.getUint32(24, true)).toBe(FAKE_TTS_SAMPLE_RATE);
    expect(view.getUint32(40, true)).toBe(samples);
    expect(tts.requests).toHaveLength(1);
  });

  it('varies audio by voice and refuses unsupported formats', async () => {
    const tts = new FakeTtsProvider();
    const a = await tts.synthesize({ text: 'same', voice: 'a', format: 'wav' });
    const b = await tts.synthesize({ text: 'same', voice: 'b', format: 'wav' });
    expect(Buffer.from(a.audio).equals(Buffer.from(b.audio))).toBe(false);
    await expect(tts.synthesize({ text: 'x', voice: 'a', format: 'mp3' })).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('wraps arbitrary PCM', () => {
    expect(wav(new Uint8Array(0), 8000)).toHaveLength(44);
  });
});

describe('object storage', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lectio-fs-storage-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates keys', () => {
    for (const key of ['', '/abs', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'dir/']) {
      expect(() => assertValidKey(key), key).toThrow(ProviderError);
    }
    expect(() => assertValidKey('audio/en/abc.wav')).not.toThrow();
  });

  it('keeps memory objects isolated from caller mutation', async () => {
    const storage = new MemoryObjectStorage();
    const body = Uint8Array.from([1, 2, 3]);
    await storage.put('k', body, { contentType: 'application/octet-stream' });
    body[0] = 9;
    const first = await storage.get('k');
    expect(first?.body[0]).toBe(1);
    if (first) first.body[1] = 9;
    expect((await storage.get('k'))?.body[1]).toBe(2);
    expect(await storage.list()).toHaveLength(1);
  });

  it('lists an empty filesystem store and ignores stray files', async () => {
    const storage = new FsObjectStorage(dir);
    expect(await storage.list()).toEqual([]);
    await storage.put('a.json/b', 'x', { contentType: 'text/plain' });
    mkdirSync(join(dir, 'meta', 'stray'), { recursive: true });
    writeFileSync(join(dir, 'meta', 'stray', 'notes.txt'), 'not metadata');
    expect((await storage.list()).map((info) => info.key)).toEqual(['a.json/b']);
  });

  it('surfaces filesystem errors other than missing files', async () => {
    writeFileSync(join(dir, 'meta'), 'a file where a directory should be');
    const storage = new FsObjectStorage(dir);
    await expect(storage.head('k')).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(storage.list()).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});
