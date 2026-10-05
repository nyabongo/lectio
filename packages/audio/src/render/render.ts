/**
 * Rendering a plan: synthesize each missing file with bounded concurrency and retries, store it
 * under its hashed key, and record it in the manifest. Files already in storage are adopted
 * instead of synthesized again.
 */
import { ProviderError, systemClock } from '@lectio/providers';
import type { Clock, ObjectStorage, TtsProvider } from '@lectio/providers';

import { MANIFEST_VERSION, writeManifest } from './manifest.ts';
import type { AudioManifest, ManifestEntry } from './manifest.ts';
import type { RenderPlan, RenderPlanItem } from './plan.ts';

/** Hashed keys never change content, so their files cache forever. */
export const AUDIO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The plan would bill more characters than the budget allows. Nothing was synthesized. */
export class CharacterBudgetError extends Error {
  override readonly name: string = 'CharacterBudgetError';
  readonly characters: number;
  readonly budget: number;

  constructor(characters: number, budget: number) {
    super(`render needs ${String(characters)} characters but the budget allows ${String(budget)}`);
    this.characters = characters;
    this.budget = budget;
  }
}

export interface RenderOptions {
  /** Files synthesized at once. Default 4. */
  readonly concurrency?: number;
  /** Extra attempts after a retryable provider error (rate limit, outage, timeout). Default 2. */
  readonly retries?: number;
  /** First retry delay; doubles on each further attempt. Default 1000 ms. */
  readonly retryDelayMs?: number;
  /** Most characters this run may bill; checked against the whole plan before any synthesis. */
  readonly maxCharacters?: number;
  /** The manifest the plan was made from; new entries are merged into it. */
  readonly manifest: AudioManifest;
  /** Prefix for entry URLs (`config.tts.storage.publicBaseUrl`, ending in `/`); `''` keeps bare keys. */
  readonly publicBaseUrl?: string;
  readonly clock?: Clock;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RenderFailure {
  readonly key: string;
  readonly error: Error;
}

export interface RenderResult {
  /** Keys synthesized and stored by this run. */
  readonly rendered: readonly string[];
  /** Keys found in storage without a manifest entry, now recorded. */
  readonly adopted: readonly string[];
  readonly failed: readonly RenderFailure[];
  /** Characters billed by the provider. */
  readonly characters: number;
  /** The manifest after the run (written to storage when anything changed). */
  readonly manifest: AudioManifest;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Playing time of an uncompressed PCM WAV file, or `null` for anything else. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const ascii = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE' || ascii(36) !== 'data') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  if (byteRate === 0) return null;
  return Math.round((view.getUint32(40, true) * 1000) / byteRate);
}

async function runPool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function positiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

/**
 * Renders every item of `plan`: an object already in storage is adopted, anything else is
 * synthesized with `tts` and stored. A failure is recorded and the rest carry on; the manifest is
 * written once at the end with whatever succeeded. Throws {@link CharacterBudgetError} before
 * any call when the plan exceeds `maxCharacters`.
 */
export async function render(
  plan: RenderPlan,
  tts: TtsProvider,
  storage: ObjectStorage,
  options: RenderOptions,
): Promise<RenderResult> {
  const concurrency = positiveInt('concurrency', options.concurrency ?? 4);
  const retries = options.retries ?? 2;
  if (!Number.isInteger(retries) || retries < 0) throw new RangeError('retries must be a non-negative integer');
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const clock = options.clock ?? systemClock;
  const sleep = options.sleep ?? defaultSleep;
  const publicBaseUrl = options.publicBaseUrl ?? '';
  if (!tts.formats.includes(plan.format)) {
    throw new RangeError(`the TTS provider cannot produce ${plan.format}`);
  }
  if (options.maxCharacters !== undefined && plan.characters > options.maxCharacters) {
    throw new CharacterBudgetError(plan.characters, options.maxCharacters);
  }

  const entries: Record<string, ManifestEntry> = { ...options.manifest.entries };
  const rendered: string[] = [];
  const adopted: string[] = [];
  const failed: RenderFailure[] = [];
  let characters = 0;

  const entry = (
    item: RenderPlanItem,
    fields: Pick<ManifestEntry, 'bytes' | 'durationMs' | 'contentType' | 'characters'>,
  ): ManifestEntry => ({
    url: `${publicBaseUrl}${item.key}`,
    ...fields,
    voice: item.voice,
    ttsVersion: plan.ttsVersion,
    format: plan.format,
    createdAt: clock.now().toISOString(),
  });

  /** Runs `call`, retrying retryable provider errors with doubling delays. */
  const withRetries = async <T>(call: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof ProviderError && error.retryable) || attempt >= retries) throw error;
        await sleep(retryDelayMs * 2 ** attempt);
      }
    }
  };

  // Synthesis and upload retry separately, so a storage hiccup never bills the text twice.
  const synthesize = async (item: RenderPlanItem): Promise<void> => {
    const result = await withRetries(() => tts.synthesize({ text: item.text, voice: item.voice, format: plan.format }));
    characters += result.characters;
    await withRetries(() =>
      storage.put(item.key, result.audio, { contentType: result.contentType, cacheControl: AUDIO_CACHE_CONTROL }),
    );
    entries[item.key] = entry(item, {
      bytes: result.audio.length,
      durationMs: result.durationMs,
      contentType: result.contentType,
      characters: result.characters,
    });
    rendered.push(item.key);
  };

  // `head` first: only a WAV body is downloaded, to read its length from the header.
  const adopt = async (item: RenderPlanItem): Promise<boolean> => {
    const info = await storage.head(item.key);
    if (info === null) return false;
    const body = info.contentType === 'audio/wav' ? (await storage.get(item.key))?.body : undefined;
    entries[item.key] = entry(item, {
      bytes: info.size,
      durationMs: body === undefined ? null : wavDurationMs(body),
      contentType: info.contentType,
      // An object at a hashed key with no entry was almost certainly paid for by an interrupted run.
      characters: item.characters,
    });
    adopted.push(item.key);
    return true;
  };

  await runPool(plan.items, concurrency, async (item) => {
    try {
      if (!(await adopt(item))) await synthesize(item);
    } catch (error) {
      failed.push({ key: item.key, error: error instanceof Error ? error : new Error(String(error)) });
    }
  });

  const manifest: AudioManifest = { version: MANIFEST_VERSION, entries };
  if (rendered.length + adopted.length > 0) await writeManifest(storage, manifest);
  return { rendered: rendered.sort(), adopted: adopted.sort(), failed, characters, manifest };
}
