/**
 * @lectio/providers: every external dependency as an interface with a deterministic
 * fake, `createProviders` to assemble a run's provider set, and the contract suites
 * live implementations must pass (ADR 0005).
 *
 * The contract suites import vitest, so they live in the test-only subpath
 * `@lectio/providers/contracts`; this entry point has no test dependencies.
 */
export const packageName = '@lectio/providers';

export { FAKE_EPOCH, FakeClock, systemClock } from './clock.ts';
export type { Clock, FakeClockOptions } from './clock.ts';
export { createCostMeter } from './cost-meter.ts';
export type { CostEntry, CostMeter, CostMeterOptions, LlmUsage } from './cost-meter.ts';
export { PROVIDER_SLOTS, SOURCE_FIXTURES_ENV, STORAGE_DIR_ENV, createProviders } from './create.ts';
export type { LiveProvider, LiveProviders, ProviderContext, ProviderSet, ProviderSlot, Providers } from './create.ts';
export { BudgetExceededError, LlmOutputError, ProviderError } from './errors.ts';
export type { ProviderErrorCode } from './errors.ts';
export { FakeGitHubClient } from './fake-github.ts';
export type { FakeDispatch, FakeGitHubOptions, FakeMerge, FakeWorkflow } from './fake-github.ts';
export { FakeLlmClient, llmPromptKey } from './fake-llm.ts';
export type { FakeLlmOptions, FakeLlmScript, FakeLlmScriptEntry } from './fake-llm.ts';
export { markerComment, withMarker } from './github.ts';
export type * from './github.ts';
export { seededRandom, sha256Hex, stableStringify } from './hash.ts';
export { SchemaGenerationError, generateFromSchema, intersectSchemas, validateAgainstSchema } from './json-schema.ts';
export { PatternError, generateFromPattern } from './pattern.ts';
export type * from './llm.ts';
export { FsObjectStorage, MemoryObjectStorage, assertValidKey } from './storage.ts';
export type { ObjectInfo, ObjectStorage, PutOptions, StoredObject } from './storage.ts';
export { FAKE_TTS_MS_PER_CHAR, FAKE_TTS_SAMPLE_RATE, FakeTtsProvider, wav } from './tts.ts';
export type { TtsFormat, TtsProvider, TtsRequest, TtsResult } from './tts.ts';
export { FakeWebSearch, FixtureSourceFetcher, MemorySourceFetcher } from './web.ts';
export type {
  FakeSourcePage,
  FakeWebSearchOptions,
  FetchOptions,
  FetchedSource,
  SourceFetcher,
  WebSearch,
  WebSearchQuery,
  WebSearchResult,
} from './web.ts';
