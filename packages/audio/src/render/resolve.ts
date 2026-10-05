/**
 * Finding a segment's audio in the manifest without a TTS provider: the web build (L-082) and
 * the apps only have the manifest, the segment and the configured voices.
 */
import type { TtsFormat } from '@lectio/providers';

import { audioKey } from '../script/key.ts';
import type { NarrationSegment } from '../script/segments.ts';
import type { AudioManifest, ManifestEntry } from './manifest.ts';
import { objectKeyFor, voiceFor } from './plan.ts';

/**
 * Engine version per TTS provider, folded into every audio key so providers never share files.
 * Bump a provider's version to re-render everything it voiced. Listed in lookup preference order:
 * real voices before the fake.
 */
export const TTS_VERSIONS: Readonly<Record<string, string>> = { azure: 'azure-1', fake: 'fake-1' };

/** Formats in lookup preference order. */
const FORMATS: readonly TtsFormat[] = ['mp3', 'wav'];

/** The storage (and manifest) key of a segment voiced by `voice` at `ttsVersion` in `format`. */
export function manifestKeyFor(
  segment: Pick<NarrationSegment, 'text' | 'locale'>,
  voice: string,
  ttsVersion: string,
  format: TtsFormat,
): string {
  return objectKeyFor(audioKey(segment, voice, ttsVersion).path, format);
}

export interface ResolvedAudio {
  readonly key: string;
  readonly url: string;
  readonly entry: ManifestEntry;
}

/**
 * The segment's rendered file, or `null` when there is none (or no voice for its locale). Tries
 * each TTS version (default: every {@link TTS_VERSIONS} entry, real voices first) and format (mp3
 * first), and only accepts an entry whose recorded version and format match the key it sits under.
 */
export function resolveAudio(
  manifest: AudioManifest,
  segment: Pick<NarrationSegment, 'text' | 'locale'>,
  voices: Readonly<Record<string, string>>,
  ttsVersions: readonly string[] = Object.values(TTS_VERSIONS),
): ResolvedAudio | null {
  const voice = voiceFor(voices, segment.locale);
  if (voice === undefined) return null;
  for (const ttsVersion of ttsVersions) {
    for (const format of FORMATS) {
      const key = manifestKeyFor(segment, voice, ttsVersion, format);
      const entry = manifest.entries[key];
      if (entry?.ttsVersion === ttsVersion && entry.format === format) return { key, url: entry.url, entry };
    }
  }
  return null;
}
