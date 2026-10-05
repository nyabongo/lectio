/**
 * Narration audio for the site build (L-082): the audio manifest the deploy job's render step hands over, and the
 * `audio` fields and Listen-queue segments the static API publishes from it.
 *
 * The build never calls object storage or a TTS service. `npm run audio:render -- --auto --site-manifest <file>`
 * renders the missing narration first and, only when the files are published (live voice, public bucket), writes the
 * manifest to `<file>`; the deploy job then points `LECTIO_AUDIO_MANIFEST` at it. Every entry's URL already starts
 * with `config.tts.storage.publicBaseUrl`. Without the variable (no secrets, local builds) every `audio` is `null`
 * and clients fall back to device text-to-speech. The e2e build uses `test/fixtures/audio/manifest.json`, whose
 * tiny WAV files sit next to it.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { buildSegments, parseManifest, resolveAudio } from '@lectio/audio';
import type { AudioManifest, NarrationSegment } from '@lectio/audio';
import { findRepoRoot } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import type { ResolvedMass } from '@lectio/content';
import type { ApiAudio, ApiSegment } from '@lectio/schema/api';
import type { Passage } from '@lectio/schema/passage';

/** Environment variable naming the audio manifest file (relative paths start at the repository root). */
export const AUDIO_MANIFEST_ENV = 'LECTIO_AUDIO_MANIFEST';

/** What the build needs to find a segment's file: the manifest and the configured voice per locale. */
export interface SiteAudio {
  readonly manifest: AudioManifest;
  readonly voices: Readonly<Record<string, string>>;
}

export interface LoadSiteAudioOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the repository root is looked for (default `$INIT_CWD`, else the working directory). */
  readonly cwd?: string;
  readonly readFile?: (path: string) => string;
}

/** The absolute manifest path `$LECTIO_AUDIO_MANIFEST` names, or `null` when it is unset or empty. */
export function audioManifestPath(env: Readonly<Record<string, string | undefined>>, cwd: string): string | null {
  const path = env[AUDIO_MANIFEST_ENV]?.trim();
  if (path === undefined || path === '') return null;
  return isAbsolute(path) ? path : resolve(findRepoRoot(cwd), path);
}

/**
 * The manifest `$LECTIO_AUDIO_MANIFEST` names with the configured voices, or `null` without one. A set variable whose
 * file is missing or malformed fails the build: the deploy job only sets it when the render step wrote the file.
 */
export function loadSiteAudio(config: Pick<LectioConfig, 'tts'>, options: LoadSiteAudioOptions = {}): SiteAudio | null {
  const env = options.env ?? process.env;
  const path = audioManifestPath(env, options.cwd ?? env.INIT_CWD ?? process.cwd());
  if (path === null) return null;
  const read = options.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  let manifest: AudioManifest;
  try {
    manifest = parseManifest(read(path));
  } catch (error) {
    throw new Error(`${AUDIO_MANIFEST_ENV}=${path}: ${(error as Error).message}`, { cause: error });
  }
  return { manifest, voices: config.tts.voices };
}

const isPublicUrl = (url: string): boolean => /^https?:\/\/[^\s]+$/.test(url);

/**
 * A segment's `audio` as the API publishes it: its file's URL and length, or `null` when there is no manifest, no
 * file for the segment, or the entry has no public URL (a bare storage key from a local render).
 */
export function apiAudio(audio: SiteAudio | null, segment: Pick<NarrationSegment, 'text' | 'locale'>): ApiAudio {
  if (audio === null) return null;
  const found = resolveAudio(audio.manifest, segment, audio.voices);
  if (found === null || !isPublicUrl(found.url)) return null;
  const { durationMs } = found.entry;
  return { url: found.url, durationSeconds: durationMs === null ? null : durationMs / 1000 };
}

/**
 * The narration segments of one passage, in order (context, then each translation note), or none when it is not
 * approved or its locale has no narration strings. The slot only labels the queue.
 */
function passageSegments(passage: Passage, slot: ResolvedMass['readings'][number]['slot']): NarrationSegment[] {
  const day = { masses: [{ id: 'mass', readings: [{ slot, key: passage.key }] }] };
  try {
    return buildSegments(day, [passage], passage.locale);
  } catch {
    return [];
  }
}

/** The `audio` of each of the passage's segments, by segment id (`<key>/context`, `<key>/note/<id>`). */
export function passageAudio(audio: SiteAudio | null, passage: Passage): ReadonlyMap<string, ApiAudio> {
  if (audio === null) return new Map();
  return new Map(passageSegments(passage, 'gospel').map((segment) => [segment.id, apiAudio(audio, segment)]));
}

/**
 * A Mass's Listen queue: for each reading in order whose passage is approved, its context segment and then one
 * segment per translation note, each with its `audio`. A passage read twice is narrated once, under its first slot.
 * Pass the Mass with approved passages only (`approvedOnly`), as the day document does.
 */
export function massSegments(audio: SiteAudio | null, mass: Pick<ResolvedMass, 'readings'>): ApiSegment[] {
  const seen = new Set<string>();
  const segments: ApiSegment[] = [];
  for (const { slot, passage } of mass.readings) {
    if (passage === null || seen.has(passage.key)) continue;
    seen.add(passage.key);
    for (const segment of passageSegments(passage, slot)) {
      segments.push({
        id: segment.id,
        kind: segment.kind,
        slot: segment.slot,
        passageKey: segment.passageKey,
        locale: segment.locale,
        title: segment.title,
        script: segment.text,
        audio: apiAudio(audio, segment),
      });
    }
  }
  return segments;
}
