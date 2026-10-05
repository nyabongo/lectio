import { describe, expect, it, vi } from 'vitest';

import { flush } from './fixtures/fakes.ts';
import { AUDIO_CACHE, browserOfflineAudio, createOfflineAudio } from './offline-audio.ts';
import type { AudioCacheLike, OfflineAudioEnvironment, ResponseLike } from './offline-audio.ts';
import { clearOfflineData, OFFLINE_DATA_CACHE_PREFIX } from '../settings.ts';

const response = (ok = true): ResponseLike => ({ ok, blob: () => Promise.resolve(new Blob(['wav'])) });

class FakeCache implements AudioCacheLike {
  readonly entries = new Map<string, ResponseLike>();
  failMatch = false;

  match(url: string): Promise<ResponseLike | undefined> {
    return this.failMatch ? Promise.reject(new Error('broken')) : Promise.resolve(this.entries.get(url));
  }

  put(url: string, value: ResponseLike): Promise<void> {
    this.entries.set(url, value);
    return Promise.resolve();
  }
}

function setup(overrides: Partial<OfflineAudioEnvironment> = {}) {
  const cache = new FakeCache();
  const opened: string[] = [];
  const env = {
    caches: {
      open: (name: string) => {
        opened.push(name);
        return Promise.resolve(cache);
      },
    },
    fetch: vi.fn((_url: string) => Promise.resolve(response())),
    createObjectURL: vi.fn((_blob: Blob) => 'blob:1'),
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

  it('streams a file it does not have and keeps a copy for next time', async () => {
    const { cache, env, opened, offline } = setup();
    await expect(offline.source('https://audio.test/a.mp3')).resolves.toBe('https://audio.test/a.mp3');
    await flush();
    expect(env.fetch).toHaveBeenCalledWith('https://audio.test/a.mp3');
    expect([...cache.entries.keys()]).toEqual(['https://audio.test/a.mp3']);
    expect(opened).toEqual([AUDIO_CACHE]);

    await expect(offline.source('https://audio.test/a.mp3')).resolves.toBe('blob:1');
    expect(env.fetch).toHaveBeenCalledOnce();
    await offline.source('https://audio.test/b.mp3');
    expect(env.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(opened).toHaveLength(1);
  });

  it('keeps nothing when the file cannot be fetched or stored', async () => {
    const failing = setup({ fetch: () => Promise.resolve(response(false)) });
    await expect(failing.offline.save('x')).resolves.toBe(false);
    const offline = setup({ fetch: () => Promise.reject(new TypeError('CORS')) });
    await expect(offline.offline.save('x')).resolves.toBe(false);
    expect(offline.cache.entries.size).toBe(0);
  });

  it('streams when there is no Cache Storage, the cache cannot open, or an entry is broken', async () => {
    const none = setup({ caches: undefined });
    await expect(none.offline.source('x')).resolves.toBe('x');
    await expect(none.offline.save('x')).resolves.toBe(false);

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
    cache.entries.set('cached', response());
    const scope = {
      caches: { open: vi.fn(() => Promise.resolve(cache)) },
      fetch: vi.fn(() => Promise.resolve(response())),
      URL: { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() },
    } as unknown as typeof globalThis;
    const offline = browserOfflineAudio(scope);
    await expect(offline.source('cached')).resolves.toBe('blob:x');
    await offline.source('other');
    await flush();
    expect(scope.fetch).toHaveBeenCalledWith('other', { mode: 'cors', credentials: 'omit' });
    expect(scope.URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
