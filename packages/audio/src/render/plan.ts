/**
 * Planning a render: which narration files the current segments need, which of those the manifest
 * lacks, and which stored files no segment uses any more (reported, never deleted).
 */
import type { TtsFormat } from '@lectio/providers';

import { AUDIO_EXTENSION, audioKey } from '../script/key.ts';
import type { NarrationSegment } from '../script/segments.ts';
import { MANIFEST_KEY } from './manifest.ts';
import type { AudioManifest } from './manifest.ts';

/** One file to synthesize. Segments with identical text, locale and voice share it. */
export interface RenderPlanItem {
  /** Storage key, `audio/<locale>/<hash>.<format>`. */
  readonly key: string;
  readonly hash: string;
  /** Ids of the segments this file narrates. */
  readonly segmentIds: readonly string[];
  readonly text: string;
  readonly locale: string;
  readonly voice: string;
  /** Characters the TTS provider will bill (code points of the text). */
  readonly characters: number;
}

/** A segment left out because no voice is configured for its locale. */
export interface SkippedSegment {
  readonly segmentId: string;
  readonly locale: string;
  readonly reason: 'no-voice';
}

export interface RenderPlan {
  readonly format: TtsFormat;
  readonly ttsVersion: string;
  /** Every key the current segments use, sorted: present or not. */
  readonly wanted: readonly string[];
  /** Files missing from the manifest, in segment order. */
  readonly items: readonly RenderPlanItem[];
  /** How many wanted keys the manifest already has (and storage, when listed). */
  readonly upToDate: number;
  /** Keys with a manifest entry but no stored object; planned again (only when `storedKeys` is given). */
  readonly stale: readonly string[];
  readonly skipped: readonly SkippedSegment[];
  /** Characters the items will bill in total. */
  readonly characters: number;
}

export interface PlanRenderOptions {
  /** Voice per locale (`config.tts.voices`); `en-KE` falls back to `en`. */
  readonly voices: Readonly<Record<string, string>>;
  /** Engine version folded into every key; changing it re-renders everything. */
  readonly ttsVersion: string;
  readonly format: TtsFormat;
  /**
   * The keys in storage (from `storage.list('audio/')`). When given, a manifest entry whose object
   * is missing is treated as missing and rendered again; without it the manifest is trusted.
   */
  readonly storedKeys?: Iterable<string>;
}

/** The storage key of a segment's file: the L-080 audio key path with the format's extension. */
export function objectKeyFor(path: string, format: TtsFormat): string {
  return `${path.slice(0, -AUDIO_EXTENSION.length)}${format}`;
}

/** The format to request: mp3 when the provider offers it (the published format), else its first. */
export function pickFormat(formats: readonly TtsFormat[]): TtsFormat {
  if (formats.includes('mp3')) return 'mp3';
  const [first] = formats;
  if (first === undefined) throw new RangeError('the TTS provider offers no audio format');
  return first;
}

/** The voice for `locale` (`config.tts.voices`), falling back from `en-KE` to `en`. */
export function voiceFor(voices: Readonly<Record<string, string>>, locale: string): string | undefined {
  return voices[locale] ?? voices[String(locale.split('-')[0])];
}

/**
 * The files `segments` (approved notes, from `buildSegments`) need that `manifest` does not have.
 * Pure: storage is consulted only when rendering.
 */
export function planRender(
  segments: readonly NarrationSegment[],
  manifest: AudioManifest,
  options: PlanRenderOptions,
): RenderPlan {
  const byKey = new Map<string, { item: RenderPlanItem; segmentIds: string[] }>();
  const wanted = new Set<string>();
  const skipped: SkippedSegment[] = [];
  const stored = options.storedKeys === undefined ? undefined : new Set(options.storedKeys);
  const stale = new Set<string>();
  for (const segment of segments) {
    const voice = voiceFor(options.voices, segment.locale);
    if (voice === undefined) {
      skipped.push({ segmentId: segment.id, locale: segment.locale, reason: 'no-voice' });
      continue;
    }
    const { hash, path } = audioKey(segment, voice, options.ttsVersion);
    const key = objectKeyFor(path, options.format);
    wanted.add(key);
    if (manifest.entries[key] !== undefined) {
      if (stored === undefined || stored.has(key)) continue;
      stale.add(key);
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.segmentIds.push(segment.id);
      continue;
    }
    const segmentIds = [segment.id];
    const characters = [...segment.text].length;
    byKey.set(key, {
      item: { key, hash, segmentIds, text: segment.text, locale: segment.locale, voice, characters },
      segmentIds,
    });
  }
  const items = [...byKey.values()].map(({ item }) => item);
  return {
    format: options.format,
    ttsVersion: options.ttsVersion,
    wanted: [...wanted].sort(),
    items,
    upToDate: wanted.size - items.length,
    stale: [...stale].sort(),
    skipped,
    characters: items.reduce((sum, item) => sum + item.characters, 0),
  };
}

/** A file no current segment uses: still in the manifest, in storage, or both. */
export interface Orphan {
  readonly key: string;
  readonly inManifest: boolean;
  readonly inStorage: boolean;
}

/**
 * Files under `audio/` that the plan does not want. Old pages and shared links may still point at
 * them, so they are only reported; nothing is ever deleted automatically.
 */
export function findOrphans(plan: RenderPlan, manifest: AudioManifest, storedKeys: readonly string[]): Orphan[] {
  const wanted = new Set(plan.wanted);
  const stored = new Set(storedKeys.filter((key) => key.startsWith('audio/') && key !== MANIFEST_KEY));
  const keys = new Set([...Object.keys(manifest.entries), ...stored]);
  return [...keys]
    .filter((key) => !wanted.has(key))
    .sort()
    .map((key) => ({ key, inManifest: manifest.entries[key] !== undefined, inStorage: stored.has(key) }));
}
