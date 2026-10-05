/**
 * @lectio/provider-openai: the OpenAI (Responses API) `LlmClient`, the refuter verifier's
 * second model family (ADR 0005, L-040). Not registered in `createProviders`; the
 * content-gates verifiers (L-031) inject it.
 */
export const packageName = '@lectio/provider-openai';

export { DEFAULT_WEB_SEARCH_TOOL, OPENAI_FAMILY, OpenAiLlmClient } from './client.ts';
export type { OpenAiLlmClientOptions } from './client.ts';
export { OPENAI_API_KEY_ENV, createOpenAiRefuter, hasOpenAiKey } from './create.ts';
export { LlmRefusalError, toProviderError } from './errors.ts';
export { isStrictCompatible } from './strict-schema.ts';
