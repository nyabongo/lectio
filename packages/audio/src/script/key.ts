/**
 * Where a segment's audio lives: `audio/<locale>/<sha256>.mp3`. The hash covers what is spoken
 * and how (locale, text, voice, TTS version), not where or when it is played, so a note keeps its
 * file across days and years and is re-rendered only when its text, the voice or the TTS version
 * changes.
 */
import { createHash } from 'node:crypto';

import type { NarrationSegment } from './segments.ts';

/** Version of the hash input format; bumping it changes every key at once. */
export const AUDIO_KEY_VERSION = 1;

export const AUDIO_PREFIX = 'audio';
export const AUDIO_EXTENSION = 'mp3';

export interface AudioKey {
  /** Lower-case hex sha256 of the hash input. */
  readonly hash: string;
  /** Object-storage path, `audio/<locale>/<hash>.mp3`. */
  readonly path: string;
}

/** The segment's audio hash and storage path for `voice` (e.g. `en-GB-RyanNeural`) at `ttsVersion`. */
export function audioKey(
  segment: Pick<NarrationSegment, 'text' | 'locale'>,
  voice: string,
  ttsVersion: string | number,
): AudioKey {
  if (voice.trim() === '') throw new RangeError('voice must not be empty');
  if (String(ttsVersion).trim() === '') throw new RangeError('ttsVersion must not be empty');
  // A JSON array keeps the fields apart: no text can forge a separator.
  const input = JSON.stringify([
    AUDIO_KEY_VERSION,
    segment.locale,
    voice,
    String(ttsVersion),
    segment.text.normalize('NFC'),
  ]);
  const hash = createHash('sha256').update(input, 'utf8').digest('hex');
  return { hash, path: `${AUDIO_PREFIX}/${segment.locale}/${hash}.${AUDIO_EXTENSION}` };
}
