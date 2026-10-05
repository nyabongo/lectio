/**
 * @lectio/provider-anthropic: the Anthropic `LlmClient` used by research (local key) and
 * the confirmer verifier (CI secret). Not registered in `createProviders`; callers inject
 * it (L-031 verifiers, L-038 research). See README.md for key setup.
 */
export const packageName = '@lectio/provider-anthropic';

export { ANTHROPIC_API_KEY_ENV, AnthropicLlmClient, DEFAULT_EFFORT, createAnthropicLlmClient } from './client.ts';
export type { AnthropicEffort, AnthropicLlmClientOptions } from './client.ts';
export { BASE_BACKOFF_MS, MAX_BACKOFF_MS, MAX_RETRY_AFTER_MS, retryDelayMs, toProviderError } from './errors.ts';
export { addUsage, answerText, collectCitations, usageOf } from './response.ts';
export { toStructuredOutputSchema } from './schema.ts';
