import { describe, expect, it } from 'vitest';

import { FakeTtsProvider, MemoryObjectStorage } from '@lectio/providers';

import type { NarrationSegment } from '../script/segments.ts';
import { emptyManifest } from './manifest.ts';
import type { AudioManifest, ManifestEntry } from './manifest.ts';
import { planRender } from './plan.ts';
import { render } from './render.ts';
import { TTS_VERSIONS, manifestKeyFor, resolveAudio } from './resolve.ts';

const VOICES = { en: 'en-KE-AsiliaNeural' };
const NOTE: NarrationSegment = {
  id: 'MT.20.1-16/note/agathos',
  kind: 'translation-note',
  slot: 'gospel',
  title: 'good',
  text: 'The landowner calls himself good.',
  locale: 'en-KE',
  passageKey: 'MT.20.1-16',
};

const entry = (ttsVersion: string, format: 'wav' | 'mp3', url: string): ManifestEntry => ({
  url,
  bytes: 1,
  durationMs: 1,
  voice: VOICES.en,
  ttsVersion,
  format,
  createdAt: '2026-10-05T00:00:00.000Z',
  contentType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
  characters: 1,
});

describe('manifestKeyFor', () => {
  it('is the hashed key with the format extension', () => {
    expect(manifestKeyFor(NOTE, VOICES.en, 'fake-1', 'wav')).toMatch(/^audio\/en-KE\/[0-9a-f]{64}\.wav$/);
    expect(manifestKeyFor(NOTE, VOICES.en, 'azure-1', 'mp3')).toMatch(/\.mp3$/);
  });
});

describe('resolveAudio', () => {
  it('finds what the fake render produced, without a provider', async () => {
    const storage = new MemoryObjectStorage();
    const plan = planRender([NOTE], emptyManifest(), {
      voices: VOICES,
      ttsVersion: TTS_VERSIONS['fake'] as string,
      format: 'wav',
    });
    const { manifest } = await render(plan, new FakeTtsProvider(), storage, {
      manifest: emptyManifest(),
      publicBaseUrl: 'https://cdn.example/',
    });
    const found = resolveAudio(manifest, NOTE, VOICES);
    expect(found?.key).toBe(plan.items[0]?.key);
    expect(found?.url).toBe(`https://cdn.example/${plan.items[0]?.key as string}`);
    expect(found?.entry).toMatchObject({ ttsVersion: 'fake-1', format: 'wav' });
  });

  it('prefers real voices and mp3, and ignores entries recorded under another version or format', () => {
    const fakeWav = manifestKeyFor(NOTE, VOICES.en, 'fake-1', 'wav');
    const azureMp3 = manifestKeyFor(NOTE, VOICES.en, 'azure-1', 'mp3');
    const both: AudioManifest = {
      version: 1,
      entries: { [fakeWav]: entry('fake-1', 'wav', 'fake'), [azureMp3]: entry('azure-1', 'mp3', 'azure') },
    };
    expect(resolveAudio(both, NOTE, VOICES)?.url).toBe('azure');
    expect(resolveAudio(both, NOTE, VOICES, ['fake-1'])?.url).toBe('fake');
    const mislabelled: AudioManifest = { version: 1, entries: { [fakeWav]: entry('fake-2', 'wav', 'x') } };
    expect(resolveAudio(mislabelled, NOTE, VOICES)).toBeNull();
  });

  it('gives null without a voice or an entry', () => {
    expect(resolveAudio(emptyManifest(), NOTE, VOICES)).toBeNull();
    expect(resolveAudio(emptyManifest(), NOTE, { sw: 'sw-KE-ZuriNeural' })).toBeNull();
  });
});
