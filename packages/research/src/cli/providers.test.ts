import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { AnthropicLlmClient } from '@lectio/provider-anthropic';
import type { AnthropicLlmClientOptions } from '@lectio/provider-anthropic';
import { LiveSourceFetcher } from '@lectio/provider-fetch';
import { GhGitHubClient } from '@lectio/provider-gh';
import type { GhGitHubClientOptions } from '@lectio/provider-gh';
import {
  FakeClock,
  FakeGitHubClient,
  FakeLlmClient,
  MemorySourceFetcher,
  ProviderError,
  systemClock,
} from '@lectio/providers';
import type { LlmClient, LlmRequest } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { LIVE_FACTORIES, ProviderSetupError, RoleRoutedLlm, composeProviders } from './providers.ts';
import type { LiveFactories } from './providers.ts';

const clock = new FakeClock({ start: '2026-10-05T07:50:00Z' });
const KEY_ENV = { ANTHROPIC_API_KEY: 'sk-test' };

function request(role: LlmRequest['role']): LlmRequest {
  return { role, system: 's', messages: [{ role: 'user', content: 'u' }], model: 'claude-opus-5-5', maxTokens: 10 };
}

function factories(viewer: () => Promise<string> = () => Promise.resolve('nyabongo')) {
  const anthropic: AnthropicLlmClientOptions[] = [];
  const gh: GhGitHubClientOptions[] = [];
  const fetchers: unknown[] = [];
  const github = Object.assign(new FakeGitHubClient({ clock }), { viewer });
  const made: LiveFactories = {
    anthropic: (options) => {
      anthropic.push(options);
      return new FakeLlmClient({ costMeter: options.costMeter });
    },
    gh: (options) => {
      gh.push(options);
      return github;
    },
    fetcher: (options) => {
      fetchers.push(options);
      return new MemorySourceFetcher({}, clock);
    },
  };
  return { made, anthropic, gh, fetchers, github };
}

describe('composeProviders: fake', () => {
  it('uses the in-memory GitHub, the fake LLM and a run meter at the ceiling', async () => {
    const kit = await composeProviders({
      mode: 'fake',
      config: DEFAULT_CONFIG,
      env: {},
      ceilingUsd: 4,
      llm: true,
      clock,
    });
    expect(kit.mode).toBe('fake');
    expect(kit.family).toBe('fake');
    expect(kit.github).toBeInstanceOf(FakeGitHubClient);
    expect(kit.meter).toMatchObject({ label: 'research-run', ceilingUsd: 4 });
    expect(kit.clock).toBe(clock);
    const child = kit.meter.scope('passage:X', 1);
    const llm = kit.llm(child);
    expect(llm).toBeInstanceOf(FakeLlmClient);
    await llm.generate(request('generator'));
    expect(child.spentUsd()).toBeGreaterThan(0);
    expect(kit.providers.github).toBe(kit.github);
  });

  it('defaults to the system clock', async () => {
    const kit = await composeProviders({ mode: 'fake', config: DEFAULT_CONFIG, env: {}, ceilingUsd: 1, llm: false });
    expect(kit.clock).toBe(systemClock);
  });
});

describe('composeProviders: live', () => {
  it('wires provider-anthropic per meter, gh with its viewer and the live fetcher', async () => {
    const f = factories();
    const kit = await composeProviders({
      mode: 'live',
      config: DEFAULT_CONFIG,
      env: KEY_ENV,
      ceilingUsd: 10,
      llm: true,
      clock,
      factories: f.made,
    });
    expect(kit.family).toBe('anthropic');
    expect(f.gh).toEqual([{}, { viewer: 'nyabongo' }]);
    expect(kit.github).toBe(f.github);
    expect(f.fetchers).toEqual([{ clock }]);
    expect(kit.providers.fakes.has('fetcher')).toBe(false);
    expect(kit.providers.fakes.has('llm')).toBe(false);
    expect(kit.providers.fakes.has('github')).toBe(false);

    const child = kit.meter.scope('passage:X', 1);
    expect(kit.llm(child)).toBeInstanceOf(RoleRoutedLlm);
    const calls = f.anthropic.slice(-2);
    expect(calls[0]).toEqual({ costMeter: child, apiKey: 'sk-test', tools: DEFAULT_CONFIG.tools.anthropic });
    expect(calls[1]).toEqual({
      costMeter: child,
      apiKey: 'sk-test',
      tools: DEFAULT_CONFIG.tools.anthropic,
      thinkingTokens: 0,
    });
  });

  it('refuses without ANTHROPIC_API_KEY instead of falling back to a fake', async () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: '  ' }]) {
      await expect(
        composeProviders({
          mode: 'live',
          config: DEFAULT_CONFIG,
          env,
          ceilingUsd: 1,
          llm: true,
          factories: factories().made,
        }),
      ).rejects.toThrow(
        new ProviderSetupError(
          'ANTHROPIC_API_KEY is not set: export it in the shell that runs research, or use --provider fake for a dry run',
        ),
      );
    }
  });

  it('refuses research models of another family', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      research: {
        ...DEFAULT_CONFIG.research,
        models: { ...DEFAULT_CONFIG.research.models, repair: { family: 'openai', model: 'gpt-5.5' } },
      },
    } as LectioConfig;
    await expect(
      composeProviders({ mode: 'live', config, env: KEY_ENV, ceilingUsd: 1, llm: true, factories: factories().made }),
    ).rejects.toThrow('research.models.repair is a openai model; the research CLI only wires the Anthropic provider');
  });

  it('turns a gh that is not logged in into a clear error', async () => {
    const f = factories(() => Promise.reject(new ProviderError('unavailable', 'gh: not logged in')));
    await expect(
      composeProviders({
        mode: 'live',
        config: DEFAULT_CONFIG,
        env: KEY_ENV,
        ceilingUsd: 1,
        llm: true,
        factories: f.made,
      }),
    ).rejects.toThrow('gh could not tell who you are (gh: not logged in): run `gh auth login` and try again');
  });

  it('needs no API key for a command that never calls an LLM', async () => {
    const f = factories();
    const kit = await composeProviders({
      mode: 'live',
      config: DEFAULT_CONFIG,
      env: {},
      ceilingUsd: 1,
      llm: false,
      factories: f.made,
    });
    expect(f.anthropic).toHaveLength(0);
    expect(() => kit.llm(kit.meter)).toThrow('this command does not call an LLM');
  });
});

describe('RoleRoutedLlm', () => {
  it('sends cheap calls to the client without thinking and the rest to the main client', async () => {
    const seen: string[] = [];
    const client = (name: string): LlmClient => ({
      family: 'anthropic',
      generate: (req) => {
        seen.push(`${name}:${req.role}`);
        return new FakeLlmClient().generate(req);
      },
    });
    const routed = new RoleRoutedLlm(client('main'), client('cheap'));
    expect(routed.family).toBe('anthropic');
    for (const role of ['generator', 'repair', 'cheap'] as const) await routed.generate(request(role));
    expect(seen).toEqual(['main:generator', 'main:repair', 'cheap:cheap']);
  });
});

describe('LIVE_FACTORIES', () => {
  it('constructs the real provider classes', () => {
    const meter = { label: 'x' } as unknown as AnthropicLlmClientOptions['costMeter'];
    expect(LIVE_FACTORIES.anthropic({ costMeter: meter, apiKey: 'sk-test' })).toBeInstanceOf(AnthropicLlmClient);
    expect(LIVE_FACTORIES.gh({ repo: 'nyabongo/lectio', viewer: 'nyabongo' })).toBeInstanceOf(GhGitHubClient);
    expect(LIVE_FACTORIES.fetcher({ cacheDir: false })).toBeInstanceOf(LiveSourceFetcher);
  });
});
