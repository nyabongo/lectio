import { describe, expect, it } from 'vitest';

import type { AudioManifest, ManifestEntry } from '../render/manifest.ts';
import { localeManifest, localeOfKey, manifestByLocale, manifestLocales } from './manifest.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function entry(voice: string): ManifestEntry {
  return {
    url: 'x',
    bytes: 1,
    durationMs: 1,
    voice,
    ttsVersion: 'fake-1',
    format: 'mp3',
    createdAt: '2026-10-05T06:00:00.000Z',
    contentType: 'audio/mpeg',
    characters: 1,
  };
}

const MANIFEST: AudioManifest = {
  version: 1,
  entries: {
    [`audio/sw/${HASH_B}.mp3`]: entry('sw-KE-ZuriNeural'),
    [`audio/en/${HASH_A}.mp3`]: entry('en-KE-AsiliaNeural'),
    [`audio/sw/${HASH_A}.wav`]: entry('sw-KE-ZuriNeural'),
    [`audio/en-KE/${HASH_A}.mp3`]: entry('en-KE-AsiliaNeural'),
    'audio/stray.mp3': entry('none'),
  },
};

describe('localeOfKey', () => {
  it('reads the locale of a narration key', () => {
    expect(localeOfKey(`audio/sw/${HASH_A}.mp3`)).toBe('sw');
    expect(localeOfKey(`audio/en-KE/${HASH_A}.wav`)).toBe('en-KE');
  });

  it.each(['audio/manifest.json', 'audio/stray.mp3', `audio/sw/x/${HASH_A}.mp3`, `video/sw/${HASH_A}.mp3`])(
    'is null for %s',
    (key) => {
      expect(localeOfKey(key)).toBeNull();
    },
  );
});

describe('manifest by locale', () => {
  it('splits the entries by locale, sorted, leaving out other keys', () => {
    const byLocale = manifestByLocale(MANIFEST);
    expect(Object.keys(byLocale)).toEqual(['en', 'en-KE', 'sw']);
    expect(Object.keys(byLocale['sw']?.entries ?? {})).toEqual([`audio/sw/${HASH_A}.wav`, `audio/sw/${HASH_B}.mp3`]);
    expect(byLocale['en']).toEqual({
      version: 1,
      entries: { [`audio/en/${HASH_A}.mp3`]: entry('en-KE-AsiliaNeural') },
    });
    expect(manifestLocales(MANIFEST)).toEqual(['en', 'en-KE', 'sw']);
  });

  it('gives one locale exactly, or an empty manifest', () => {
    expect(Object.keys(localeManifest(MANIFEST, 'en').entries)).toEqual([`audio/en/${HASH_A}.mp3`]);
    expect(localeManifest(MANIFEST, 'fr')).toEqual({ version: 1, entries: {} });
  });
});
