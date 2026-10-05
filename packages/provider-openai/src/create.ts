import { ProviderError } from '@lectio/providers';
import type { ProviderContext } from '@lectio/providers';

import { OPENAI_FAMILY, OpenAiLlmClient } from './client.ts';
import type { OpenAiLlmClientOptions } from './client.ts';

/** Environment variable holding the OpenAI API key (locally and as a CI secret). */
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';

/** True when `env` has an OpenAI key, so a consumer can decide whether to inject the live refuter. */
export function hasOpenAiKey(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[OPENAI_API_KEY_ENV] ?? '').length > 0;
}

/**
 * Builds the live refuter from a provider context, for `createProviders(config, env, { refuter: createOpenAiRefuter })`
 * (L-031). It charges the context's cost meter and refuses to build when the configured
 * refuter is not an OpenAI model or the key is missing.
 */
export function createOpenAiRefuter(
  context: ProviderContext,
  options: Omit<OpenAiLlmClientOptions, 'apiKey' | 'costMeter'> = {},
): OpenAiLlmClient {
  const { family, model } = context.config.verifiers.refuter;
  if (family !== OPENAI_FAMILY) {
    throw new ProviderError(
      'invalid-request',
      `config.verifiers.refuter is "${family}" (${model}); @lectio/provider-openai only serves the openai family`,
    );
  }
  if (!hasOpenAiKey(context.env)) {
    throw new ProviderError('invalid-request', `${OPENAI_API_KEY_ENV} is not set; the live refuter needs it`);
  }
  return new OpenAiLlmClient({
    ...options,
    apiKey: context.env[OPENAI_API_KEY_ENV] as string,
    costMeter: context.costMeter,
  });
}
