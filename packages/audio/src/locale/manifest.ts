/**
 * The audio manifest by locale. Every key is `audio/<locale>/<hash>.<ext>`, so one manifest holds
 * every language and each player (web L-113, app L-114) takes the entries of its own locale.
 */
import { MANIFEST_VERSION } from '../render/manifest.ts';
import type { AudioManifest, ManifestEntry } from '../render/manifest.ts';

const LOCALE_KEY = /^audio\/([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\/[0-9a-f]{64}\.[a-z0-9]+$/;

/** The locale a narration file's key names (`audio/sw/<hash>.mp3` → `sw`), or `null` for any other key. */
export function localeOfKey(key: string): string | null {
  return LOCALE_KEY.exec(key)?.[1] ?? null;
}

/** The manifest split by locale: each locale's entries as a manifest of their own. Other keys are left out. */
export function manifestByLocale(manifest: AudioManifest): Readonly<Record<string, AudioManifest>> {
  const byLocale: Record<string, Record<string, ManifestEntry>> = {};
  for (const key of Object.keys(manifest.entries).sort()) {
    const locale = localeOfKey(key);
    if (locale === null) continue;
    (byLocale[locale] ??= {})[key] = manifest.entries[key] as ManifestEntry;
  }
  return Object.fromEntries(
    Object.keys(byLocale)
      .sort()
      .map((locale) => [
        locale,
        { version: MANIFEST_VERSION, entries: byLocale[locale] as Record<string, ManifestEntry> },
      ]),
  );
}

/** The entries of one locale (exactly: `en-KE` files are not `en` files), as a manifest. */
export function localeManifest(manifest: AudioManifest, locale: string): AudioManifest {
  return manifestByLocale(manifest)[locale] ?? { version: MANIFEST_VERSION, entries: {} };
}

/** The locales with at least one file, sorted. */
export function manifestLocales(manifest: AudioManifest): string[] {
  return Object.keys(manifestByLocale(manifest));
}
