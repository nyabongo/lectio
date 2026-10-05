import { describe, expect, it } from 'vitest';

import { IMMUTABLE_CACHE_CONTROL, NO_CACHE_CONTROL, defaultCacheControl } from './cache-control.ts';

describe('defaultCacheControl', () => {
  it.each([
    ['manifest.json', NO_CACHE_CONTROL],
    ['audio/manifest.json', NO_CACHE_CONTROL],
    ['audio/en.manifest.json', NO_CACHE_CONTROL],
    ['audio/0123456789abcdef0123456789abcdef.manifest.json', NO_CACHE_CONTROL],
    ['audio/3f9a0c2b7d4e5f60.wav', IMMUTABLE_CACHE_CONTROL],
    ['audio/en/note-3f9a0c2b7d4e5f6011223344.mp3', IMMUTABLE_CACHE_CONTROL],
    ['3f9a0c2b7d4e5f60', IMMUTABLE_CACHE_CONTROL],
  ])('%s gets %s', (key, expected) => {
    expect(defaultCacheControl(key)).toBe(expected);
  });

  it.each([
    'audio/abc123.wav',
    'readme.txt',
    'audio/3F9A0C2B7D4E5F60.wav',
    'audio/x3f9a0c2b7d4e5f60.wav',
    'mymanifest.json',
    'manifest.json/child',
  ])('leaves %s without a header', (key) => {
    expect(defaultCacheControl(key)).toBeUndefined();
  });
});
