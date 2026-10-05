/**
 * Test helpers for the verifier gate: a gate context over in-memory files, the real seed passage
 * and pinned verdict scripts for the fake LLM clients.
 */
import { readFileSync } from 'node:fs';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { FakeLlmClient, MemorySourceFetcher, createProviders } from '@lectio/providers';
import type { FakeLlmScript, FakeLlmScriptEntry, FakeSourcePage, LiveProviders } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { createContext } from '../../core/gate.ts';
import type { GateContext } from '../../core/gate.ts';
import type { ChangedFile } from '../../core/git.ts';

export const SEED_PATH = 'passages/MT.20.1-16.json';

/** The real seed passage (passages/MT.20.1-16.json at the repository root). */
export const SEED_TEXT = readFileSync(new URL('../../../../../passages/MT.20.1-16.json', import.meta.url), 'utf8');
export const SEED = JSON.parse(SEED_TEXT) as Passage;

/** The seed with only its first `n` claims (sources unchanged). */
export function seedWithClaims(n: number): string {
  return JSON.stringify({ ...SEED, claims: SEED.claims.slice(0, n) });
}

/** A pinned verdict (never rely on the fake's schema defaults). */
export function verdict(
  value: Partial<{ verdict: string; support: number; sensitive: boolean; rationale: string }> = {},
): FakeLlmScript {
  return {
    patch: { verdict: 'supported', support: 0.95, sensitive: false, rationale: 'The source says so.', ...value },
  };
}

export interface TestContextOptions {
  readonly files?: Readonly<Record<string, string>>;
  readonly changed?: readonly ChangedFile[];
  readonly mode?: LectioConfig['verifiers']['mode'];
  readonly config?: LectioConfig;
  /** Scripts for fake confirmer and refuter clients, injected as live slots. */
  readonly confirmer?: FakeLlmScriptEntry;
  readonly refuter?: FakeLlmScriptEntry;
  /** Other live slots (overrides the fake verifier clients above). */
  readonly live?: LiveProviders;
  readonly pages?: Readonly<Record<string, FakeSourcePage>>;
}

export interface TestContext {
  readonly context: GateContext;
  readonly confirmer: FakeLlmClient;
  readonly refuter: FakeLlmClient;
  readonly fetcher: MemorySourceFetcher;
}

export function testContext(options: TestContextOptions = {}): TestContext {
  const files = options.files ?? { [SEED_PATH]: SEED_TEXT };
  const changed: readonly ChangedFile[] =
    options.changed ?? Object.keys(files).map((path) => ({ path, status: 'added' as const }));
  const base = options.config ?? DEFAULT_CONFIG;
  const config: LectioConfig = { ...base, verifiers: { ...base.verifiers, mode: options.mode ?? 'fake' } };
  const confirmer = new FakeLlmClient({ roles: { confirmer: options.confirmer ?? verdict() } });
  const refuter = new FakeLlmClient({ roles: { refuter: options.refuter ?? verdict() } });
  const fetcher = new MemorySourceFetcher(options.pages ?? {});
  const providers = createProviders(config, {}, { confirmer, refuter, fetcher, ...options.live });
  const context = createContext({
    root: '/repo',
    base: 'origin/main',
    head: 'HEAD',
    config,
    providers,
    git: { changedFiles: () => [...changed], show: () => null },
    readText: (path) => files[path.slice('/repo/'.length)] ?? null,
  });
  return { context, confirmer, refuter, fetcher };
}
