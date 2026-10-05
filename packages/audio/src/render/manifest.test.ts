import { describe, expect, it } from 'vitest';

import { MemoryObjectStorage } from '@lectio/providers';

import {
  MANIFEST_KEY,
  MANIFEST_VERSION,
  charactersThisMonth,
  emptyManifest,
  parseManifest,
  readManifest,
  serializeManifest,
  writeManifest,
} from './manifest.ts';
import type { AudioManifest, ManifestEntry } from './manifest.ts';

const ENTRY: ManifestEntry = {
  url: 'audio/en/aa.wav',
  bytes: 100,
  durationMs: 2500,
  voice: 'en-KE-AsiliaNeural',
  ttsVersion: 'fake-1',
  format: 'wav',
  createdAt: '2026-10-05T08:00:00.000Z',
  contentType: 'audio/wav',
  characters: 50,
};

const json = (data: unknown): string => JSON.stringify(data);

describe('parseManifest', () => {
  it('accepts a well-formed manifest, including an unknown duration', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      entries: { 'audio/en/aa.wav': ENTRY, 'audio/en/bb.mp3': { ...ENTRY, durationMs: null } },
    };
    expect(parseManifest(json(manifest))).toEqual(manifest);
  });

  it('rejects a wrong shape or version', () => {
    expect(() => parseManifest('[]')).toThrow('expected { version, entries }');
    expect(() => parseManifest(json({ version: 1 }))).toThrow('expected { version, entries }');
    expect(() => parseManifest(json({ version: 2, entries: {} }))).toThrow('unsupported version 2');
  });

  it.each([
    ['entry', 'nope'],
    ['url', { ...ENTRY, url: '' }],
    ['bytes', { ...ENTRY, bytes: -1 }],
    ['durationMs', { ...ENTRY, durationMs: 1.5 }],
    ['voice', { ...ENTRY, voice: 3 }],
    ['ttsVersion', { ...ENTRY, ttsVersion: '' }],
    ['format', { ...ENTRY, format: 'ogg' }],
    ['createdAt', { ...ENTRY, createdAt: 'yesterday' }],
    ['createdAt', { ...ENTRY, createdAt: undefined }],
    ['contentType', { ...ENTRY, contentType: '' }],
    ['characters', { ...ENTRY, characters: '50' }],
  ])('rejects an invalid %s', (field, entry) => {
    expect(() => parseManifest(json({ version: 1, entries: { k: entry } }))).toThrow(
      `audio manifest entry "k": invalid ${field}`,
    );
  });
});

describe('serializeManifest', () => {
  it('sorts entries so equal manifests give equal bytes', () => {
    const a: AudioManifest = { version: 1, entries: { b: ENTRY, a: ENTRY } };
    const b: AudioManifest = { version: 1, entries: { a: ENTRY, b: ENTRY } };
    expect(serializeManifest(a)).toBe(serializeManifest(b));
    expect(Object.keys((JSON.parse(serializeManifest(a)) as AudioManifest).entries)).toEqual(['a', 'b']);
    expect(serializeManifest(a).endsWith('}\n')).toBe(true);
  });
});

describe('readManifest and writeManifest', () => {
  it('reads an empty manifest from empty storage and round-trips a written one', async () => {
    const storage = new MemoryObjectStorage();
    expect(await readManifest(storage)).toEqual(emptyManifest());
    const manifest: AudioManifest = { version: 1, entries: { 'audio/en/aa.wav': ENTRY } };
    await writeManifest(storage, manifest);
    expect(await readManifest(storage)).toEqual(manifest);
    expect(await storage.head(MANIFEST_KEY)).toMatchObject({
      contentType: 'application/json',
      cacheControl: 'no-cache',
    });
  });
});

describe('charactersThisMonth', () => {
  it('sums the characters billed in the UTC month of now', () => {
    const manifest: AudioManifest = {
      version: 1,
      entries: {
        a: ENTRY,
        b: { ...ENTRY, characters: 7, createdAt: '2026-10-31T23:30:00-01:00' }, // 1 November UTC
        c: { ...ENTRY, characters: 3, createdAt: '2026-10-01T00:00:00.000Z' },
        d: { ...ENTRY, characters: 9, createdAt: '2026-09-30T23:59:59.999Z' },
      },
    };
    expect(charactersThisMonth(manifest, new Date('2026-10-15T00:00:00Z'))).toBe(53);
    expect(charactersThisMonth(manifest, new Date('2026-11-02T00:00:00Z'))).toBe(7);
  });
});
