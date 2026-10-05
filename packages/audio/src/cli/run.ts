/**
 * The logic behind `npm run audio:render -- --provider fake --storage fs:.audio-out [--dry-run]`
 * (entry point: ./render.ts). Renders narration for every approved passage in the content repo.
 */
import { resolve } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import { FakeTtsProvider, FsObjectStorage, MemoryObjectStorage, systemClock } from '@lectio/providers';
import type { Clock, ObjectStorage, TtsProvider } from '@lectio/providers';

import { charactersThisMonth, readManifest } from '../render/manifest.ts';
import { findOrphans, pickFormat, planRender } from '../render/plan.ts';
import type { Orphan, RenderPlan } from '../render/plan.ts';
import { render } from '../render/render.ts';
import { buildSegments } from '../script/segments.ts';
import type { NarrationSegment } from '../script/segments.ts';

/** Engine version per provider, folded into every audio key so providers never share files. */
export const TTS_VERSIONS: Readonly<Record<string, string>> = { fake: 'fake-1' };

export interface RenderCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface RenderCliContext {
  /** Where relative paths start (`INIT_CWD`, else the working directory). */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: RenderCliIo;
  readonly clock?: Clock;
}

export interface RenderArgs {
  readonly provider: string;
  readonly storage: string;
  readonly dryRun: boolean;
  readonly concurrency: number;
  readonly retries: number;
}

export const USAGE =
  'usage: audio:render [-- --provider fake] [--storage fs:<dir>|memory] [--dry-run] [--concurrency <n>] [--retries <n>]';

const VALUE_FLAGS = new Set(['--provider', '--storage', '--concurrency', '--retries']);

/** Parses argv; returns an error message for anything it does not understand. */
export function parseRenderArgs(args: readonly string[]): RenderArgs | string {
  const values: Record<string, string> = {};
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else if (VALUE_FLAGS.has(arg) && args[i + 1] !== undefined) values[arg] = args[++i] as string;
    else return `unknown or incomplete argument ${JSON.stringify(arg)}`;
  }
  const count = (flag: string, fallback: number, min: number): number | string => {
    const raw = values[flag];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min ? n : `${flag} must be an integer of at least ${String(min)}`;
  };
  const concurrency = count('--concurrency', 4, 1);
  if (typeof concurrency === 'string') return concurrency;
  const retries = count('--retries', 2, 0);
  if (typeof retries === 'string') return retries;
  return {
    provider: values['--provider'] ?? 'fake',
    storage: values['--storage'] ?? 'fs:.audio-out',
    dryRun,
    concurrency,
    retries,
  };
}

/** The TTS provider for `--provider`. Live providers are wired in by the deploy job (L-082). */
export function ttsFor(provider: string): TtsProvider | string {
  return provider === 'fake' ? new FakeTtsProvider() : `unsupported --provider ${JSON.stringify(provider)} (fake only)`;
}

/** The storage for `--storage fs:<dir>` (relative to `cwd`) or `memory`. */
export function storageFor(spec: string, cwd: string): ObjectStorage | string {
  if (spec === 'memory') return new MemoryObjectStorage();
  if (spec.startsWith('fs:') && spec.length > 3) return new FsObjectStorage(resolve(cwd, spec.slice(3)));
  return `unsupported --storage ${JSON.stringify(spec)} (fs:<dir> or memory)`;
}

/**
 * Segments for every approved passage, each narrated in its own locale. A passage whose locale has
 * no narration strings yet is reported and skipped.
 */
export function approvedSegments(repo: ContentRepo, io: RenderCliIo): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  for (const key of repo.passageKeys()) {
    const passage = repo.passage(key);
    if (passage === null) continue;
    // The slot only labels the Listen queue; it is not part of the audio key.
    const day = { masses: [{ id: 'all', readings: [{ slot: 'gospel' as const, key }] }] };
    try {
      segments.push(...buildSegments(day, [passage], passage.locale));
    } catch (error) {
      io.err(`  skipped ${key}: ${(error as Error).message}`);
    }
  }
  return segments;
}

/** Prints the plan: counts, segments without a voice and orphaned files (which are never deleted). */
export function reportPlan(
  segmentCount: number,
  plan: RenderPlan,
  orphans: readonly Orphan[],
  remaining: number,
  io: RenderCliIo,
): void {
  io.out(
    `audio:render: ${String(segmentCount)} segments, ${String(plan.wanted.length)} files wanted, ` +
      `${String(plan.upToDate)} up to date, ${String(plan.items.length)} to render ` +
      `(${String(plan.characters)} characters of ${String(remaining)} left this month)`,
  );
  for (const { segmentId, locale } of plan.skipped) io.err(`  no voice for ${locale}: ${segmentId}`);
  if (orphans.length === 0) return;
  io.out(`  ${String(orphans.length)} orphaned file(s), not deleted:`);
  for (const orphan of orphans) {
    const where = [orphan.inManifest ? 'manifest' : '', orphan.inStorage ? 'storage' : ''].filter(Boolean);
    io.out(`    ${orphan.key} (${where.join(', ')})`);
  }
}

/** Runs the CLI; resolves to the exit code (0 done, 1 failures or budget, 2 usage). */
export async function runRender(argv: readonly string[], context: RenderCliContext): Promise<number> {
  const { io } = context;
  const args = parseRenderArgs(argv);
  if (typeof args === 'string') {
    io.err(`audio:render: ${args}\n${USAGE}`);
    return 2;
  }
  const tts = ttsFor(args.provider);
  const storage = storageFor(args.storage, context.cwd);
  for (const problem of [tts, storage]) {
    if (typeof problem === 'string') {
      io.err(`audio:render: ${problem}\n${USAGE}`);
      return 2;
    }
  }
  const ttsProvider = tts as TtsProvider;
  const store = storage as ObjectStorage;
  const clock = context.clock ?? systemClock;

  const config = loadConfig(undefined, { cwd: context.cwd, env: context.env });
  const repo = openRepo(resolve(findRepoRoot(context.cwd), config.content.root));
  const segments = approvedSegments(repo, io);
  const manifest = await readManifest(store);
  const plan = planRender(segments, manifest, {
    voices: config.tts.voices,
    ttsVersion: TTS_VERSIONS[args.provider] as string,
    format: pickFormat(ttsProvider.formats),
  });
  const orphans = findOrphans(
    plan,
    manifest,
    (await store.list('audio/')).map((info) => info.key),
  );
  const remaining = Math.max(0, config.tts.monthlyCharBudget - charactersThisMonth(manifest, clock.now()));

  reportPlan(segments.length, plan, orphans, remaining, io);
  if (plan.characters > remaining) {
    io.err(`audio:render: ${String(plan.characters)} characters exceed the ${String(remaining)} left this month`);
    return 1;
  }
  if (args.dryRun) {
    for (const item of plan.items) io.out(`  would render ${item.key} (${item.segmentIds.join(', ')})`);
    return 0;
  }

  const result = await render(plan, ttsProvider, store, {
    manifest,
    concurrency: args.concurrency,
    retries: args.retries,
    maxCharacters: remaining,
    publicBaseUrl: config.tts.storage.publicBaseUrl,
    clock,
  });
  io.out(
    `audio:render: rendered ${String(result.rendered.length)}, adopted ${String(result.adopted.length)}, ` +
      `failed ${String(result.failed.length)} (${String(result.characters)} characters billed)`,
  );
  for (const { key, error } of result.failed) io.err(`  failed ${key}: ${error.message}`);
  return result.failed.length > 0 ? 1 : 0;
}
