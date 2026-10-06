import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_VERSION, buildLocaleSegments, buildSegments, manifestKeyFor } from '@lectio/audio';
import type { AudioManifest, ManifestEntry } from '@lectio/audio';
import { DEFAULT_CONFIG } from '@lectio/config';
import type { ResolvedMass } from '@lectio/content';
import type { Passage, TranslationNote } from '@lectio/schema/passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';
import { describe, expect, it } from 'vitest';

import { AUDIO_MANIFEST_ENV, apiAudio, audioManifestPath, loadSiteAudio, massSegments, passageAudio } from './audio.ts';
import type { SiteAudio } from './audio.ts';
import { localeRepo, overlayTranslation, translationSource } from './notes-locale.ts';
import { siteContext } from './site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const repoRoot = resolve(webRoot, '../..');
const FIXTURE_MANIFEST = 'apps/web/test/fixtures/audio/manifest.json';
const FIXTURE_AUDIO = join(webRoot, 'test/fixtures/audio');
const APPROVED = 'MT.20.1-16';
const VOICES = DEFAULT_CONFIG.tts.voices;

function fixtureRepo() {
  return siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } }).repo;
}

function fixtureAudio(): SiteAudio {
  const audio = loadSiteAudio(DEFAULT_CONFIG, { cwd: webRoot, env: { [AUDIO_MANIFEST_ENV]: FIXTURE_MANIFEST } });
  if (audio === null) throw new Error('fixture manifest not loaded');
  return audio;
}

function approvedPassage(): Passage {
  const passage = fixtureRepo().passage(APPROVED);
  if (passage === null) throw new Error('fixture passage missing');
  return passage;
}

function segmentsOf(passage: Passage) {
  return buildSegments({ masses: [{ id: 'm', readings: [{ slot: 'gospel', key: passage.key }] }] }, [passage], 'en');
}

function entry(url: string, durationMs: number | null = 1500): ManifestEntry {
  return {
    url,
    bytes: 10,
    durationMs,
    voice: VOICES['en'] as string,
    ttsVersion: 'fake-1',
    format: 'wav',
    createdAt: '2026-09-19T21:05:00.000Z',
    contentType: 'audio/wav',
    characters: 1,
  };
}

/** A manifest with one entry per given segment text, at `url(key)`. */
function manifestFor(texts: readonly string[], url: (key: string) => string, durationMs?: number | null): SiteAudio {
  const entries: Record<string, ManifestEntry> = {};
  for (const text of texts) {
    const key = manifestKeyFor({ text, locale: 'en' }, VOICES['en'] as string, 'fake-1', 'wav');
    entries[key] = entry(url(key), durationMs);
  }
  const manifest: AudioManifest = { version: MANIFEST_VERSION, entries };
  return { manifest, voices: VOICES };
}

describe('audioManifestPath', () => {
  it('is null without the variable and resolves a relative path from the repository root', () => {
    expect(audioManifestPath({}, webRoot)).toBeNull();
    expect(audioManifestPath({ [AUDIO_MANIFEST_ENV]: '  ' }, webRoot)).toBeNull();
    expect(audioManifestPath({ [AUDIO_MANIFEST_ENV]: FIXTURE_MANIFEST }, webRoot)).toBe(
      join(repoRoot, FIXTURE_MANIFEST),
    );
    expect(audioManifestPath({ [AUDIO_MANIFEST_ENV]: '/tmp/m.json' }, webRoot)).toBe('/tmp/m.json');
  });
});

describe('loadSiteAudio', () => {
  it('is null when no manifest is configured', () => {
    expect(loadSiteAudio(DEFAULT_CONFIG, { env: {} })).toBeNull();
  });

  it('reads the manifest with the configured voices', () => {
    const audio = fixtureAudio();
    expect(Object.keys(audio.manifest.entries)).toHaveLength(3);
    expect(audio.voices).toBe(DEFAULT_CONFIG.tts.voices);
  });

  it('falls back to INIT_CWD and the injected reader', () => {
    const empty = JSON.stringify({ version: MANIFEST_VERSION, entries: {} });
    const read: string[] = [];
    const audio = loadSiteAudio(DEFAULT_CONFIG, {
      env: { [AUDIO_MANIFEST_ENV]: 'm.json', INIT_CWD: webRoot },
      readFile: (path) => {
        read.push(path);
        return empty;
      },
    });
    expect(audio?.manifest.entries).toEqual({});
    expect(read).toEqual([join(repoRoot, 'm.json')]);
  });

  it('fails the build on a missing or malformed manifest', () => {
    expect(() =>
      loadSiteAudio(DEFAULT_CONFIG, { env: { [AUDIO_MANIFEST_ENV]: '/nonexistent/manifest.json' } }),
    ).toThrow(/^LECTIO_AUDIO_MANIFEST=\/nonexistent\/manifest\.json: ENOENT/);
    expect(() =>
      loadSiteAudio(DEFAULT_CONFIG, {
        env: { [AUDIO_MANIFEST_ENV]: '/m.json' },
        readFile: () => '{"version": 2, "entries": {}}',
      }),
    ).toThrow('LECTIO_AUDIO_MANIFEST=/m.json: audio manifest: unsupported version 2');
  });
});

describe('apiAudio', () => {
  const segment = { text: 'Context for a reading.', locale: 'en' };

  it('gives the URL and length in seconds of the rendered file', () => {
    const audio = manifestFor([segment.text], (key) => `https://cdn.example/${key}`);
    expect(apiAudio(audio, segment)).toEqual({
      url: expect.stringMatching(/^https:\/\/cdn\.example\/audio\/en\/[0-9a-f]{64}\.wav$/) as unknown,
      durationSeconds: 1.5,
    });
    const unknown = manifestFor([segment.text], (key) => `https://cdn.example/${key}`, null);
    expect(apiAudio(unknown, segment)?.durationSeconds).toBeNull();
  });

  it('is null without a manifest, a file, a voice or a public URL', () => {
    const audio = manifestFor([segment.text], (key) => `https://cdn.example/${key}`);
    expect(apiAudio(null, segment)).toBeNull();
    expect(apiAudio(audio, { text: 'Something else.', locale: 'en' })).toBeNull();
    expect(apiAudio({ ...audio, voices: {} }, segment)).toBeNull();
    expect(
      apiAudio(
        manifestFor([segment.text], (key) => key),
        segment,
      ),
    ).toBeNull();
  });
});

describe('passageAudio', () => {
  it('maps every segment id of the passage to its audio', () => {
    const passage = approvedPassage();
    expect(passageAudio(null, passage).size).toBe(0);
    const byId = passageAudio(fixtureAudio(), passage);
    expect([...byId.keys()]).toEqual([
      `${APPROVED}/context`,
      ...passage.translationNotes.map((note: TranslationNote) => `${APPROVED}/note/${note.id}`),
    ]);
    expect([...byId.values()].every((audio) => audio?.url.startsWith('https://audio.lectio.test/audio/en/'))).toBe(
      true,
    );
  });

  it('has nothing for a locale without narration strings', () => {
    expect(passageAudio(fixtureAudio(), { ...approvedPassage(), locale: 'xx' }).size).toBe(0);
  });
});

describe('massSegments', () => {
  const mass = (): Pick<ResolvedMass, 'readings'> => {
    const day = fixtureRepo().resolveDay('2026-09-20');
    if (day === null) throw new Error('fixture day missing');
    return day.masses[0] as ResolvedMass;
  };

  it('is the Listen queue: context then each note, with what the voice reads and its file', () => {
    const passage = approvedPassage();
    const segments = massSegments(fixtureAudio(), mass());
    expect(segments.map((segment) => segment.id)).toEqual([
      `${APPROVED}/context`,
      ...passage.translationNotes.map((note: TranslationNote) => `${APPROVED}/note/${note.id}`),
    ]);
    const expected = segmentsOf(passage);
    segments.forEach((segment, i) => {
      expect(segment).toMatchObject({
        kind: i === 0 ? 'context' : 'translation-note',
        slot: 'gospel',
        passageKey: APPROVED,
        locale: 'en',
        title: expected[i]?.title,
        script: expected[i]?.text,
      });
    });
    const durations = segments.map((segment) => segment.audio?.durationSeconds);
    expect(durations.filter((seconds) => seconds === 0.3)).toHaveLength(2);
    expect(durations.filter((seconds) => seconds === null)).toHaveLength(1);
  });

  it('has null audio without a manifest, and narrates a passage read twice once', () => {
    const { readings } = mass();
    const gospel = readings.find((reading) => reading.passage?.key === APPROVED);
    const twice = { readings: [...readings, { ...gospel, slot: 'psalm' } as (typeof readings)[number]] };
    const segments = massSegments(null, twice);
    expect(segments).toHaveLength(3);
    expect(segments.every((segment) => segment.audio === null && segment.slot === 'gospel')).toBe(true);
    expect(massSegments(null, { readings: [] })).toEqual([]);
  });
});

describe('massSegments and passageAudio for translated notes', () => {
  const repo = fixtureRepo();
  const translation = (): TranslatedPassage => translationSource(repo.root)('sw', APPROVED) as TranslatedPassage;
  const swMass = (): Pick<ResolvedMass, 'readings'> => {
    const day = localeRepo(repo, 'sw').resolveDay('2026-09-20');
    if (day === null) throw new Error('fixture day missing');
    return day.masses[0] as ResolvedMass;
  };
  // What the render pipeline narrates and the web player queues: `buildLocaleSegments` of the translation.
  const expected = () =>
    buildLocaleSegments(
      { masses: [{ id: 'm', readings: [{ slot: 'gospel', key: APPROVED }] }] },
      [approvedPassage()],
      [translation()],
      'sw',
    );

  it('narrates a translation in its language, exactly as the render pipeline does, with its audio file', () => {
    const swVoice = VOICES['sw'] as string;
    const entries: Record<string, ManifestEntry> = {};
    for (const { text } of expected()) {
      const key = manifestKeyFor({ text, locale: 'sw' }, swVoice, 'fake-1', 'wav');
      entries[key] = { ...entry(`https://cdn.example/${key}`), voice: swVoice };
    }
    const audio: SiteAudio = { manifest: { version: MANIFEST_VERSION, entries }, voices: VOICES };
    const segments = massSegments(audio, swMass());
    expect(
      segments.map(({ id, kind, slot, passageKey, locale, title, script }) => ({
        id,
        kind,
        slot,
        passageKey,
        locale,
        title,
        text: script,
      })),
    ).toEqual(expected());
    expect(segments.every((segment) => segment.locale === 'sw' && segment.audio?.url.includes('/audio/sw/'))).toBe(
      true,
    );
    const shown = swMass().readings.find((reading) => reading.passage?.key === APPROVED)?.passage as Passage;
    expect([...passageAudio(audio, shown).values()].every((found) => found !== null)).toBe(true);
  });

  it('narrates a copy of a translated passage as the passage itself (#265)', () => {
    const shown = swMass().readings.find((reading) => reading.passage?.key === APPROVED)?.passage as Passage;
    const audio = fixtureAudio();
    const ids = [...passageAudio(audio, shown).keys()];
    expect(ids.length).toBeGreaterThan(0);
    expect([...passageAudio(audio, { ...shown }).keys()]).toEqual(ids);
    expect([...passageAudio(audio, structuredClone(shown)).keys()]).toEqual(ids);
    const copied = {
      readings: swMass().readings.map((reading) => ({ ...reading, passage: structuredClone(reading.passage) })),
    };
    expect(massSegments(null, copied)).toEqual(massSegments(null, swMass()));
  });

  it('has nothing for a translation into a language without narration', () => {
    const overlaid = overlayTranslation(approvedPassage(), { ...translation(), locale: 'xx' });
    expect(passageAudio(fixtureAudio(), overlaid).size).toBe(0);
  });
});

describe('test/fixtures/audio', () => {
  it('has a file for every segment of the fixture content, so the e2e build has audio everywhere', () => {
    // Regenerate the fixture when the fixture notes change: one short WAV per segment under
    // test/fixtures/audio/<locale>/<hash>.wav, keyed by `manifestKeyFor(segment, voice, 'fake-1', 'wav')`. They are
    // 16-bit PCM mono at 16 kHz, which every browser decodes, so the Listen e2e plays them as they are.
    const audio = fixtureAudio();
    const segments = segmentsOf(approvedPassage());
    expect(segments.map((segment) => apiAudio(audio, segment)).every((found) => found !== null)).toBe(true);
    for (const [key, found] of Object.entries(audio.manifest.entries)) {
      expect(found.url).toBe(`https://audio.lectio.test/${key}`);
      const file = join(FIXTURE_AUDIO, key.replace(/^audio\//, ''));
      expect(statSync(file).size).toBe(found.bytes);
      const wav = readFileSync(file);
      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(wav.subarray(8, 16).toString('ascii')).toBe('WAVEfmt ');
      // PCM, mono, at least 8 kHz, 16-bit; the data chunk fills the rest of the file.
      expect([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt16LE(34)]).toEqual([1, 1, 16]);
      const rate = wav.readUInt32LE(24);
      expect(rate).toBeGreaterThanOrEqual(8000);
      expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
      const dataBytes = wav.readUInt32LE(40);
      expect(44 + dataBytes).toBe(found.bytes);
      if (found.durationMs !== null) expect(Math.round((dataBytes / 2 / rate) * 1000)).toBe(found.durationMs);
    }
  });
});
