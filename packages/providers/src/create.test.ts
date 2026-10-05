import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { FakeClock, systemClock } from './clock.ts';
import { createCostMeter } from './cost-meter.ts';
import { PROVIDER_SLOTS, SOURCE_FIXTURES_ENV, STORAGE_DIR_ENV, createProviders } from './create.ts';
import type { ProviderContext } from './create.ts';
import { BudgetExceededError } from './errors.ts';
import { FakeGitHubClient } from './fake-github.ts';
import { FakeLlmClient } from './fake-llm.ts';
import type { LlmClient } from './llm.ts';
import { packageName } from './index.ts';
import { FsObjectStorage, MemoryObjectStorage } from './storage.ts';
import { FixtureSourceFetcher, MemorySourceFetcher } from './web.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sources');

describe('createProviders', () => {
  it('fills every slot with a fake when nothing is injected, without needing secrets', () => {
    const providers = createProviders(DEFAULT_CONFIG, {});
    expect([...providers.fakes].sort()).toEqual([...PROVIDER_SLOTS].sort());
    expect(providers.llm).toBeInstanceOf(FakeLlmClient);
    expect(providers.confirmer.family).toBe('fake');
    expect(providers.refuter).not.toBe(providers.confirmer);
    expect(providers.github).toBeInstanceOf(FakeGitHubClient);
    expect(providers.clock).toBeInstanceOf(FakeClock);
    expect(providers.fetcher).toBeInstanceOf(MemorySourceFetcher);
    expect(providers.storage).toBeInstanceOf(MemoryObjectStorage);
    expect(providers.costMeter.ceilingUsd).toBe(DEFAULT_CONFIG.research.budget.perRunUsd);
    expect(packageName).toBe('@lectio/providers');
  });

  it('defaults env to empty', () => {
    expect(createProviders(DEFAULT_CONFIG).fakes.size).toBe(PROVIDER_SLOTS.length);
  });

  it('injects live instances and factories, sharing the clock and cost meter', async () => {
    const live: LlmClient = {
      family: 'anthropic',
      generate: () => Promise.reject(new Error('not called')),
    };
    const github = new FakeGitHubClient({ actor: 'github-actions[bot]' });
    const meter = createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: 0.000001 });
    let seen: ProviderContext | undefined;
    const providers = createProviders(
      DEFAULT_CONFIG,
      { ANTHROPIC_API_KEY: 'test' },
      {
        clock: systemClock,
        costMeter: meter,
        github,
        confirmer: live,
        refuter: (context) => {
          seen = context;
          return new FakeLlmClient({ costMeter: context.costMeter });
        },
      },
    );
    expect(providers.github).toBe(github);
    expect(providers.confirmer).toBe(live);
    expect(providers.clock).toBe(systemClock);
    expect(providers.costMeter).toBe(meter);
    expect(seen).toMatchObject({
      config: DEFAULT_CONFIG,
      env: { ANTHROPIC_API_KEY: 'test' },
      clock: systemClock,
      costMeter: meter,
    });
    expect([...providers.fakes].sort()).toEqual(['fetcher', 'llm', 'storage', 'tts', 'webSearch']);
    // The fake research LLM charges the injected meter too.
    await expect(
      providers.llm.generate({
        role: 'generator',
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        model: 'claude-opus-5-5',
        maxTokens: 10,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('uses fixture sources and filesystem storage when the environment points at them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lectio-create-'));
    try {
      const fsConfig: LectioConfig = {
        ...DEFAULT_CONFIG,
        tts: { ...DEFAULT_CONFIG.tts, storage: { ...DEFAULT_CONFIG.tts.storage, provider: 'fs' } },
      };
      const env = { [SOURCE_FIXTURES_ENV]: fixtures, [STORAGE_DIR_ENV]: dir };
      const providers = createProviders(fsConfig, env);
      expect(providers.fetcher).toBeInstanceOf(FixtureSourceFetcher);
      expect(providers.storage).toBeInstanceOf(FsObjectStorage);
      // s3 config without a live implementation still falls back to memory, never throws.
      const s3Config: LectioConfig = {
        ...DEFAULT_CONFIG,
        tts: { ...DEFAULT_CONFIG.tts, storage: { ...DEFAULT_CONFIG.tts.storage, provider: 's3' } },
      };
      expect(createProviders(s3Config, env).storage).toBeInstanceOf(MemoryObjectStorage);
      expect(createProviders(fsConfig, {}).storage).toBeInstanceOf(MemoryObjectStorage);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
