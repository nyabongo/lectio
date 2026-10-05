/**
 * `LlmClient` over the Anthropic Messages API (`@anthropic-ai/sdk`): server-side web search
 * and web fetch, structured JSON output, citation mapping, usage charged to the shared
 * `CostMeter`, and retries for rate limits, overloads and malformed JSON.
 *
 * Model ids come from the request (`config.research.models` / `config.verifiers`), tool
 * versions from `config.tools.anthropic`, prices from `config.pricing` via the meter.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CONFIG } from '@lectio/config';
import type { ToolsConfig } from '@lectio/config';
import { LlmOutputError, ProviderError, validateAgainstSchema } from '@lectio/providers';
import type {
  CostMeter,
  LlmCitation,
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmRole,
  LlmTool,
  LlmUsage,
  ProviderContext,
} from '@lectio/providers';

import { retryDelayMs, toProviderError } from './errors.ts';
import { addUsage, answerText, collectCitations, usageOf } from './response.ts';
import { toStructuredOutputSchema } from './schema.ts';

/** The environment variable holding the API key (local `.env` for research, CI secret for the confirmer). */
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Effort per role. Claude Opus 5.5 defaults to `medium`, so research and verification set
 * `high` explicitly; `cheap` runs Claude Haiku 4.5, which takes no effort parameter.
 */
export const DEFAULT_EFFORT: Readonly<Partial<Record<LlmRole, AnthropicEffort>>> = {
  generator: 'high',
  repair: 'high',
  confirmer: 'high',
  refuter: 'high',
};

export interface AnthropicLlmClientOptions {
  /** Every call's usage is charged here (priced from `config.pricing`). */
  readonly costMeter: CostMeter;
  /** API key. Required unless `client` is given. */
  readonly apiKey?: string;
  /** API base URL (tests and proxies). */
  readonly baseURL?: string;
  /** A ready SDK client; `apiKey` and `baseURL` are then ignored. */
  readonly client?: Anthropic;
  /** Server tool versions. Default `DEFAULT_CONFIG.tools.anthropic`. */
  readonly tools?: ToolsConfig['anthropic'];
  /** Effort per role; a role left out sends none. Default {@link DEFAULT_EFFORT}. */
  readonly effort?: Readonly<Partial<Record<LlmRole, AnthropicEffort>>>;
  /** Retries of a transient failure (429, 529, 5xx, timeout, dropped connection). Default 4. */
  readonly maxRetries?: number;
  /** Repair turns after an answer that is not valid JSON for the schema. Default 1. */
  readonly jsonRetries?: number;
  /** `pause_turn` continuations of a long server-tool turn. Default 4. */
  readonly maxContinuations?: number;
  /**
   * Output tokens added to `maxTokens` for thinking, so callers size `maxTokens` for the answer
   * alone (Claude Opus 5.5 and Sonnet 5.5 always think, and thinking counts against `max_tokens`).
   * Default {@link DEFAULT_THINKING_TOKENS}.
   */
  readonly thinkingTokens?: number;
  /** Per-request timeout in ms. Default 10 minutes. */
  readonly timeoutMs?: number;
  /** Waits between retries (injected in tests). */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Default thinking allowance added to `maxTokens`. */
export const DEFAULT_THINKING_TOKENS = 4096;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function checkCount(name: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) throw new RangeError(`${name} must be an integer >= ${String(min)}`);
  return value;
}

function validateRequest(request: LlmRequest): void {
  const invalid = (message: string): ProviderError =>
    new ProviderError('invalid-request', `invalid LLM request: ${message}`);
  if (request.messages.length === 0) throw invalid('messages must not be empty');
  if (request.messages[0]?.role !== 'user') throw invalid('the first message must come from the user');
  if (request.model.length === 0) throw invalid('model must not be empty');
  if (!Number.isInteger(request.maxTokens) || request.maxTokens < 1) {
    throw invalid(`maxTokens must be a positive integer, got ${String(request.maxTokens)}`);
  }
}

/** Strips a Markdown code fence some answers wrap JSON in. */
function unfence(text: string): string {
  const match = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return (match?.[1] ?? text).trim();
}

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly problem: string };

function parseAnswer(text: string, request: LlmRequest): Parsed {
  const schema = request.responseSchema;
  if (schema === undefined) return { ok: true, value: text };
  let value: unknown;
  try {
    value = JSON.parse(unfence(text));
  } catch (error) {
    return { ok: false, problem: `is not valid JSON (${(error as Error).message})` };
  }
  const errors = validateAgainstSchema(schema, value);
  if (errors.length > 0) return { ok: false, problem: `does not match the schema: ${errors.join('; ')}` };
  return { ok: true, value };
}

/** One generate call's running totals, charged once at the end (success or failure). */
interface Tally {
  usage: LlmUsage | undefined;
  model: string;
}

export class AnthropicLlmClient implements LlmClient {
  readonly family = 'anthropic' as const;
  readonly #client: Anthropic;
  readonly #meter: CostMeter;
  readonly #tools: ToolsConfig['anthropic'];
  readonly #effort: Readonly<Partial<Record<LlmRole, AnthropicEffort>>>;
  readonly #maxRetries: number;
  readonly #jsonRetries: number;
  readonly #maxContinuations: number;
  readonly #timeoutMs: number;
  readonly #thinkingTokens: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: AnthropicLlmClientOptions) {
    this.#meter = options.costMeter;
    this.#tools = options.tools ?? DEFAULT_CONFIG.tools.anthropic;
    this.#effort = options.effort ?? DEFAULT_EFFORT;
    this.#maxRetries = checkCount('maxRetries', options.maxRetries ?? 4, 0);
    this.#jsonRetries = checkCount('jsonRetries', options.jsonRetries ?? 1, 0);
    this.#maxContinuations = checkCount('maxContinuations', options.maxContinuations ?? 4, 0);
    this.#timeoutMs = checkCount('timeoutMs', options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1);
    this.#thinkingTokens = checkCount('thinkingTokens', options.thinkingTokens ?? DEFAULT_THINKING_TOKENS, 0);
    this.#sleep = options.sleep ?? realSleep;
    if (options.client) {
      this.#client = options.client;
    } else {
      if (!options.apiKey) {
        throw new ProviderError(
          'invalid-request',
          `${ANTHROPIC_API_KEY_ENV} is not set; the Anthropic client needs a key`,
        );
      }
      // Retries are ours (they see stream errors too and can be tested without real waits).
      this.#client = new Anthropic({
        apiKey: options.apiKey,
        maxRetries: 0,
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      });
    }
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    validateRequest(request);
    // Fail before spending money when the meter cannot price the model or nothing is left.
    this.#meter.price(request.model, { inputTokens: 0, outputTokens: 0 });
    this.#meter.assertWithinBudget();

    const tally: Tally = { usage: undefined, model: request.model };
    let response: LlmResponse;
    try {
      response = await this.#answer(request, tally);
    } catch (error) {
      this.#charge(request, tally);
      throw error;
    }
    this.#charge(request, tally);
    return response;
  }

  #charge(request: LlmRequest, tally: Tally): void {
    if (tally.usage) this.#meter.chargeUsage(tally.model, tally.usage, `anthropic:${request.role}:${tally.model}`);
  }

  /**
   * The id to bill and report: the answering model when it is priced, else the requested one
   * (which `generate` checked). An alias or a snapshot id the API echoes back never leaves a
   * spend unrecorded.
   */
  #billedModel(answered: string, requested: string): string {
    try {
      this.#meter.price(answered, { inputTokens: 0, outputTokens: 0 });
      return answered;
    } catch {
      return requested;
    }
  }

  #tallyUsage(tally: Tally, usage: Anthropic.Usage, requested: string, answered: string): void {
    tally.usage = tally.usage ? addUsage(tally.usage, usageOf(usage)) : usageOf(usage);
    tally.model = this.#billedModel(answered, requested);
  }

  async #answer(request: LlmRequest, tally: Tally): Promise<LlmResponse> {
    const conversation: Anthropic.MessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }));
    const citations: LlmCitation[] = [];
    let tools = request.tools ?? [];

    for (let attempt = 0; ; attempt += 1) {
      const content = await this.#turn(request, conversation, tools, tally);
      for (const citation of collectCitations(content)) {
        if (!citations.some((c) => c.url === citation.url && c.citedText === citation.citedText)) {
          citations.push(citation);
        }
      }
      const text = answerText(content);
      if (request.responseSchema === undefined && text.trim().length === 0) {
        throw new LlmOutputError('Anthropic returned no text', text);
      }
      const parsed = parseAnswer(text, request);
      if (parsed.ok) {
        return {
          output: parsed.value,
          citations,
          usage: tally.usage as LlmUsage,
          model: tally.model,
          family: this.family,
        };
      }
      if (attempt >= this.#jsonRetries) {
        throw new LlmOutputError(`Anthropic answer ${parsed.problem}`, text);
      }
      // Repair turn: show the model its answer and the problem; the research is already done.
      conversation.push(
        { role: 'assistant', content: text.length > 0 ? text : '(empty answer)' },
        {
          role: 'user',
          content: `Your answer ${parsed.problem}. Reply again with only the corrected JSON value, matching the schema exactly.`,
        },
      );
      tools = [];
    }
  }

  /** One logical turn: a request plus any `pause_turn` continuations. Returns all content blocks. */
  async #turn(
    request: LlmRequest,
    conversation: Anthropic.MessageParam[],
    tools: readonly LlmTool[],
    tally: Tally,
  ): Promise<Anthropic.ContentBlock[]> {
    const content: Anthropic.ContentBlock[] = [];
    const messages = [...conversation];
    for (let continuation = 0; ; continuation += 1) {
      const params = this.#params(request, messages, tools);
      const message = await this.#send(params, request, tally);
      this.#tallyUsage(tally, message.usage, request.model, message.model);
      content.push(...message.content);

      switch (message.stop_reason) {
        case 'pause_turn':
          if (continuation >= this.#maxContinuations) {
            throw new ProviderError(
              'unavailable',
              `Anthropic turn still paused after ${String(this.#maxContinuations)} continuations`,
              { retryable: false },
            );
          }
          // Resume the server-tool loop: send the paused assistant turn back as is.
          messages.push({ role: 'assistant', content: message.content as unknown as Anthropic.ContentBlockParam[] });
          continue;
        case 'refusal': {
          const category = message.stop_details?.category;
          throw new ProviderError('unsupported', `Anthropic declined the request${category ? ` (${category})` : ''}`, {
            retryable: false,
          });
        }
        case 'max_tokens': {
          // Truncated: a repair turn with the same budget would be cut off again, so fail at once.
          const thinking = message.usage.output_tokens_details?.thinking_tokens ?? 0;
          throw new LlmOutputError(
            `Anthropic answer truncated at ${String(params.max_tokens)} output tokens (thinking used ${String(thinking)}); raise maxTokens or thinkingTokens`,
            answerText(content),
          );
        }
        case 'model_context_window_exceeded':
          throw new ProviderError('invalid-request', 'the request exceeds the model context window');
        default:
          return content;
      }
    }
  }

  #params(
    request: LlmRequest,
    messages: Anthropic.MessageParam[],
    tools: readonly LlmTool[],
  ): Anthropic.MessageStreamParams {
    const effort = this.#effort[request.role];
    const format = request.responseSchema
      ? { type: 'json_schema' as const, schema: toStructuredOutputSchema(request.responseSchema) }
      : undefined;
    const outputConfig = {
      ...(effort ? { effort } : {}),
      ...(format ? { format } : {}),
    };
    return {
      model: request.model,
      max_tokens: request.maxTokens + this.#thinkingTokens,
      system: request.system,
      messages,
      ...(tools.length > 0 ? { tools: tools.map((tool) => this.#tool(tool, format !== undefined)) } : {}),
      ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    };
  }

  #tool(tool: LlmTool, structured: boolean): Anthropic.ToolUnion {
    const common = {
      name: tool.kind,
      ...(tool.maxUses !== undefined ? { max_uses: tool.maxUses } : {}),
      ...(tool.allowedDomains ? { allowed_domains: [...tool.allowedDomains] } : {}),
    };
    if (tool.kind === 'web_search') {
      return { type: this.#tools.webSearch, ...common } as Anthropic.ToolUnion;
    }
    // Document citations cannot be combined with structured outputs; fetched pages still count as sources.
    return {
      type: this.#tools.webFetch,
      ...common,
      ...(structured ? {} : { citations: { enabled: true } }),
    } as Anthropic.ToolUnion;
  }

  /**
   * Streams one request (long research turns would time out unstreamed), retrying transient
   * failures. An attempt that fails after the stream started has been billed for what it
   * generated, so its partial usage goes into the tally too.
   */
  async #send(params: Anthropic.MessageStreamParams, request: LlmRequest, tally: Tally): Promise<Anthropic.Message> {
    for (let attempt = 0; ; attempt += 1) {
      const stream = this.#client.messages.stream(params, { timeout: this.#timeoutMs });
      try {
        return await stream.finalMessage();
      } catch (error) {
        const partial = stream.currentMessage;
        if (partial) this.#tallyUsage(tally, partial.usage, request.model, partial.model);
        const mapped = toProviderError(error);
        if (!mapped.retryable || attempt >= this.#maxRetries) throw mapped;
        await this.#sleep(retryDelayMs(error, attempt));
      }
    }
  }
}

/**
 * A live-provider factory for `createProviders` (L-031 confirmer, L-038 research): key from
 * `ANTHROPIC_API_KEY`, tool versions from `config.tools.anthropic`, the shared cost meter.
 */
export function createAnthropicLlmClient(
  context: ProviderContext,
  options: Omit<AnthropicLlmClientOptions, 'costMeter' | 'apiKey' | 'tools'> = {},
): AnthropicLlmClient {
  const apiKey = context.env[ANTHROPIC_API_KEY_ENV];
  return new AnthropicLlmClient({
    ...options,
    costMeter: context.costMeter,
    tools: context.config.tools.anthropic,
    ...(apiKey ? { apiKey } : {}),
  });
}
