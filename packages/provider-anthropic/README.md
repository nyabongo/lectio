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

| Concern           | Behaviour                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport         | `@anthropic-ai/sdk` Messages API, streamed (`messages.stream(...).finalMessage()`) so long research turns do not hit HTTP timeouts.                                                                                                               |
| Models            | `request.model`, which callers take from `config.research.models` / `config.verifiers`. The meter must price it (`config.pricing`); an unpriced model is rejected before any request.                                                             |
| Server tools      | `web_search` / `web_fetch` with the `type` versions in `config.tools.anthropic`, `max_uses` and `allowed_domains`. `pause_turn` responses are continued (up to `maxContinuations`).                                                               |
| Structured output | `output_config.format` (`json_schema`). Keywords the API rejects (`minimum`, `maxLength`, `pattern`, `maxItems`, …) move into the field description; the answer is validated against the original schema.                                         |
| Malformed JSON    | One repair turn by default (`jsonRetries`): the model sees its answer and the problem, without tools. Still invalid: `LlmOutputError`.                                                                                                            |
| Citations         | URL citations in the text (`web_search_result_location`, and document citations mapped to the fetched page), plus every fetched page. Uncited search results are not included.                                                                    |
| Usage and cost    | Input, output, cache-read tokens and web searches, summed over continuations and repair turns, charged once per `generate` to the injected `CostMeter` (also when the call fails after spending).                                                 |
| Retries           | 429, 529 / `overloaded_error` (also mid-stream), 5xx, timeouts and dropped connections, up to `maxRetries` (default 4), honouring `retry-after-ms` / `retry-after`, else 1 s doubling to 30 s. Other errors map to `ProviderError` codes at once. |
| Effort            | `high` for generator, repair, confirmer and refuter (Claude Opus 5.5 defaults to `medium`); none for `cheap` (Claude Haiku 4.5 takes no effort). Override with `effort`.                                                                          |
| Refusals          | `stop_reason: "refusal"` rejects with `ProviderError('unsupported')`, naming the category. Server-side fallbacks are not enabled, because the answering model must be priced and is recorded as provenance.                                       |

## Setting the key

The client reads `ANTHROPIC_API_KEY` (through `createAnthropicLlmClient`) or takes `apiKey` directly. Unit tests never
need it: they replay recorded responses through msw.

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

- `src/contract.test.ts` runs the `@lectio/providers` LlmClient contract suite offline against recorded responses
  (`src/fixtures/*.json`, replayed as server-sent events by `src/fixtures/recorded.ts`).
- The same suite runs against the real API only with `LECTIO_LIVE=1` and `ANTHROPIC_API_KEY` set
  (`npm run test:live`, tracked in L-212). It uses `config.verifiers.confirmer.model`.
