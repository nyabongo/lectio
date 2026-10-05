import { describe, expect, it } from 'vitest';

import { audioKey } from '../script/key.ts';
import type { NarrationSegment } from '../script/segments.ts';
import { MANIFEST_KEY, emptyManifest } from './manifest.ts';
import type { AudioManifest, ManifestEntry } from './manifest.ts';
import { findOrphans, objectKeyFor, pickFormat, planRender } from './plan.ts';

function segment(id: string, text: string, locale = 'en'): NarrationSegment {
  return { id, kind: 'context', slot: 'gospel', title: id, text, locale, passageKey: 'MT.20.1-16' };
}

const OPTIONS = { voices: { en: 'en-KE-AsiliaNeural' }, ttsVersion: 'fake-1', format: 'wav' as const };

const keyOf = (s: NarrationSegment, voice = 'en-KE-AsiliaNeural'): string =>
  objectKeyFor(audioKey(s, voice, 'fake-1').path, 'wav');

const ENTRY: ManifestEntry = {
  url: 'x',
  bytes: 1,
  durationMs: 1,
  voice: 'v',
  createdAt: '2026-10-05T00:00:00.000Z',
  contentType: 'audio/wav',
  characters: 1,
};

describe('objectKeyFor and pickFormat', () => {
  it('swaps the extension for the format', () => {
    expect(objectKeyFor('audio/en/abc.mp3', 'wav')).toBe('audio/en/abc.wav');
    expect(objectKeyFor('audio/en/abc.mp3', 'mp3')).toBe('audio/en/abc.mp3');
  });

  it('prefers mp3, else the first format, and needs at least one', () => {
    expect(pickFormat(['wav', 'mp3'])).toBe('mp3');
    expect(pickFormat(['wav'])).toBe('wav');
    expect(() => pickFormat([])).toThrow('offers no audio format');
  });
});

describe('planRender', () => {
  const a = segment('a', 'First note — ἀγαθός said aloud as agathos.');
  const b = segment('b', 'Second note.');

  it('plans every segment against an empty manifest, counting code points', () => {
    const plan = planRender([a, b], emptyManifest(), OPTIONS);
    expect(plan.items.map((item) => item.segmentIds)).toEqual([['a'], ['b']]);
    expect(plan.items[0]).toMatchObject({ key: keyOf(a), locale: 'en', voice: 'en-KE-AsiliaNeural', text: a.text });
    expect(plan.items[0]?.characters).toBe([...a.text].length);
    expect(plan.characters).toBe([...a.text].length + b.text.length);
    expect(plan.wanted).toEqual([keyOf(a), keyOf(b)].sort());
    expect(plan).toMatchObject({ upToDate: 0, skipped: [], format: 'wav', ttsVersion: 'fake-1' });
  });

  it('skips what the manifest has and renders identical text once', () => {
    const manifest: AudioManifest = { version: 1, entries: { [keyOf(a)]: ENTRY } };
    const twin = segment('b-again', b.text);
    const plan = planRender([a, b, twin], manifest, OPTIONS);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.segmentIds).toEqual(['b', 'b-again']);
    expect(plan.upToDate).toBe(1);
    expect(plan.wanted).toHaveLength(2);
  });

  it('falls back to the language voice and skips locales without one', () => {
    const kenyan = segment('ke', 'Habari.', 'en-KE');
    const swahili = segment('sw', 'Habari.', 'sw');
    const plan = planRender([kenyan, swahili], emptyManifest(), OPTIONS);
    expect(plan.items.map((item) => [item.key, item.voice])).toEqual([[keyOf(kenyan), 'en-KE-AsiliaNeural']]);
    expect(plan.skipped).toEqual([{ segmentId: 'sw', locale: 'sw', reason: 'no-voice' }]);
  });
});

describe('findOrphans', () => {
  it('reports unwanted manifest entries and stored files, ignoring the manifest itself', () => {
    const live = segment('a', 'Kept.');
    const plan = planRender([live], emptyManifest(), OPTIONS);
    const manifest: AudioManifest = {
      version: 1,
      entries: { [keyOf(live)]: ENTRY, 'audio/en/old.wav': ENTRY, 'audio/en/lost.wav': ENTRY },
    };
    const stored = [keyOf(live), 'audio/en/old.wav', 'audio/en/stray.wav', MANIFEST_KEY, 'other/file.txt'];
    expect(findOrphans(plan, manifest, stored)).toEqual([
      { key: 'audio/en/lost.wav', inManifest: true, inStorage: false },
      { key: 'audio/en/old.wav', inManifest: true, inStorage: true },
      { key: 'audio/en/stray.wav', inManifest: false, inStorage: true },
    ]);
  });
});
