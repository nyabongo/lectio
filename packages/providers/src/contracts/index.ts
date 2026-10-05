/**
 * Contract suites every provider implementation must pass. They call vitest's
 * `describe`/`it`, so call them from a `*.test.ts` file:
 *
 * ```ts
 * describeLlmContract(() => new AnthropicLlmClient({ ... }), { name: 'anthropic (recorded)', model: 'claude-sonnet-5-5' });
 * ```
 */
export { describeGitHubContract } from './github.ts';
export type { GitHubContractOptions, GitHubContractSubject } from './github.ts';
export { CONTRACT_RESPONSE_SCHEMA, describeLlmContract } from './llm.ts';
export type { LlmContractOptions } from './llm.ts';
export {
  describeClockContract,
  describeObjectStorageContract,
  describeSourceFetcherContract,
  describeTtsContract,
  describeWebSearchContract,
} from './services.ts';
export type { SourceFetcherSubject, StorageContractOptions, TtsContractOptions } from './services.ts';
