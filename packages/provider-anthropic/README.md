# @lectio/provider-anthropic

The Anthropic `LlmClient` (ADR 0005): research (L-038, on the owner's machine) and the confirmer verifier (L-031, in
CI) call Claude through it. It is not registered in `createProviders`; the caller injects it.

```ts
import { loadConfig } from '@lectio/config';
import { createProviders } from '@lectio/providers';
import { createAnthropicLlmClient } from '@lectio/provider-anthropic';

const config = loadConfig();
const providers = createProviders(config, process.env, { confirmer: (context) => createAnthropicLlmClient(context) });
```

## What it does

| Concern           | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport         | `@anthropic-ai/sdk` Messages API, streamed (`messages.stream(...).finalMessage()`) so long research turns do not hit HTTP timeouts.                                                                                                                                                                                                                                                                                                                                                                                          |
| Models            | `request.model`, which callers take from `config.research.models` / `config.verifiers`. The meter must price it (`config.pricing`); an unpriced model or a spent budget is rejected before any request. When the API echoes a different id (an alias or a dated snapshot), the call is billed and reported under that id if it is priced, else under the requested id.                                                                                                                                                       |
| Server tools      | `web_search` / `web_fetch` with the `type` versions in `config.tools.anthropic`, `max_uses` and `allowed_domains`. `pause_turn` responses are continued (up to `maxContinuations`).                                                                                                                                                                                                                                                                                                                                          |
| Structured output | `output_config.format` (`json_schema`). Keywords the API rejects (`minimum`, `maxLength`, `maxItems`, `minItems` above 1, conditionals, …) move into the field description, and so does a `pattern` that uses lookaround, backreferences or `\b`; simple patterns are sent as is. The answer is validated against the original schema.                                                                                                                                                                                       |
| Malformed JSON    | One repair turn by default (`jsonRetries`): the model sees its answer and the problem, without tools. Still invalid: `LlmOutputError`.                                                                                                                                                                                                                                                                                                                                                                                       |
| Truncation        | `max_tokens` is `maxTokens` plus a thinking allowance (`thinkingTokens`, default 4096), because Claude Opus 5.5 and Sonnet 5.5 always think and thinking counts against the cap; callers size `maxTokens` for the answer alone. An answer cut off by the cap (`stop_reason: "max_tokens"`) rejects at once with `LlmOutputError` ("answer truncated at N output tokens (thinking used T)"), plain text or JSON, with no repair turn: the same budget would be cut off again.                                                 |
| Citations         | URL citations in the text (`web_search_result_location`, and document citations mapped to the fetched page), plus every fetched page. Uncited search results are not included.                                                                                                                                                                                                                                                                                                                                               |
| Usage and cost    | Input, output, cache-read tokens and web searches, summed over continuations, repair turns and attempts that failed mid-stream (they were billed for what they generated), charged once per `generate` to the injected `CostMeter` (also when the call fails after spending). Cache writes are billed at the plain input rate: `config.pricing` has no cache-write price, and this client sets no cache breakpoints, so they are normally zero. Add a price field before turning caching on (writes cost about 1.25× input). |
| Retries           | 429, 529 / `overloaded_error` (also mid-stream), 409, 5xx, timeouts and dropped connections, up to `maxRetries` (default 4), honouring `retry-after-ms` / `retry-after`, else 1 s doubling to 30 s. Other errors map to `ProviderError` codes at once.                                                                                                                                                                                                                                                                       |
| Effort            | `high` for generator, repair, confirmer and refuter (Claude Opus 5.5 defaults to `medium`); none for `cheap` (Claude Haiku 4.5 takes no effort). Override with `effort`.                                                                                                                                                                                                                                                                                                                                                     |
| Refusals          | `stop_reason: "refusal"` rejects with `ProviderError('unsupported')`, naming the category. Server-side fallbacks are not enabled, because the answering model must be priced and is recorded as provenance.                                                                                                                                                                                                                                                                                                                  |

## Setting the key

The client reads `ANTHROPIC_API_KEY` (through `createAnthropicLlmClient`) or takes `apiKey` directly. Unit tests never
need it: they replay hand-built responses through msw.

**Locally (research, L-038).** Create a key in the Anthropic Console (Settings, API keys), then export it in the shell
that runs research, for example from an untracked `.env` file loaded by your shell or direnv:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Never commit the key; `.env` files stay out of git.

**In CI (confirmer verifier, L-031).** Store it as a repository secret and pass it only to the job that runs the
verifier gate:

```sh
gh secret set ANTHROPIC_API_KEY --repo nyabongo/lectio
```

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Tests

- `src/contract.test.ts` runs the `@lectio/providers` LlmClient contract suite offline against hand-built responses
  (`src/fixtures/*.json`: `Message` objects written in the recorded wire shape, including the empty signed `thinking`
  block, replayed as server-sent events by `src/fixtures/recorded.ts`). L-212 replaces them with real captures.
- The same suite runs against the real API only with `LECTIO_LIVE=1` and `ANTHROPIC_API_KEY` set
  (`npm run test:live`, tracked in L-212). It uses `config.verifiers.confirmer.model`.
