# ADR 0005: Providers behind interfaces with fakes

- Status: accepted
- Date: 2026-10-04
- Issue: L-001 (implemented by L-008 and the provider-\* issues)

## Context

Lectio depends on LLM APIs (two model families), web fetching, text-to-speech, object storage and GitHub. Real keys
do not exist yet, CI must run without secrets, and tests must be deterministic.

## Decision

- Every external dependency is an interface in `@lectio/providers` (`LlmClient`, `WebSearch`, `SourceFetcher`,
  `TtsProvider`, `ObjectStorage`, `GitHubClient`, `Clock`, `CostMeter`) with a deterministic fake.
- `createProviders(config, env, live)` returns fakes for every slot unless the caller injects a live implementation.
  It never imports a live provider package and never throws for missing secrets.
- Live implementations live in their own packages: `provider-gh`, `provider-fetch`, `provider-anthropic`,
  `provider-openai`, `provider-azure-tts`, `provider-s3`. Consumers (the content-gates workflow, the research CLI,
  the deploy pipeline, the runway monitor) inject them at the edge.
- `@lectio/providers` exports contract suites that every implementation must pass: offline with recorded HTTP in
  unit CI, and against real services in `npm run test:live` (L-212), which is never a required check.
- Unit tests are offline: the root `vitest.setup.ts` msw guard fails any request without a handler.

## Consequences

- All of CI, including end-to-end research and gate tests, runs offline and deterministically.
- Adding or swapping a live provider never changes `@lectio/providers` or its consumers' tests.
- Live behaviour is only proven by the contract suites; L-212 runs them with real keys once they exist.
