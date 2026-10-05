import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { openRepo } from '@lectio/content';

import { AUDIO_KEY_VERSION, audioKey } from './key.ts';
import { buildSegments, passagesOf } from './segments.ts';

const VOICE = 'en-GB-RyanNeural';
const segment = { text: 'Context for Matthew chapter 20, verses 1 to 16.', locale: 'en' };

describe('audioKey', () => {
  it('is the sha256 of locale, voice, TTS version and text, stored under audio/<locale>/', () => {
    const key = audioKey(segment, VOICE, 1);
    const expected = createHash('sha256')
      .update(JSON.stringify([AUDIO_KEY_VERSION, 'en', VOICE, '1', segment.text]))
      .digest('hex');
    expect(key).toEqual({ hash: expected, path: `audio/en/${expected}.mp3` });
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats a numeric and a string TTS version alike', () => {
    expect(audioKey(segment, VOICE, 2)).toEqual(audioKey(segment, VOICE, '2'));
  });

  it('changes when the text, voice, TTS version or locale changes', () => {
    const base = audioKey(segment, VOICE, 1).hash;
    expect(audioKey({ ...segment, text: `${segment.text} ` }, VOICE, 1).hash).not.toBe(base);
    expect(audioKey(segment, 'en-KE-ChilembaNeural', 1).hash).not.toBe(base);
    expect(audioKey(segment, VOICE, 2).hash).not.toBe(base);
    expect(audioKey({ ...segment, locale: 'en-KE' }, VOICE, 1)).toMatchObject({
      path: expect.stringMatching(/^audio\/en-KE\//) as unknown,
    });
  });

  it('ignores Unicode normalisation differences', () => {
    const text = 'ponēros';
    expect(audioKey({ text: text.normalize('NFD'), locale: 'en' }, VOICE, 1)).toEqual(
      audioKey({ text, locale: 'en' }, VOICE, 1),
    );
  });

  it('cannot be forged by text that imitates the field separator', () => {
    expect(audioKey({ text: 'a', locale: 'en' }, 'v","b', 1).hash).not.toBe(
      audioKey({ text: 'b","a', locale: 'en' }, 'v', 1).hash,
    );
  });

  it('rejects an empty voice or TTS version', () => {
    expect(() => audioKey(segment, ' ', 1)).toThrow(RangeError);
    expect(() => audioKey(segment, VOICE, '')).toThrow(RangeError);
  });

  it('gives the Mt 20 seed stable hashes, shared by every day the passage is read', () => {
    const repo = openRepo(fileURLToPath(new URL('fixtures/repo', import.meta.url)));
    const day = repo.resolveDay('2026-09-20');
    if (day === null) throw new Error('fixture day missing');
    const keys = buildSegments(day, passagesOf(day), 'en').map((s) => [s.id, audioKey(s, VOICE, 1).path]);
    // Golden values: if these change, every published note is re-rendered. Change them only on purpose.
    expect(keys).toEqual([
      ['MT.20.1-16/context', 'audio/en/285159fde5d07e43afd5c2dddeb5d81bf870a3f2db194804a723e1d9fec16c91.mp3'],
      ['MT.20.1-16/note/evil-eye', 'audio/en/1660b9c3d2e36181df516f0f4abe9e73d41b99cb35a3e0a0e89c1bab0d0e7c7e.mp3'],
      ['MT.20.1-16/note/agathos', 'audio/en/9647301a84259127b8f155534173be00dd1a9bf3d588dc94af5c68e5c3918f3f.mp3'],
    ]);
    const anotherYear = buildSegments(
      { masses: [{ id: 'day', readings: [{ slot: 'gospel', key: 'MT.20.1-16' }] }] },
      passagesOf(day),
      'en',
    ).map((s) => [s.id, audioKey(s, VOICE, 1).path]);
    expect(anotherYear).toEqual(keys);
  });
});
