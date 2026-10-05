import { describe, expect, it, vi } from 'vitest';

import { clearOfflineData, OFFLINE_DATA_CACHE_PREFIX } from '../settings.ts';
import {
  AUDIO_CACHE,
  AUDIO_CACHE_LIMIT,
  DOWNLOAD_TIMEOUT,
  browserOfflineAudio,
  createOfflineAudio,
} from './offline-audio.ts';
import type { AudioCacheLike, OfflineAudioEnvironment, ResponseLike } from './offline-audio.ts';

const response = (ok = true, body = 'wav'): ResponseLike => ({
  ok,
  blob: () => Promise.resolve(new Blob([body])),
  clone: () => response(ok, body),
});

/** A cache that keeps insertion order, as Cache Storage does (a `put` of a stored URL moves it to the end). */
class FakeCache implements AudioCacheLike {
  readonly entries = new Map<string, ResponseLike>();
  failMatch = false;
  failPut = false;

  match(url: string): Promise<ResponseLike | undefined> {
    return this.failMatch ? Promise.reject(new Error('broken')) : Promise.resolve(this.entries.get(url));
  }

  put(url: string, value: ResponseLike): Promise<void> {
    if (this.failPut) return Promise.reject(new Error('quota'));
    this.entries.delete(url);
    this.entries.set(url, value);
    return Promise.resolve();
  }

  keys(): Promise<{ url: string }[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => ({ url })));
  }

  delete(request: { url: string }): Promise<boolean> {
    return Promise.resolve(this.entries.delete(request.url));
  }
}

function setup(overrides: Partial<OfflineAudioEnvironment> = {}) {
  const cache = new FakeCache();
  const opened: string[] = [];
  let made = 0;
  const env = {
    caches: {
      open: (name: string) => {
        opened.push(name);
        return Promise.resolve(cache);
      },
    },
    fetch: vi.fn((_url: string) => Promise.resolve(response())),
    createObjectURL: vi.fn((_blob: Blob) => `blob:${++made}`),
    revokeObjectURL: vi.fn(),
    ...overrides,
  };
  return { cache, env, opened, offline: createOfflineAudio(env) };
}

describe('createOfflineAudio', () => {
  it('names its cache with the offline-data prefix, so Clear offline data removes it', async () => {
    expect(AUDIO_CACHE).toBe('lectio-data-audio');
    expect(AUDIO_CACHE.startsWith(OFFLINE_DATA_CACHE_PREFIX)).toBe(true);
    const deleted: string[] = [];
    const result = await clearOfflineData(undefined, {
      keys: () => Promise.resolve(['lectio-shell-1', AUDIO_CACHE]),
      delete: (name) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    });
    expect(result).toEqual({ status: 'cleared', count: 1 });
    expect(deleted).toEqual([AUDIO_CACHE]);
  });

  it('downloads a file once, keeps it and plays the kept copy', async () => {
    const { cache, env, opened, offline } = setup();
    await expect(offline.source('https://audio.test/a.mp3')).resolves.toBe('blob:1');
    expect(env.fetch).toHaveBeenCalledExactlyOnceWith('https://audio.test/a.mp3');
    expect([...cache.entries.keys()]).toEqual(['https://audio.test/a.mp3']);

    await expect(offline.source('https://audio.test/a.mp3')).resolves.toBe('blob:2');
    expect(env.fetch).toHaveBeenCalledOnce();
    expect(env.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(opened).toEqual([AUDIO_CACHE]);
  });

  it(`keeps at most ${AUDIO_CACHE_LIMIT} files by default, dropping the least recently played`, async () => {
    const { cache, offline } = setup({ limit: 3 });
    for (const name of ['a', 'b', 'c']) await offline.source(name);
    await offline.source('a');
    await offline.source('d');
    expect([...cache.entries.keys()]).toEqual(['c', 'a', 'd']);
    await offline.source('e');
    expect([...cache.entries.keys()]).toEqual(['a', 'd', 'e']);
    expect(AUDIO_CACHE_LIMIT).toBeGreaterThan(0);
  });

  it('streams the URL when the file cannot be fetched or kept, keeping nothing', async () => {
    const missing = setup({ fetch: () => Promise.resolve(response(false)) });
    await expect(missing.offline.source('x')).resolves.toBe('x');
    const refused = setup({ fetch: () => Promise.reject(new TypeError('CORS')) });
    await expect(refused.offline.source('x')).resolves.toBe('x');
    expect(refused.cache.entries.size).toBe(0);
    const full = setup();
    full.cache.failPut = true;
    await expect(full.offline.source('x')).resolves.toBe('x');
  });

  it('still plays a kept copy when the quota refuses to move it to the end', async () => {
    const { cache, env, offline } = setup();
    await offline.source('a');
    cache.failPut = true;
    await expect(offline.source('a')).resolves.toBe('blob:2');
    expect(env.fetch).toHaveBeenCalledOnce();
    expect([...cache.entries.keys()]).toEqual(['a']);
  });

  it('streams when there is no Cache Storage, the cache cannot open, or an entry is broken', async () => {
    const none = setup({ caches: undefined });
    await expect(none.offline.source('x')).resolves.toBe('x');
    expect(none.env.fetch).not.toHaveBeenCalled();

    const closed = setup({ caches: { open: () => Promise.reject(new Error('denied')) } });
    await expect(closed.offline.source('x')).resolves.toBe('x');

    const broken = setup();
    broken.cache.failMatch = true;
    await expect(broken.offline.source('x')).resolves.toBe('x');
  });
});

describe('browserOfflineAudio', () => {
  it('uses the scope’s caches, CORS fetch and object URLs', async () => {
    const cache = new FakeCache();
    const signal = { aborted: false };
    const scope = {
      caches: { open: vi.fn(() => Promise.resolve(cache)) },
      fetch: vi.fn(() => Promise.resolve(response())),
      URL: { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() },
      AbortSignal: { timeout: vi.fn(() => signal) },
    } as unknown as typeof globalThis;
    const offline = browserOfflineAudio(scope);
    await expect(offline.source('a')).resolves.toBe('blob:x');
    await offline.source('a');
    expect(scope.fetch).toHaveBeenCalledExactlyOnceWith('a', { mode: 'cors', credentials: 'omit', signal });
    expect(scope.AbortSignal.timeout).toHaveBeenCalledWith(DOWNLOAD_TIMEOUT);
    expect(scope.URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
