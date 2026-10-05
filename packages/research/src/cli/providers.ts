/**
 * Provider wiring for the CLI. `live` composes `createProviders(config, env, { llm, github, fetcher })`
 * from provider-anthropic, provider-gh and provider-fetch; a missing key or a gh that is not
 * logged in is a clear error, never a silent fake. `fake` uses the deterministic fakes and an
 * in-memory GitHub, so nothing leaves the machine.
 */
import type { LectioConfig } from '@lectio/config';
import { ANTHROPIC_API_KEY_ENV, AnthropicLlmClient } from '@lectio/provider-anthropic';
import type { AnthropicLlmClientOptions } from '@lectio/provider-anthropic';
import { LiveSourceFetcher } from '@lectio/provider-fetch';
import type { LiveSourceFetcherOptions } from '@lectio/provider-fetch';
import { GhGitHubClient } from '@lectio/provider-gh';
import type { GhGitHubClientOptions } from '@lectio/provider-gh';
import { FakeGitHubClient, FakeLlmClient, createCostMeter, createProviders, systemClock } from '@lectio/providers';
import type {
  Clock,
  CostMeter,
  GitHubClient,
  LlmClient,
  LlmFamily,
  LlmRequest,
  LlmResponse,
  ProviderSet,
  SourceFetcher,
} from '@lectio/providers';

import type { ProviderMode } from './args.ts';

/** Constructors of the live providers (injected in tests). */
export interface LiveFactories {
  readonly anthropic: (options: AnthropicLlmClientOptions) => LlmClient;
  readonly gh: (options: GhGitHubClientOptions) => GitHubClient;
  readonly fetcher: (options: LiveSourceFetcherOptions) => SourceFetcher;
}

export const LIVE_FACTORIES: LiveFactories = {
  anthropic: (options) => new AnthropicLlmClient(options),
  gh: (options) => new GhGitHubClient(options),
  fetcher: (options) => new LiveSourceFetcher(options),
};

/** A configuration or environment problem that keeps live providers from starting. */
export class ProviderSetupError extends Error {
  override readonly name = 'ProviderSetupError';
}

/** What a command runs on. */
export interface Toolkit {
  readonly mode: ProviderMode;
  readonly github: GitHubClient;
  /** Builds the LLM client for one passage; it charges `meter`. */
  readonly llm: (meter: CostMeter) => LlmClient;
  /** The family of the generator, for drafts whose model output had no response. */
  readonly family: LlmFamily;
  /** The run's providers (the gates use its fetcher). */
  readonly providers: ProviderSet;
  readonly clock: Clock;
  /** The run meter, label `research-run`, capped at the run ceiling. */
  readonly meter: CostMeter;
}

export interface ComposeOptions {
  readonly mode: ProviderMode;
  readonly config: LectioConfig;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The run ceiling in USD. */
  readonly ceilingUsd: number;
  /** False for commands that never call an LLM (`plan`): no API key is needed. */
  readonly llm: boolean;
  readonly factories?: LiveFactories;
  readonly clock?: Clock;
}

/**
 * Routes `cheap` calls (Claude Haiku, which does not think) to a client without a thinking
 * allowance and every other role to the default client; both charge the same meter.
 */
export class RoleRoutedLlm implements LlmClient {
  readonly family: LlmFamily;
  readonly #main: LlmClient;
  readonly #cheap: LlmClient;

  constructor(main: LlmClient, cheap: LlmClient) {
    this.family = main.family;
    this.#main = main;
    this.#cheap = cheap;
  }

  generate(request: LlmRequest): Promise<LlmResponse> {
    return (request.role === 'cheap' ? this.#cheap : this.#main).generate(request);
  }
}

function liveLlm(config: LectioConfig, env: ComposeOptions['env'], factories: LiveFactories): LiveLlm {
  const { models } = config.research;
  for (const role of ['generator', 'repair', 'cheap'] as const) {
    if (models[role].family !== 'anthropic') {
      throw new ProviderSetupError(
        `research.models.${role} is a ${models[role].family} model; the research CLI only wires the Anthropic provider`,
      );
    }
  }
  const apiKey = env[ANTHROPIC_API_KEY_ENV];
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new ProviderSetupError(
      `${ANTHROPIC_API_KEY_ENV} is not set: export it in the shell that runs research, ` +
        'or use --provider fake for a dry run',
    );
  }
  const tools = config.tools.anthropic;
  return (meter) =>
    new RoleRoutedLlm(
      factories.anthropic({ costMeter: meter, apiKey, tools }),
      factories.anthropic({ costMeter: meter, apiKey, tools, thinkingTokens: 0 }),
    );
}

type LiveLlm = (meter: CostMeter) => LlmClient;

async function liveGitHub(factories: LiveFactories): Promise<GitHubClient> {
  let viewer: string;
  try {
    viewer = await factories.gh({}).viewer();
  } catch (error) {
    throw new ProviderSetupError(
      `gh could not tell who you are (${(error as Error).message}): run \`gh auth login\` and try again`,
    );
  }
  return factories.gh({ viewer });
}

/** The providers for one command. */
export async function composeProviders(options: ComposeOptions): Promise<Toolkit> {
  const { mode, config, env, ceilingUsd } = options;
  const clock = options.clock ?? systemClock;
  const meter = createCostMeter({ pricing: config.pricing, ceilingUsd, label: 'research-run' });
  if (mode === 'fake') {
    const github = new FakeGitHubClient({ clock });
    const llm = (child: CostMeter): LlmClient => new FakeLlmClient({ costMeter: child });
    const providers = createProviders(config, env, { clock, costMeter: meter, github, llm: llm(meter) });
    return { mode, github, llm, family: 'fake', providers, clock, meter };
  }
  const factories = options.factories ?? LIVE_FACTORIES;
  const llm = options.llm ? liveLlm(config, env, factories) : undefined;
  const github = await liveGitHub(factories);
  const providers = createProviders(config, env, {
    clock,
    costMeter: meter,
    github,
    fetcher: factories.fetcher({ clock }),
    ...(llm === undefined ? {} : { llm: llm(meter) }),
  });
  const noLlm: LiveLlm = () => {
    throw new ProviderSetupError('this command does not call an LLM');
  };
  return { mode, github, llm: llm ?? noLlm, family: 'anthropic', providers, clock, meter };
}
