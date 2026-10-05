/**
 * The web player's language (L-113): Kiswahili segments are queued where the narration has them, English ones
 * stand in otherwise, and device speech reads each segment with a voice of its own language.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLocaleSegments, buildSegments } from '@lectio/audio';
import type { NarrationDay } from '@lectio/audio';
import type { Passage } from '@lectio/schema/passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';
import { describe, expect, it } from 'vitest';

import { localeQueue, pickVoice, speechSettings } from './locale.ts';
import type { VoiceLike } from './locale.ts';

const content = resolve(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/content/passages');
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(content, path), 'utf8')) as T;
const mt = read<Passage>('MT.20.1-16.json');
const sw = read<TranslatedPassage>('i18n/sw/MT.20.1-16.json');

const day: NarrationDay = { masses: [{ id: 'day', readings: [{ slot: 'gospel', key: 'MT.20.1-16' }] }] };
const english = buildSegments(day, [mt], 'en');
const kiswahili = buildLocaleSegments(day, [mt], [sw], 'sw');

describe('localeQueue', () => {
  it('queues the Kiswahili segments on a Kiswahili page, in the English order', () => {
    expect(kiswahili.length).toBe(english.length);
    const queue = localeQueue(english, [...kiswahili].reverse(), 'sw');
    expect(queue.map((entry) => entry.segment.id)).toEqual(english.map((segment) => segment.id));
    expect(queue.every((entry) => entry.segment.locale === 'sw' && !entry.fallback)).toBe(true);
  });

  it('falls back to the English segment where there is no Kiswahili one', () => {
    const [context, ...notes] = kiswahili;
    const queue = localeQueue(english, notes, 'sw');
    expect(queue[0]).toEqual({ segment: english[0], fallback: true });
    expect(queue.slice(1).map((entry) => entry.segment.locale)).toEqual(notes.map(() => 'sw'));
    expect(context?.id).toBe(english[0]?.id);
    // No translation at all (none approved, or every one stale): the whole English queue.
    expect(localeQueue(english, [], 'sw').every((entry) => entry.fallback && entry.segment.locale === 'en')).toBe(true);
  });

  it('never queues segments of another language or without an English counterpart', () => {
    const stray = { id: 'XX.1.1/context', locale: 'sw' };
    const other = { ...english[0], locale: 'pt-BR' } as (typeof english)[number];
    const queue = localeQueue<{ id: string; locale: string }>(english, [stray, other], 'sw');
    expect(queue.map((entry) => entry.segment)).toEqual(english);
  });

  it('plays the English queue as it is on an English page', () => {
    expect(localeQueue(english, kiswahili, 'en')).toEqual(english.map((segment) => ({ segment, fallback: false })));
    expect(localeQueue(kiswahili, english, 'sw', 'sw').every((entry) => !entry.fallback)).toBe(true);
  });
});

const voice = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({ name, lang, ...extra });

describe('pickVoice', () => {
  const voices = [
    voice('Google US English', 'en-US', { default: true }),
    voice('Daniel', 'en-GB', { localService: true }),
    voice('Rehema', 'sw-TZ'),
    voice('Zuri (network)', 'sw-KE'),
    voice('Zuri', 'sw_KE', { localService: true }),
    voice('Kiswahili', 'sw'),
  ];

  it('chooses a Kenyan Kiswahili voice for Kiswahili, on-device first', () => {
    expect(pickVoice(voices, 'sw')?.name).toBe('Zuri');
    expect(
      pickVoice(
        voices.filter((v) => v.name !== 'Zuri'),
        'sw',
      )?.name,
    ).toBe('Zuri (network)');
  });

  it('falls back to the bare language, then any region of it', () => {
    expect(
      pickVoice(
        voices.filter((v) => !/Zuri/.test(v.name)),
        'sw',
      )?.name,
    ).toBe('Kiswahili');
    expect(pickVoice([voice('Rehema', 'sw-TZ'), voice('Daniel', 'en-GB')], 'sw')?.name).toBe('Rehema');
  });

  it('prefers the engine default among equals, then the list order', () => {
    const tied = [voice('A', 'sw-TZ'), voice('B', 'sw-TZ', { default: true }), voice('C', 'sw-TZ')];
    expect(pickVoice(tied, 'sw')?.name).toBe('B');
    expect(pickVoice([voice('A', 'sw-TZ'), voice('C', 'sw-TZ')], 'sw')?.name).toBe('A');
  });

  it('chooses British English for English, and nothing when the device has no voice for the language', () => {
    expect(pickVoice(voices, 'en')?.name).toBe('Daniel');
    expect(pickVoice([voice('Daniel', 'en-GB')], 'sw')).toBeNull();
    expect(pickVoice([], 'sw')).toBeNull();
  });
});

describe('speechSettings', () => {
  const voices = [voice('Daniel', 'en-GB'), voice('Zuri', 'sw-KE')];

  it('reads a Kiswahili segment with a Kiswahili voice', () => {
    expect(speechSettings(kiswahili[0] as (typeof kiswahili)[number], voices)).toEqual({
      lang: 'sw-KE',
      voice: voices[1],
    });
  });

  it('reads an English fallback on a Kiswahili page in English', () => {
    const [entry] = localeQueue(english, [], 'sw');
    expect(speechSettings(entry?.segment as (typeof english)[number], voices)).toEqual({
      lang: 'en-GB',
      voice: voices[0],
    });
  });

  it('still names the language when the device has no voice for it', () => {
    expect(speechSettings({ id: 'x', locale: 'sw' }, [])).toEqual({ lang: 'sw-KE', voice: null });
  });
});
