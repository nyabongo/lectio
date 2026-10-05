/** Acceptance (L-115): a fake render of English and Kiswahili narration side by side. */
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { openRepo } from '@lectio/content';
import { FakeClock, FakeTtsProvider, MemoryObjectStorage } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { emptyManifest, readManifest } from '../render/manifest.ts';
import { pickFormat, planRender } from '../render/plan.ts';
import { render } from '../render/render.ts';
import { TTS_VERSIONS, resolveAudio } from '../render/resolve.ts';
import { audioKey } from '../script/key.ts';
import { buildSegments } from '../script/segments.ts';
import type { NarrationSegment } from '../script/segments.ts';
import { localeManifest, localeOfKey, manifestLocales } from './manifest.ts';
import { localeSegments } from './repo.ts';

const repo = openRepo(fileURLToPath(new URL('fixtures/repo', import.meta.url)));
const VOICES = DEFAULT_CONFIG.tts.voices;

function englishSegments(): NarrationSegment[] {
  const passage = repo.passage('MT.20.1-16') as Passage;
  const day = { masses: [{ id: 'all', readings: [{ slot: 'gospel' as const, key: passage.key }] }] };
  return buildSegments(day, [passage], 'en');
}

describe('fake render of Kiswahili narration', () => {
  it('renders sw segments for the translated seed notes beside the English ones, in separate keys', async () => {
    const tts = new FakeTtsProvider();
    const storage = new MemoryObjectStorage();
    const english = englishSegments();
    const { segments: swahili } = localeSegments(repo, 'sw');
    expect(swahili).toHaveLength(english.length);

    const plan = planRender([...english, ...swahili], emptyManifest(), {
      voices: VOICES,
      ttsVersion: TTS_VERSIONS['fake'] as string,
      format: pickFormat(tts.formats),
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.items.filter((item) => item.locale === 'sw').map((item) => item.voice)).toEqual(
      swahili.map(() => VOICES['sw']),
    );
    expect(plan.items.filter((item) => item.locale === 'en').every((item) => item.voice === VOICES['en'])).toBe(true);

    const result = await render(plan, tts, storage, {
      manifest: emptyManifest(),
      clock: new FakeClock({ start: '2026-10-05T06:00:00.000Z' }),
    });
    expect(result.failed).toEqual([]);
    expect(result.rendered).toHaveLength(english.length + swahili.length);

    const stored = await readManifest(storage);
    const swKeys = Object.keys(localeManifest(stored, 'sw').entries);
    const enKeys = Object.keys(localeManifest(stored, 'en').entries);
    expect(manifestLocales(stored)).toEqual(['en', 'sw']);
    expect(swKeys).toHaveLength(swahili.length);
    expect(enKeys).toHaveLength(english.length);
    expect(swKeys.every((key) => key.startsWith('audio/sw/') && localeOfKey(key) === 'sw')).toBe(true);
    expect(swKeys.filter((key) => enKeys.includes(key))).toEqual([]);
    expect(swKeys.every((key) => stored.entries[key]?.voice === VOICES['sw'])).toBe(true);

    // Each player finds its own language's file for the same segment id.
    for (const segment of swahili) {
      const sw = resolveAudio(stored, segment, VOICES);
      const en = resolveAudio(stored, english.find((e) => e.id === segment.id) as NarrationSegment, VOICES);
      expect(sw?.key.startsWith('audio/sw/')).toBe(true);
      expect(en?.key.startsWith('audio/en/')).toBe(true);
      expect(await storage.get(sw?.key as string)).not.toBeNull();
    }
  });

  it('keeps identical text apart across locales, even with one voice for both', () => {
    const text = { text: 'Agathos.' };
    const en = audioKey({ ...text, locale: 'en' }, 'shared-voice', 'fake-1');
    const sw = audioKey({ ...text, locale: 'sw' }, 'shared-voice', 'fake-1');
    expect(en.path).toMatch(/^audio\/en\//);
    expect(sw.path).toMatch(/^audio\/sw\//);
    expect(sw.hash).not.toBe(en.hash);
  });

  it('skips Kiswahili segments when no voice is configured for sw', () => {
    const { segments } = localeSegments(repo, 'sw');
    const plan = planRender(segments, emptyManifest(), {
      voices: { en: 'en-KE-AsiliaNeural' },
      ttsVersion: 'fake-1',
      format: 'wav',
    });
    expect(plan.items).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(segments.map(() => 'no-voice'));
  });
});
