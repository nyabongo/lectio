/**
 * Narration files kept for offline listening (L-085). Every file the Listen page plays is saved in the Cache Storage
 * cache `lectio-data-audio`; the next time, it plays from that copy, with or without a network.
 *
 * The cache name starts with `OFFLINE_DATA_CACHE_PREFIX` (`lectio-data-`), so Settings → Clear offline data (L-057)
 * and the service worker's `clear-offline-data` message (L-061) remove it with the saved days, and keep the app shell.
 *
 * Saving is best effort and never delays playback: the first play streams from the URL while a copy is fetched in
 * the background. A file the browser cannot fetch with CORS, a full quota or a browser without Cache Storage only
 * means the file is not kept. Cached copies play through object URLs; the previous one is revoked when the next
 * file plays.
 */
import { OFFLINE_DATA_CACHE_PREFIX } from '../settings.ts';

/** The cache narration files are kept in. */
export const AUDIO_CACHE = `${OFFLINE_DATA_CACHE_PREFIX}audio`;

/** The parts of a `Response` the store reads. */
export interface ResponseLike {
  readonly ok: boolean;
  blob(): Promise<Blob>;
}

export interface AudioCacheLike {
  match(url: string): Promise<ResponseLike | undefined>;
  put(url: string, response: ResponseLike): Promise<void>;
}

export interface OfflineAudioEnvironment {
  /** `globalThis.caches`, absent where there is no Cache Storage (or on an insecure origin). */
  readonly caches?: { open(name: string): Promise<AudioCacheLike> } | undefined;
  readonly fetch: (url: string) => Promise<ResponseLike>;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

export interface OfflineAudio {
  /** The `src` for a narration file: an object URL of the cached copy, else the URL itself (and a copy is saved). */
  source(url: string): Promise<string>;
  /** Fetches `url` and keeps it; false when it could not be fetched or stored. */
  save(url: string): Promise<boolean>;
}

export function createOfflineAudio(env: OfflineAudioEnvironment): OfflineAudio {
  let cache: Promise<AudioCacheLike | null> | null = null;
  let objectUrl: string | null = null;

  const open = (): Promise<AudioCacheLike | null> => {
    cache ??= env.caches === undefined ? Promise.resolve(null) : env.caches.open(AUDIO_CACHE).catch(() => null);
    return cache;
  };

  const save = async (url: string): Promise<boolean> => {
    try {
      const store = await open();
      if (store === null) return false;
      const response = await env.fetch(url);
      if (!response.ok) return false;
      await store.put(url, response);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async source(url) {
      if (objectUrl !== null) env.revokeObjectURL(objectUrl);
      objectUrl = null;
      try {
        const cached = await (await open())?.match(url);
        if (cached !== undefined) {
          objectUrl = env.createObjectURL(await cached.blob());
          return objectUrl;
        }
      } catch {
        // A broken cache entry: stream from the URL instead.
      }
      void save(url);
      return url;
    },
    save,
  };
}

/** The browser's Cache Storage, `fetch` and object URLs (CORS fetch, so the stored copy is readable). */
export function browserOfflineAudio(scope: typeof globalThis): OfflineAudio {
  const caches = (scope as { caches?: OfflineAudioEnvironment['caches'] }).caches;
  return createOfflineAudio({
    caches,
    fetch: (url) => scope.fetch(url, { mode: 'cors', credentials: 'omit' }),
    createObjectURL: (blob) => scope.URL.createObjectURL(blob),
    revokeObjectURL: (url) => scope.URL.revokeObjectURL(url),
  });
}
