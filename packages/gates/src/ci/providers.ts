/**
 * The provider set for a gate run, composed at the edge (ADR 0005):
 *
 *     createProviders(config, env, { github: provider-gh, fetcher: provider-fetch,
 *                                    confirmer: provider-anthropic, refuter: provider-openai })
 *
 * Each live client is injected only when it is asked for and its secret is present; every other
 * slot stays a deterministic fake. `lectio-gates run --fetch live` (content-gates.yml) fetches
 * sources over HTTP with the SSRF guard on; `--fetch fixtures` (the default, ci.yml and local runs)
 * keeps the offline fake, where every web source reads as missing. `--llm live` injects the
 * verifier clients for whichever of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set; without both, the
 * verifiers gate (mode `auto`) is skipped and the merge rule asks for review.
 */
import type { LectioConfig } from '@lectio/config';
import { ANTHROPIC_API_KEY_ENV, createAnthropicLlmClient } from '@lectio/provider-anthropic';
import { LiveSourceFetcher } from '@lectio/provider-fetch';
import { createOpenAiRefuter, hasOpenAiKey } from '@lectio/provider-openai';
import { createCostMeter, createProviders, systemClock } from '@lectio/providers';
import type { GitHubClient, LiveProviders, ProviderSet } from '@lectio/providers';

export const FETCH_MODES = ['live', 'fixtures'] as const;
export type FetchMode = (typeof FETCH_MODES)[number];

export const LLM_MODES = ['live', 'off'] as const;
export type LlmMode = (typeof LLM_MODES)[number];

export interface GateProviderOptions {
  readonly fetch: FetchMode;
  readonly llm: LlmMode;
  /** A live GitHub client, when the caller has a token (the gates themselves do not need one). */
  readonly github?: GitHubClient;
}

type Env = Readonly<Record<string, string | undefined>>;

const hasKey = (env: Env, name: string): boolean => (env[name] ?? '').length > 0;

/** The live clients for `options`, given the secrets in `env`. */
export function liveGateProviders(config: LectioConfig, env: Env, options: GateProviderOptions): LiveProviders {
  const live: {
    -readonly [K in keyof LiveProviders]: LiveProviders[K];
  } = {};
  if (options.github !== undefined) live.github = options.github;
  if (options.fetch === 'live') live.fetcher = () => new LiveSourceFetcher();
  if (options.llm === 'live') {
    if (config.verifiers.confirmer.family === 'anthropic' && hasKey(env, ANTHROPIC_API_KEY_ENV))
      live.confirmer = (context) => createAnthropicLlmClient(context);
    if (config.verifiers.refuter.family === 'openai' && hasOpenAiKey(env))
      live.refuter = (context) => createOpenAiRefuter(context);
  }
  if (Object.keys(live).length > 0) {
    // Live clients stamp real times and charge their own meter, not the research budget.
    live.clock = systemClock;
    live.costMeter = createCostMeter({
      pricing: config.pricing,
      ceilingUsd: config.research.budget.perRunUsd,
      label: 'content-gates',
    });
  }
  return live;
}

/** The provider set for a gate run. */
export function gateProviders(config: LectioConfig, env: Env, options: GateProviderOptions): ProviderSet {
  return createProviders(config, env, liveGateProviders(config, env, options));
}

/** One line for the log and the PR comment saying how sources were fetched. */
export function fetcherNote(providers: Pick<ProviderSet, 'fakes'>): string {
  return providers.fakes.has('fetcher')
    ? 'Offline run: sources were checked with the offline fake fetcher, so every web source reads as missing (expect commentary-unchecked warnings). content-gates.yml runs with the live fetcher.'
    : 'Sources were fetched live (provider-fetch, SSRF guard on).';
}
