import { LlmOutputError, ProviderError, validateAgainstSchema } from '@lectio/providers';
import type {
  CostMeter,
  JsonSchema,
  LlmCitation,
  LlmClient,
  LlmFamily,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmTool,
  LlmUsage,
} from '@lectio/providers';
import OpenAI from 'openai';
import type {
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  Tool,
} from 'openai/resources/responses/responses';

import { LlmRefusalError, toProviderError } from './errors.ts';
import { isStrictCompatible } from './strict-schema.ts';

/** The family this package talks to. Config validation keeps it different from the confirmer's. */
export const OPENAI_FAMILY: LlmFamily = 'openai';

/** Default Responses API web search tool type (OpenAI has no separate fetch tool; search opens pages too). */
export const DEFAULT_WEB_SEARCH_TOOL = 'web_search';

/** Smallest `max_output_tokens` the Responses API accepts. */
const MIN_OUTPUT_TOKENS = 16;

/** Name sent with a structured-output schema (the API requires one). */
const SCHEMA_NAME = 'lectio_response';

export interface OpenAiLlmClientOptions {
  /** API key (`OPENAI_API_KEY`). */
  readonly apiKey: string;
  /** Every call's usage is charged here, priced from `config.pricing`. */
  readonly costMeter: CostMeter;
  /** Override the API base URL (tests, proxies). Default `https://api.openai.com/v1`. */
  readonly baseURL?: string;
  /** SDK retries for rate limits, timeouts and 5xx responses (honours `retry-after`). Default 3. */
  readonly maxRetries?: number;
  /** Per-request timeout in ms. Default 120 000. */
  readonly timeoutMs?: number;
  /** Extra attempts when the model's JSON is malformed or misses the schema. Default 1. */
  readonly outputRetries?: number;
  /** Responses API web search tool `type`. Default {@link DEFAULT_WEB_SEARCH_TOOL}. */
  readonly webSearchTool?: 'web_search' | 'web_search_2025_08_26';
  /** A custom `fetch` for the SDK (tests). Default the global one. */
  readonly fetch?: typeof fetch;
}

function checkRequest(request: LlmRequest): void {
  if (request.messages.length === 0) {
    throw new ProviderError('invalid-request', `openai ${request.role}: a request needs at least one message`);
  }
  if (!Number.isInteger(request.maxTokens) || request.maxTokens <= 0) {
    throw new ProviderError(
      'invalid-request',
      `openai ${request.role}: maxTokens must be a positive integer, got ${String(request.maxTokens)}`,
    );
  }
  if (request.model.length === 0) {
    throw new ProviderError('invalid-request', `openai ${request.role}: a request needs a model`);
  }
}

/**
 * Maps the shared tool list onto one Responses API web search tool. OpenAI has no
 * separate fetch tool (web search opens pages itself), so `web_fetch` widens the same
 * tool. Domain filters are merged; one unrestricted tool lifts the filter.
 */
function mapTools(
  tools: readonly LlmTool[],
  type: NonNullable<OpenAiLlmClientOptions['webSearchTool']>,
): { tools: Tool[]; maxToolCalls?: number } {
  if (tools.length === 0) return { tools: [] };
  const filters = tools.map((tool) => tool.allowedDomains ?? []);
  const unrestricted = filters.some((list) => list.length === 0);
  const domains = unrestricted ? [] : [...new Set(filters.flat())];
  const tool: Tool = domains.length > 0 ? { type, filters: { allowed_domains: domains } } : { type };
  const limits = tools.map((t) => t.maxUses);
  const maxToolCalls = limits.every((n): n is number => n !== undefined)
    ? limits.reduce((sum, n) => sum + n, 0)
    : undefined;
  return maxToolCalls === undefined ? { tools: [tool] } : { tools: [tool], maxToolCalls };
}

function toInput(messages: readonly LlmMessage[]): ResponseInputItem[] {
  return messages.map((message) => ({ type: 'message', role: message.role, content: message.content }));
}

interface ParsedOutput {
  readonly text: string;
  readonly refusal?: string;
  readonly citations: readonly LlmCitation[];
}

/** Collects the assistant's text, any refusal, and URL citations (deduplicated by URL, in order). */
function readOutput(response: OpenAiResponse): ParsedOutput {
  const texts: string[] = [];
  const refusals: string[] = [];
  const citations = new Map<string, LlmCitation>();
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type === 'refusal') {
        refusals.push(part.refusal);
        continue;
      }
      texts.push(part.text);
      for (const annotation of part.annotations) {
        if (annotation.type !== 'url_citation' || citations.has(annotation.url)) continue;
        citations.set(
          annotation.url,
          annotation.title ? { url: annotation.url, title: annotation.title } : { url: annotation.url },
        );
      }
    }
  }
  const text = texts.join('');
  const citationList = [...citations.values()];
  return refusals.length > 0
    ? { text, refusal: refusals.join('\n'), citations: citationList }
    : { text, citations: citationList };
}

/** OpenAI counts cached tokens inside `input_tokens`; the cost meter wants them apart. */
function readUsage(response: OpenAiResponse): LlmUsage {
  const usage = response.usage;
  const input = usage?.input_tokens ?? 0;
  const cached = Math.min(input, usage?.input_tokens_details.cached_tokens ?? 0);
  const webSearches = response.output.filter(
    (item) => item.type === 'web_search_call' && item.action.type === 'search',
  ).length;
  return {
    inputTokens: input - cached,
    outputTokens: usage?.output_tokens ?? 0,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
    ...(webSearches > 0 ? { webSearches } : {}),
  };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * `LlmClient` for OpenAI's Responses API: the refuter verifier's second model family.
 *
 * - Structured output: `responseSchema` is sent as a `json_schema` text format (strict
 *   when the schema allows it) and the answer is validated locally either way; a
 *   malformed answer is retried with the validation errors, then rejects with
 *   {@link LlmOutputError}.
 * - A refusal rejects with {@link LlmRefusalError}.
 * - Usage of every call (including failed attempts) is charged to the cost meter.
 * - Rate limits, timeouts and 5xx responses are retried by the SDK, then mapped to
 *   {@link ProviderError} (`rate-limited`, `timeout`, `unavailable`).
 * - Responses are not stored on OpenAI's side (`store: false`).
 */
export class OpenAiLlmClient implements LlmClient {
  readonly family: LlmFamily = OPENAI_FAMILY;
  readonly #sdk: OpenAI;
  readonly #meter: CostMeter;
  readonly #outputRetries: number;
  readonly #webSearchTool: NonNullable<OpenAiLlmClientOptions['webSearchTool']>;

  constructor(options: OpenAiLlmClientOptions) {
    if (options.apiKey.length === 0) {
      throw new ProviderError('invalid-request', 'openai: an API key is required (set OPENAI_API_KEY)');
    }
    this.#sdk = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeoutMs ?? 120_000,
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.#meter = options.costMeter;
    this.#outputRetries = options.outputRetries ?? 1;
    this.#webSearchTool = options.webSearchTool ?? DEFAULT_WEB_SEARCH_TOOL;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    checkRequest(request);
    // Fail before spending money: an unpriced model could not be metered afterwards.
    this.#meter.price(request.model, { inputTokens: 0, outputTokens: 0 });
    this.#meter.assertWithinBudget();

    const schema = request.responseSchema;
    const input = toInput(request.messages);
    const attempts = schema === undefined ? 1 : this.#outputRetries + 1;
    let lastError: LlmOutputError | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await this.#call(request, input);
      const model = this.#billedModel(response.model, request.model);
      const usage = readUsage(response);
      this.#meter.chargeUsage(model, usage, `llm:${model}:${request.role}`);

      const output = readOutput(response);
      if (output.refusal !== undefined) throw new LlmRefusalError(output.refusal);
      const base = { citations: output.citations, usage, model, family: this.family };
      if (schema === undefined) {
        if (output.text.length === 0) {
          throw new LlmOutputError(`openai ${request.role}: empty answer (${describeStatus(response)})`, '');
        }
        return { output: output.text, ...base };
      }
      const problem = checkStructured(schema, output.text);
      if (problem.ok) return { output: problem.value, ...base };
      lastError = new LlmOutputError(
        `openai ${request.role}: answer does not match the response schema (${describeStatus(response)}): ${problem.error}`,
        output.text,
      );
      input.push(
        { type: 'message', role: 'assistant', content: output.text },
        {
          type: 'message',
          role: 'user',
          content: `Your answer was not valid: ${problem.error}. Reply again with only JSON that matches the schema.`,
        },
      );
    }
    throw lastError as LlmOutputError;
  }

  async #call(request: LlmRequest, input: ResponseInputItem[]): Promise<OpenAiResponse> {
    const { tools, maxToolCalls } = mapTools(request.tools ?? [], this.#webSearchTool);
    const schema = request.responseSchema;
    const params: ResponseCreateParamsNonStreaming = {
      model: request.model,
      instructions: request.system,
      input,
      max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, request.maxTokens),
      store: false,
      ...(tools.length > 0 ? { tools } : {}),
      ...(maxToolCalls === undefined ? {} : { max_tool_calls: maxToolCalls }),
      ...(schema === undefined
        ? {}
        : {
            text: {
              format: {
                type: 'json_schema',
                name: SCHEMA_NAME,
                schema: { ...schema },
                strict: isStrictCompatible(schema),
              },
            },
          }),
    };
    let response: OpenAiResponse;
    try {
      response = await this.#sdk.responses.create(params);
    } catch (error) {
      throw toProviderError(error);
    }
    if (response.status === 'failed' || response.error) {
      const detail = response.error ? `${response.error.code}: ${response.error.message}` : 'no detail';
      throw new ProviderError('unavailable', `openai ${request.role}: response failed (${detail})`);
    }
    return response;
  }

  /** The id to bill: the answering model when it is priced, else the requested one (dated snapshots such as `gpt-5-2025-08-07`). */
  #billedModel(answered: string, requested: string): string {
    try {
      this.#meter.price(answered, { inputTokens: 0, outputTokens: 0 });
      return answered;
    } catch {
      return requested;
    }
  }
}

function describeStatus(response: OpenAiResponse): string {
  const reason = response.incomplete_details?.reason;
  return reason ? `status ${String(response.status)}, ${reason}` : `status ${String(response.status)}`;
}

function checkStructured(
  schema: JsonSchema,
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const parsed = parseJson(text);
  if (!parsed.ok) return { ok: false, error: `invalid JSON: ${parsed.error}` };
  const errors = validateAgainstSchema(schema, parsed.value);
  if (errors.length > 0) return { ok: false, error: errors.slice(0, 5).join('; ') };
  return parsed;
}
