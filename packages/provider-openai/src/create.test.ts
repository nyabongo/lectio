import { DEFAULT_CONFIG, deepMerge } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { ProviderError, createProviders } from '@lectio/providers';
import type { ProviderContext } from '@lectio/providers';
import { server } from '@lectio/shared/test-server';
import { describe, expect, it } from 'vitest';

import { OpenAiLlmClient } from './client.ts';
import { OPENAI_API_KEY_ENV, createOpenAiRefuter, hasOpenAiKey } from './create.ts';
import { recordedHandler } from './fixtures/recorded.ts';
import * as entry from './index.ts';

describe('hasOpenAiKey', () => {
  it('needs a non-empty OPENAI_API_KEY', () => {
    expect(OPENAI_API_KEY_ENV).toBe('OPENAI_API_KEY');
    expect(hasOpenAiKey({})).toBe(false);
    expect(hasOpenAiKey({ OPENAI_API_KEY: '' })).toBe(false);
    expect(hasOpenAiKey({ OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
});

describe('createOpenAiRefuter', () => {
  it('is injected as the refuter and charges the shared cost meter', async () => {
    server.use(recordedHandler());
    const providers = createProviders(
      DEFAULT_CONFIG,
      { OPENAI_API_KEY: 'sk-test-offline' },
      {
        refuter: (context: ProviderContext) => createOpenAiRefuter(context, { maxRetries: 0 }),
      },
    );
    expect(providers.refuter).toBeInstanceOf(OpenAiLlmClient);
    expect(providers.refuter.family).toBe('openai');
    expect(providers.confirmer.family).toBe('fake');
    const { model } = DEFAULT_CONFIG.verifiers.refuter;
    await providers.refuter.generate({
      role: 'refuter',
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
      model,
      maxTokens: 100,
    });
    expect(providers.costMeter.entries()).toHaveLength(1);
  });

  it('refuses a missing key', () => {
    expect(() => createProviders(DEFAULT_CONFIG, {}, { refuter: (context) => createOpenAiRefuter(context) })).toThrow(
      /OPENAI_API_KEY is not set/,
    );
  });

  it('refuses a refuter configured for another family', () => {
    const config = deepMerge(DEFAULT_CONFIG, {
      verifiers: {
        confirmer: { family: 'openai', model: 'gpt-5' },
        refuter: { family: 'anthropic', model: 'claude-sonnet-5-5' },
      },
    }) as LectioConfig;
    const error = (() => {
      try {
        createProviders(config, { OPENAI_API_KEY: 'sk-x' }, { refuter: (context) => createOpenAiRefuter(context) });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain('only serves the openai family');
  });
});

describe('package entry point', () => {
  it('exports the client and helpers', () => {
    expect(entry.packageName).toBe('@lectio/provider-openai');
    expect(entry.OpenAiLlmClient).toBe(OpenAiLlmClient);
    expect(entry.DEFAULT_WEB_SEARCH_TOOL).toBe('web_search');
    expect(typeof entry.createOpenAiRefuter).toBe('function');
    expect(typeof entry.isStrictCompatible).toBe('function');
    expect(typeof entry.toProviderError).toBe('function');
  });
});
