import type { LectioConfig } from '@lectio/config';

import type { Clock } from './clock.ts';
import { FakeClock } from './clock.ts';
import type { CostMeter } from './cost-meter.ts';
import { createCostMeter } from './cost-meter.ts';
import { FakeGitHubClient } from './fake-github.ts';
import { FakeLlmClient } from './fake-llm.ts';
import type { GitHubClient } from './github.ts';
import type { LlmClient } from './llm.ts';
import type { ObjectStorage } from './storage.ts';
import { FsObjectStorage, MemoryObjectStorage } from './storage.ts';
import type { TtsProvider } from './tts.ts';
import { FakeTtsProvider } from './tts.ts';
import type { SourceFetcher, WebSearch } from './web.ts';
import { FakeWebSearch, FixtureSourceFetcher, MemorySourceFetcher } from './web.ts';

/** Every provider slot. */
export interface Providers {
  /** Research generator, repair and cheap roles (`config.research.models`). */
  readonly llm: LlmClient;
  /** Verifier that confirms support (`config.verifiers.confirmer`). */
  readonly confirmer: LlmClient;
  /** Verifier from another family that tries to refute (`config.verifiers.refuter`). */
  readonly refuter: LlmClient;
  readonly webSearch: WebSearch;
  readonly fetcher: SourceFetcher;
  readonly tts: TtsProvider;
  readonly storage: ObjectStorage;
  readonly github: GitHubClient;
  readonly clock: Clock;
  /** Run-level meter with `config.research.budget.perRunUsd` as its ceiling. */
  readonly costMeter: CostMeter;
}

export type ProviderSlot = keyof Providers;

export const PROVIDER_SLOTS: readonly ProviderSlot[] = [
  'llm',
  'confirmer',
  'refuter',
  'webSearch',
  'fetcher',
  'tts',
  'storage',
  'github',
  'clock',
  'costMeter',
];

/** What a live factory receives: the shared clock and cost meter, so live clients charge the same budget. */
export interface ProviderContext {
  readonly config: LectioConfig;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;
  readonly costMeter: CostMeter;
}

/** A live implementation for a slot: an instance, or a factory that receives the shared context. */
export type LiveProvider<T> = T | ((context: ProviderContext) => T);

type ServiceSlot = Exclude<ProviderSlot, 'clock' | 'costMeter'>;

/** Live implementations to inject. `clock` and `costMeter` are instances because the context is built from them. */
export type LiveProviders = { readonly [K in ServiceSlot]?: LiveProvider<Providers[K]> } & {
  readonly clock?: Clock;
  readonly costMeter?: CostMeter;
};

export interface ProviderSet extends Providers {
  /** Slots filled by a fake (gates treat fake LLM provenance as unpublishable). */
  readonly fakes: ReadonlySet<ProviderSlot>;
}

/** Fixture directory for the fake source fetcher (`<dir>/index.json`). */
export const SOURCE_FIXTURES_ENV = 'LECTIO_SOURCE_FIXTURES';
/** Root directory for filesystem object storage when `config.tts.storage.provider` is `fs`. */
export const STORAGE_DIR_ENV = 'LECTIO_STORAGE_DIR';

function resolveLive<T>(live: LiveProvider<T> | undefined, context: ProviderContext): T | undefined {
  if (live === undefined) return undefined;
  return typeof live === 'function' ? (live as (context: ProviderContext) => T)(context) : live;
}

/**
 * The provider set for a run. Every slot is a deterministic fake unless `live` injects
 * an implementation for it. This package never imports a live provider package and
 * never throws for a missing secret: consumers decide (from `env`) which live
 * providers to inject.
 *
 * `clock` and `costMeter` are built first (live or default) and passed to every
 * factory and fake, so all LLM calls charge one budget.
 */
export function createProviders(
  config: LectioConfig,
  env: Readonly<Record<string, string | undefined>> = {},
  live: LiveProviders = {},
): ProviderSet {
  const fakes = new Set<ProviderSlot>();
  const fallback = <T>(slot: ProviderSlot, fake: () => T): T => {
    fakes.add(slot);
    return fake();
  };
  const clock = live.clock ?? fallback('clock', () => new FakeClock());
  const costMeter =
    live.costMeter ??
    fallback('costMeter', () =>
      createCostMeter({ pricing: config.pricing, ceilingUsd: config.research.budget.perRunUsd, label: 'run' }),
    );
  const context: ProviderContext = { config, env, clock, costMeter };
  const pick = <K extends ServiceSlot>(slot: K, fake: () => Providers[K]): Providers[K] =>
    resolveLive(live[slot] as LiveProvider<Providers[K]> | undefined, context) ?? fallback(slot, fake);

  const fixtures = env[SOURCE_FIXTURES_ENV];
  const storageDir = env[STORAGE_DIR_ENV];
  const providers: Providers = {
    clock,
    costMeter,
    llm: pick('llm', () => new FakeLlmClient({ costMeter })),
    confirmer: pick('confirmer', () => new FakeLlmClient({ costMeter })),
    refuter: pick('refuter', () => new FakeLlmClient({ costMeter })),
    webSearch: pick('webSearch', () => new FakeWebSearch()),
    fetcher: pick('fetcher', () =>
      fixtures ? new FixtureSourceFetcher(fixtures, clock) : new MemorySourceFetcher({}, clock),
    ),
    tts: pick('tts', () => new FakeTtsProvider()),
    storage: pick('storage', () =>
      config.tts.storage.provider === 'fs' && storageDir ? new FsObjectStorage(storageDir) : new MemoryObjectStorage(),
    ),
    github: pick('github', () => new FakeGitHubClient({ clock })),
  };
  return { ...providers, fakes };
}
