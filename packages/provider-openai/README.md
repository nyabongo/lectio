# @lectio/provider-openai

The live `LlmClient` for OpenAI's Responses API. It is the **refuter** verifier's model family
(`config.verifiers.refuter`, default `{ family: "openai", model: "gpt-5" }`), so the claim checks come from a different
family than the Anthropic confirmer (open decision L-207). `@lectio/config` rejects a config whose confirmer and refuter
share a family.

It is not registered in `createProviders`. The content-gates verifiers (L-031) inject it:

```ts
import { createProviders } from '@lectio/providers';
import { createOpenAiRefuter, hasOpenAiKey } from '@lectio/provider-openai';

const providers = createProviders(
  config,
  process.env,
  hasOpenAiKey(process.env) ? { refuter: createOpenAiRefuter } : {},
);
```

`createOpenAiRefuter` charges the run's shared cost meter and throws if `OPENAI_API_KEY` is missing or the configured
refuter is not an OpenAI model. `new OpenAiLlmClient({ apiKey, costMeter })` builds one directly.

## Behaviour

- **Structured output.** `responseSchema` is sent as a `json_schema` text format. It is `strict` when the schema meets
  OpenAI's strict-mode rules (closed objects, every property required, supported keywords only) and non-strict
  otherwise. The answer is validated locally either way. Invalid JSON or a schema mismatch is retried once with the
  errors (`outputRetries`), then rejects with `LlmOutputError`.
- **Refusals** reject with `LlmRefusalError` (an `LlmOutputError`, not retried).
- **Usage → cost meter.** Every call, including a failed attempt, is charged at `config.pricing`. Cached input tokens
  are billed separately and each `web_search_call` search counts as one web search. A dated snapshot id the API reports
  (for example `gpt-5-2025-08-07`) is billed as the requested id when the snapshot itself is not priced. Unpriced models
  and spent budgets are rejected before any request is sent.
- **Retries.** The SDK retries rate limits, timeouts and 5xx responses (default 3 times, honouring `retry-after`).
  After that, failures map to `ProviderError` codes: `rate-limited` (not retryable when the quota is exhausted),
  `timeout`, `unavailable`, `invalid-request`, `not-found`, `conflict`.
- **Web tools.** OpenAI has one `web_search` tool that also opens pages, so `web_search` and `web_fetch` both map onto
  it. Domain filters are merged and `maxUses` becomes `max_tool_calls`. Citations come from `url_citation` annotations,
  deduplicated by URL. The tool type defaults to `web_search` (`webSearchTool` overrides it). `config.tools` only has
  Anthropic entries so far.
- Responses are sent with `store: false`, so OpenAI does not keep them.

## Setting the API key

The key is only needed for live runs: the content-gates workflow (L-031) and `npm run test:live` (L-212). Unit tests
and CI's required checks run offline without it.

**Locally**, export it in your shell, or put it in a `.env` file at the repo root (git ignores `.env` and `.env.*`) and
load that file into your shell:

```sh
export OPENAI_API_KEY=sk-...
LECTIO_LIVE=1 npx vitest run --project @lectio/provider-openai   # live contract suite only
```

**In CI**, store it as a repository secret named `OPENAI_API_KEY`:

```sh
gh secret set OPENAI_API_KEY --repo nyabongo/lectio   # paste the key when prompted
```

(or Settings → Secrets and variables → Actions → New repository secret). A workflow that needs it passes it explicitly:
`env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }`. Use a project-scoped key with a monthly spend limit set in the
OpenAI dashboard.

## Tests

- `src/client.test.ts`: success, structured output, web tools, refusal, malformed output and retry, rate limits and
  other HTTP failures, all answered by msw from `src/fixtures/`.
- `src/contract.test.ts`: the `@lectio/providers/contracts` `LlmClient` suite, offline against the fixtures and live
  under `describe.runIf(LECTIO_LIVE=1 && OPENAI_API_KEY)`.
- The fixtures were written by hand in the Responses API's shape because no key existed yet. L-212 re-records them if
  the live run shows drift.
