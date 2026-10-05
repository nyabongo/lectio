/**
 * Cache-Control policy for the audio bucket. Hashed keys never change content, so
 * browsers and CDNs may keep them forever; the manifest that points at them must be
 * revalidated on every read.
 */

/** For content-addressed keys: a new text gets a new hash, so the old object never changes. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** For the manifest: always revalidate so a new render shows up on the next request. */
export const NO_CACHE_CONTROL = 'no-cache';

/** A file name that is, or ends in, a manifest JSON file (`manifest.json`, `audio.manifest.json`). */
const MANIFEST = /(?:^|[.\-_])manifest\.json$/;
/** A file name with a run of at least 16 lowercase hex characters between separators (`3f9a…c2.wav`). */
const HASHED = /(?:^|[.\-_])[0-9a-f]{16,}(?:[.\-_]|$)/;

/**
 * The default Cache-Control for a key: `no-cache` for manifests, immutable for hashed
 * keys, otherwise `undefined` (no header, so the bucket or CDN default applies).
 * Callers can always override it with `PutOptions.cacheControl`.
 */
export function defaultCacheControl(key: string): string | undefined {
  const name = key.slice(key.lastIndexOf('/') + 1);
  if (MANIFEST.test(name)) return NO_CACHE_CONTROL;
  if (HASHED.test(name)) return IMMUTABLE_CACHE_CONTROL;
  return undefined;
}
