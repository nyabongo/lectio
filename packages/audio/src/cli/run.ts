/**
 * The logic behind `npm run audio:render -- --provider fake --storage fs:.audio-out [--dry-run]`
 * (entry point: ./render.ts). Renders narration for every approved passage in the content repo,
 * and for the approved translations of each `--locale`, in one plan.
 *
 * Live providers are wired in here, not in `createProviders` (L-082): `--provider azure` and
 * `--storage s3` compose `createProviders(config, env, { tts: azureTts, storage: s3StorageProvider })`
 * from their secrets. `--auto` is what the deploy job runs: live when every secret and
 * `tts.storage.publicBaseUrl` are present, otherwise the fake voice into local storage, which is
 * never published.
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import {
  AZURE_SPEECH_KEY_ENV,
  AZURE_SPEECH_REGION_ENV,
  azureTts,
  hasAzureTtsSecrets,
} from '@lectio/provider-azure-tts';
import { S3_ENV, hasS3Secrets, s3StorageProvider } from '@lectio/provider-s3';
import {
  FakeTtsProvider,
  FsObjectStorage,
  MemoryObjectStorage,
  ProviderError,
  createProviders,
  systemClock,
} from '@lectio/providers';
import type {
  Clock,
  LiveProvider,
  ObjectStorage,
  TtsFormat,
  TtsProvider,
  TtsRequest,
  TtsResult,
} from '@lectio/providers';

import { localeSegments } from '../locale/repo.ts';
import { charactersThisMonth, readManifest, serializeManifest } from '../render/manifest.ts';
import { findOrphans, pickFormat, planRender } from '../render/plan.ts';
import type { Orphan, RenderPlan } from '../render/plan.ts';
import { render } from '../render/render.ts';
import type { RenderResult } from '../render/render.ts';
import { TTS_VERSIONS } from '../render/resolve.ts';
import { buildSegments } from '../script/segments.ts';
import type { NarrationSegment } from '../script/segments.ts';

export interface RenderCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

type Env = Readonly<Record<string, string | undefined>>;

export interface RenderCliContext {
  /** Where relative paths start (`INIT_CWD`, else the working directory). */
  readonly cwd: string;
  readonly env: Env;
  readonly io: RenderCliIo;
  readonly clock?: Clock;
  /** The live factories (default `azureTts` and `s3StorageProvider`); tests inject stand-ins. */
  readonly live?: LiveFactories;
}

export interface LiveFactories {
  readonly tts?: LiveProvider<TtsProvider>;
  readonly storage?: LiveProvider<ObjectStorage>;
}

export interface RenderArgs {
  /** `--provider`; `undefined` means `config.tts.provider`. */
  readonly provider: string | undefined;
  /** `--storage`; `undefined` means the one `config.tts.storage.provider` names. */
  readonly storage: string | undefined;
  readonly dryRun: boolean;
  readonly concurrency: number;
  /** `--retries`; `undefined` means {@link defaultRetries} for the provider. */
  readonly retries: number | undefined;
  /** `--auto`: live providers when their secrets are present, else the fake (see {@link autoTargets}). */
  readonly auto: boolean;
  /** `--locale <tag>` (repeatable): also narrate the approved translations in these locales. */
  readonly locales: readonly string[];
  /** `--site-manifest <file>`: the manifest for the web build, written only when its files are published. */
  readonly siteManifest: string | undefined;
  /** `--summary <file>`: Markdown appended here (the deploy job passes `$GITHUB_STEP_SUMMARY`). */
  readonly summary: string | undefined;
}

export const USAGE =
  'usage: audio:render [-- --provider fake|azure] [--storage fs:<dir>|memory|s3] [--auto] [--locale <tag>]... ' +
  '[--site-manifest <file>] [--summary <file>] [--dry-run] [--concurrency <n>] [--retries <n>]';

const VALUE_FLAGS = new Set(['--provider', '--storage', '--concurrency', '--retries', '--site-manifest', '--summary']);

/** Parses argv; returns an error message for anything it does not understand. */
export function parseRenderArgs(args: readonly string[]): RenderArgs | string {
  const values: Record<string, string> = {};
  const locales: string[] = [];
  let dryRun = false;
  let auto = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const next = args[i + 1];
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--auto') auto = true;
    else if (arg === '--locale' && next !== undefined) locales.push(args[++i] as string);
    else if (VALUE_FLAGS.has(arg) && next !== undefined) values[arg] = args[++i] as string;
    else return `unknown or incomplete argument ${JSON.stringify(arg)}`;
  }
  if (auto && (values['--provider'] !== undefined || values['--storage'] !== undefined)) {
    return '--auto picks the provider and storage itself; drop --provider and --storage';
  }
  const count = (flag: string, fallback: number, min: number): number | string => {
    const raw = values[flag];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min ? n : `${flag} must be an integer of at least ${String(min)}`;
  };
  const concurrency = count('--concurrency', 4, 1);
  if (typeof concurrency === 'string') return concurrency;
  const retries = values['--retries'] === undefined ? undefined : count('--retries', 0, 0);
  if (typeof retries === 'string') return retries;
  return {
    provider: values['--provider'],
    storage: values['--storage'],
    dryRun,
    concurrency,
    retries,
    auto,
    locales,
    siteManifest: values['--site-manifest'],
    summary: values['--summary'],
  };
}

/**
 * Render-level retries when `--retries` is not given: 1 for a live voice, whose client already
 * retries each request itself (stacked retries multiply the requests per chunk), else 2.
 */
export function defaultRetries(provider: string): number {
  return provider === 'fake' ? 2 : 1;
}

/** Directory for `fs` storage when `--storage` is not given (as in `createProviders`). */
export const STORAGE_DIR_ENV = 'LECTIO_STORAGE_DIR';

/**
 * The provider and storage specs to use: the flags, else what the config names (`fs` storage in
 * `$LECTIO_STORAGE_DIR`, default `.audio-out`). Warns when a flag overrides the config.
 */
export function resolveTargets(
  args: Pick<RenderArgs, 'provider' | 'storage'>,
  config: LectioConfig,
  env: Env,
  io: RenderCliIo,
): { readonly provider: string; readonly storage: string } {
  const storageKind = config.tts.storage.provider;
  const storageDefault = storageKind === 'fs' ? `fs:${env[STORAGE_DIR_ENV] || '.audio-out'}` : storageKind;
  const provider = args.provider ?? config.tts.provider;
  const storage = args.storage ?? storageDefault;
  if (provider !== config.tts.provider) {
    io.err(`  warning: --provider ${provider} overrides tts.provider ${config.tts.provider}`);
  }
  const kind = storage === 'memory' ? 'memory' : storage.split(':')[0];
  if (kind !== storageKind) {
    io.err(`  warning: --storage ${storage} overrides tts.storage.provider ${storageKind}`);
  }
  return { provider, storage };
}

/** What the live providers need, for messages. */
const AZURE_NEEDS = `${AZURE_SPEECH_KEY_ENV} and ${AZURE_SPEECH_REGION_ENV}`;
const S3_NEEDS =
  `${S3_ENV.bucket}, ${S3_ENV.accessKeyId}, ${S3_ENV.secretAccessKey} ` +
  `and ${S3_ENV.endpoint} or ${S3_ENV.r2AccountId}`;

/**
 * The TTS provider for `--provider`: the fake, or Azure composed through `createProviders` when
 * its secrets are in `env`.
 */
export function ttsFor(
  provider: string,
  config: LectioConfig,
  env: Env = {},
  live: LiveProvider<TtsProvider> = azureTts,
): TtsProvider | string {
  if (provider === 'fake') return new FakeTtsProvider();
  if (provider !== 'azure') return `unsupported --provider ${JSON.stringify(provider)} (fake or azure)`;
  if (!hasAzureTtsSecrets(env)) return `--provider azure needs ${AZURE_NEEDS} in the environment`;
  return createProviders(config, env, { tts: live }).tts;
}

/**
 * The storage for `--storage fs:<dir>` (relative to `cwd`), `memory`, or `s3` composed through
 * `createProviders` when its secrets are in `env`.
 */
export function storageFor(
  spec: string,
  cwd: string,
  config: LectioConfig,
  env: Env = {},
  live: LiveProvider<ObjectStorage> = s3StorageProvider,
): ObjectStorage | string {
  if (spec === 'memory') return new MemoryObjectStorage();
  if (spec.startsWith('fs:') && spec.length > 3) return new FsObjectStorage(resolve(cwd, spec.slice(3)));
  if (spec !== 's3') return `unsupported --storage ${JSON.stringify(spec)} (fs:<dir>, memory or s3)`;
  if (!hasS3Secrets(env)) return `--storage s3 needs ${S3_NEEDS} in the environment`;
  return createProviders(config, env, { storage: live }).storage;
}

/** What `--auto` picked, and why. */
export interface AutoTargets {
  readonly provider: string;
  readonly storage: string;
  /** True for live audio (Azure into S3), whose files are published. */
  readonly live: boolean;
  /** What is missing for live audio (empty when live). */
  readonly missing: readonly string[];
}

/**
 * `--auto`: Azure into S3 when both sets of secrets and `tts.storage.publicBaseUrl` are present;
 * otherwise the fake voice into fs storage (`$LECTIO_STORAGE_DIR`, default `.audio-out`), which is
 * never published. Fake and live audio never share a store.
 */
export function autoTargets(config: LectioConfig, env: Env): AutoTargets {
  const missing: string[] = [];
  if (!hasAzureTtsSecrets(env)) missing.push(AZURE_NEEDS);
  if (!hasS3Secrets(env)) missing.push(S3_NEEDS);
  if (config.tts.storage.publicBaseUrl === '') missing.push('tts.storage.publicBaseUrl in the config');
  if (missing.length === 0) return { provider: 'azure', storage: 's3', live: true, missing };
  return { provider: 'fake', storage: `fs:${env[STORAGE_DIR_ENV] || '.audio-out'}`, live: false, missing };
}

/**
 * Wraps a TTS provider so the characters it bills never pass `limit` (what is left of
 * `tts.monthlyCharBudget` this month). The plan's estimate is checked before rendering; this meters
 * what the provider reports in `result.characters`, reserving each request's length while it is in
 * flight so concurrent requests cannot overshoot together.
 */
export class MeteredTtsProvider implements TtsProvider {
  readonly formats: readonly TtsFormat[];
  readonly #inner: TtsProvider;
  readonly #limit: number;
  #billed = 0;
  #reserved = 0;

  constructor(inner: TtsProvider, limit: number) {
    this.#inner = inner;
    this.#limit = limit;
    this.formats = inner.formats;
  }

  /** Characters billed so far. */
  get billed(): number {
    return this.#billed;
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const estimate = [...request.text].length;
    if (this.#billed + this.#reserved + estimate > this.#limit) {
      throw new ProviderError(
        'invalid-request',
        `monthly character budget: ${String(this.#billed)} billed, ${String(estimate)} more would pass ` +
          `the ${String(this.#limit)} left`,
        { retryable: false },
      );
    }
    this.#reserved += estimate;
    try {
      const result = await this.#inner.synthesize(request);
      this.#billed += result.characters;
      return result;
    } finally {
      this.#reserved -= estimate;
    }
  }
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

/**
 * Segments for the approved, fresh translations in each of `locales` (`--locale sw`). Translations
 * that may not be narrated, and locales without narration strings, are reported and skipped.
 */
export function translationSegments(
  repo: ContentRepo,
  locales: readonly string[],
  io: RenderCliIo,
): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  for (const locale of locales) {
    try {
      const result = localeSegments(repo, locale);
      segments.push(...result.segments);
      for (const { key, reason } of result.skipped) io.err(`  skipped ${locale} ${key}: ${reason}`);
    } catch (error) {
      io.err(`  skipped locale ${locale}: ${(error as Error).message}`);
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
  for (const key of plan.stale) io.err(`  missing from storage, rendering again: ${key}`);
  if (orphans.length === 0) return;
  io.out(`  ${String(orphans.length)} orphaned file(s), not deleted:`);
  for (const orphan of orphans) {
    const where = [orphan.inManifest ? 'manifest' : '', orphan.inStorage ? 'storage' : ''].filter(Boolean);
    io.out(`    ${orphan.key} (${where.join(', ')})`);
  }
}

/** What the job summary reports about a run. */
export interface RenderSummary {
  readonly provider: string;
  readonly storage: string;
  /** From `--auto`; `undefined` when the provider and storage were chosen by flags or config. */
  readonly auto?: AutoTargets;
  /** Whether the manifest went to `--site-manifest` (the site links the files). */
  readonly published: boolean;
  readonly segments?: number;
  readonly plan?: RenderPlan;
  readonly result?: RenderResult;
  /** Why the run stopped early (budget, failure), if it did. */
  readonly problem?: string;
}

/** The Markdown the deploy job appends to its summary. */
export function summaryMarkdown(summary: RenderSummary): string {
  const lines = ['### Narration', ''];
  const { auto } = summary;
  if (auto !== undefined && !auto.live) {
    lines.push(
      `Rendered with the fake voice into \`${summary.storage}\`: **no audio is published** and every \`audio\` ` +
        'field stays `null`. The files are uploaded as a workflow artifact only.',
      '',
      `Live audio needs: ${auto.missing.join('; ')}.`,
    );
  } else {
    lines.push(`Provider \`${summary.provider}\`, storage \`${summary.storage}\`.`);
  }
  lines.push('');
  if (summary.plan !== undefined) {
    const { plan } = summary;
    lines.push(
      `- ${String(summary.segments)} segments, ${String(plan.wanted.length)} files wanted, ` +
        `${String(plan.upToDate)} up to date, ${String(plan.items.length)} to render`,
    );
  }
  if (summary.result !== undefined) {
    const { result } = summary;
    lines.push(
      `- rendered ${String(result.rendered.length)}, adopted ${String(result.adopted.length)}, ` +
        `failed ${String(result.failed.length)} (${String(result.characters)} characters billed)`,
    );
  }
  lines.push(`- site audio: ${summary.published ? 'manifest handed to the web build' : 'none (all `audio` null)'}`);
  if (summary.problem !== undefined) lines.push('', `**Stopped:** ${summary.problem}`);
  return `${lines.join('\n')}\n`;
}

async function writeText(path: string, text: string, append: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await (append ? appendFile(path, text) : writeFile(path, text));
}

/** Runs the CLI; resolves to the exit code (0 done, 1 failures or budget, 2 usage). */
export async function runRender(argv: readonly string[], context: RenderCliContext): Promise<number> {
  const { io, env, cwd } = context;
  const args = parseRenderArgs(argv);
  if (typeof args === 'string') {
    io.err(`audio:render: ${args}\n${USAGE}`);
    return 2;
  }
  const config = loadConfig(undefined, { cwd, env });
  const auto = args.auto ? autoTargets(config, env) : undefined;
  if (auto !== undefined) {
    io.out(
      auto.live
        ? 'audio:render: --auto: live voice (azure) into s3'
        : `audio:render: --auto: fake voice into ${auto.storage}, not published (missing ${auto.missing.join('; ')})`,
    );
  }
  const targets = auto ?? resolveTargets(args, config, env, io);
  const tts = ttsFor(targets.provider, config, env, context.live?.tts);
  const storage = storageFor(targets.storage, cwd, config, env, context.live?.storage);
  for (const problem of [tts, storage]) {
    if (typeof problem === 'string') {
      io.err(`audio:render: ${problem}\n${USAGE}`);
      return 2;
    }
  }
  // Fake audio is never published: its entries keep bare keys, and the site gets no manifest.
  const published = auto === undefined ? config.tts.storage.publicBaseUrl !== '' : auto.live;
  const summary: { -readonly [K in keyof RenderSummary]: RenderSummary[K] } = {
    provider: targets.provider,
    storage: targets.storage,
    published: false,
    ...(auto === undefined ? {} : { auto }),
  };
  const finish = async (code: number): Promise<number> => {
    if (args.summary !== undefined) await writeText(resolve(cwd, args.summary), summaryMarkdown(summary), true);
    return code;
  };

  try {
    const code = await renderAll(args, context, {
      config,
      provider: targets.provider,
      tts: tts as TtsProvider,
      store: storage as ObjectStorage,
      published,
      summary,
    });
    return await finish(code);
  } catch (error) {
    summary.problem = (error as Error).message;
    io.err(`audio:render: ${summary.problem}`);
    return finish(1);
  }
}

interface RenderSetup {
  readonly config: LectioConfig;
  readonly provider: string;
  readonly tts: TtsProvider;
  readonly store: ObjectStorage;
  readonly published: boolean;
  readonly summary: { -readonly [K in keyof RenderSummary]: RenderSummary[K] };
}

async function renderAll(args: RenderArgs, context: RenderCliContext, setup: RenderSetup): Promise<number> {
  const { io, cwd } = context;
  const { config, provider, store, summary } = setup;
  const clock = context.clock ?? systemClock;

  const repo = openRepo(resolve(findRepoRoot(cwd), config.content.root));
  const segments = [...approvedSegments(repo, io), ...translationSegments(repo, args.locales, io)];
  const manifest = await readManifest(store);
  const storedKeys = (await store.list('audio/')).map((info) => info.key);
  const plan = planRender(segments, manifest, {
    voices: config.tts.voices,
    ttsVersion: TTS_VERSIONS[provider] as string,
    format: pickFormat(setup.tts.formats),
    storedKeys,
  });
  const orphans = findOrphans(plan, manifest, storedKeys);
  const remaining = Math.max(0, config.tts.monthlyCharBudget - charactersThisMonth(manifest, clock.now()));
  summary.segments = segments.length;
  summary.plan = plan;

  reportPlan(segments.length, plan, orphans, remaining, io);
  if (plan.characters > remaining) {
    summary.problem = `${String(plan.characters)} characters exceed the ${String(remaining)} left this month`;
    io.err(`audio:render: ${summary.problem}`);
    return 1;
  }
  if (args.dryRun) {
    for (const item of plan.items) io.out(`  would render ${item.key} (${item.segmentIds.join(', ')})`);
    return 0;
  }

  const result = await render(plan, new MeteredTtsProvider(setup.tts, remaining), store, {
    manifest,
    concurrency: args.concurrency,
    retries: args.retries ?? defaultRetries(provider),
    maxCharacters: remaining,
    publicBaseUrl: setup.published ? config.tts.storage.publicBaseUrl : '',
    clock,
  });
  summary.result = result;
  io.out(
    `audio:render: rendered ${String(result.rendered.length)}, adopted ${String(result.adopted.length)}, ` +
      `failed ${String(result.failed.length)} (${String(result.characters)} characters billed)`,
  );
  for (const { key, error } of result.failed) io.err(`  failed ${key}: ${error.message}`);

  if (args.siteManifest !== undefined) {
    if (setup.published) {
      await writeText(resolve(cwd, args.siteManifest), serializeManifest(result.manifest), false);
      summary.published = true;
      io.out(`audio:render: site manifest written to ${args.siteManifest}`);
    } else {
      io.out('audio:render: no site manifest: these files are not published');
    }
  }
  return result.failed.length > 0 ? 1 : 0;
}
