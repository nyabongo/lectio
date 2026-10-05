import type { CostMeter, LlmUsage } from './cost-meter.ts';
import { LlmOutputError, ProviderError } from './errors.ts';
import type { ProviderErrorCode } from './errors.ts';
import { sha256Hex, stableStringify } from './hash.ts';
import { generateFromSchema, validateAgainstSchema } from './json-schema.ts';
import type { LlmCitation, LlmClient, LlmMessage, LlmRequest, LlmResponse, LlmRole } from './llm.ts';

/**
 * One scripted answer. With nothing set, the fake answers with its default: a
 * schema-valid value from `generateFromSchema` (or a short text without a schema).
 */
export interface FakeLlmScript {
  /** The exact output. With a response schema it must match it, or the call rejects with `LlmOutputError`. */
  readonly output?: unknown;
  /**
   * Deep-merged into the default output: the way to script a refutation, low confidence
   * or a sensitive flag without spelling out the whole object (for example
   * `{ patch: { verdict: 'refuted', support: 0.2 } }`). Arrays in the patch replace arrays.
   */
  readonly patch?: Readonly<Record<string, unknown>>;
  /** Raw model text. With a response schema it is parsed as JSON, so `text: '{"oops'` scripts malformed JSON. */
  readonly text?: string;
  readonly citations?: readonly LlmCitation[];
  /** Overrides the computed usage. */
  readonly usage?: Partial<LlmUsage>;
  /** The model the response claims (default: the requested model). */
  readonly model?: string;
  /** Reject instead of answering: a `ProviderError` with this code, or this exact error. */
  readonly fail?: ProviderErrorCode | Error;
}

/** A single script, or a sequence consumed one call at a time (the last entry repeats). */
export type FakeLlmScriptEntry = FakeLlmScript | readonly FakeLlmScript[];

export interface FakeLlmOptions {
  /** Scripts keyed by {@link llmPromptKey}. */
  readonly scripts?: Readonly<Record<string, FakeLlmScriptEntry>>;
  /** Fallback scripts per role, used when no prompt-keyed script matches. */
  readonly roles?: Partial<Readonly<Record<LlmRole, FakeLlmScriptEntry>>>;
  /** Usage is charged here (priced by the response model). */
  readonly costMeter?: CostMeter;
}

/** The prompt a script is keyed on: sha256 of the role, system prompt and messages. */
export function llmPromptKey(prompt: {
  readonly role: LlmRole;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
}): string {
  return sha256Hex(
    stableStringify({
      role: prompt.role,
      system: prompt.system,
      messages: prompt.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: Readonly<Record<string, unknown>>): unknown {
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out;
}

const tokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * The deterministic LLM double. Every answer is a pure function of the request and
 * the scripts, so outputs are identical across runs. It reports family `fake`.
 */
export class FakeLlmClient implements LlmClient {
  readonly family = 'fake' as const;
  /** Every request received, in order. */
  readonly calls: LlmRequest[] = [];
  readonly #scripts = new Map<string, FakeLlmScriptEntry>();
  readonly #roles = new Map<LlmRole, FakeLlmScriptEntry>();
  readonly #used = new Map<FakeLlmScriptEntry, number>();
  readonly #costMeter: CostMeter | undefined;

  constructor(options: FakeLlmOptions = {}) {
    for (const [key, entry] of Object.entries(options.scripts ?? {})) this.#scripts.set(key, entry);
    for (const [role, entry] of Object.entries(options.roles ?? {})) this.#roles.set(role as LlmRole, entry);
    this.#costMeter = options.costMeter;
  }

  /** Scripts the answer to one prompt. */
  script(
    prompt: { readonly role: LlmRole; readonly system: string; readonly messages: readonly LlmMessage[] },
    entry: FakeLlmScriptEntry,
  ): this {
    this.#scripts.set(llmPromptKey(prompt), entry);
    return this;
  }

  /** Scripts the fallback answer for every prompt of a role. */
  scriptRole(role: LlmRole, entry: FakeLlmScriptEntry): this {
    this.#roles.set(role, entry);
    return this;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    if (request.messages.length === 0 || !(request.maxTokens > 0)) {
      throw new ProviderError('invalid-request', `${request.role}: a request needs messages and a positive maxTokens`);
    }
    const key = llmPromptKey(request);
    const script = this.#next(this.#scripts.get(key) ?? this.#roles.get(request.role));
    if (script.fail !== undefined) {
      throw typeof script.fail === 'string'
        ? new ProviderError(script.fail, `scripted ${script.fail} failure for ${request.role}`)
        : script.fail;
    }

    const { output, text } = this.#answer(request, script, key);
    const promptText = request.system + request.messages.map((m) => m.content).join('\n');
    const usage: LlmUsage = {
      inputTokens: tokens(promptText),
      outputTokens: tokens(text),
      cachedInputTokens: 0,
      webSearches: 0,
      ...script.usage,
    };
    const model = script.model ?? request.model;
    this.#costMeter?.chargeUsage(model, usage, `llm:${request.role}`);
    return { output, citations: script.citations ?? [], usage, model, family: this.family };
  }

  #next(entry: FakeLlmScriptEntry | undefined): FakeLlmScript {
    if (entry === undefined) return {};
    if (!Array.isArray(entry)) return entry as FakeLlmScript;
    const sequence = entry as readonly FakeLlmScript[];
    const index = this.#used.get(entry) ?? 0;
    this.#used.set(entry, index + 1);
    return sequence[Math.min(index, sequence.length - 1)] ?? {};
  }

  #answer(request: LlmRequest, script: FakeLlmScript, key: string): { output: unknown; text: string } {
    const schema = request.responseSchema;
    if (schema === undefined) {
      const text =
        script.text ??
        (typeof script.output === 'string' ? script.output : undefined) ??
        (script.output === undefined
          ? `fake ${request.role} answer ${key.slice(0, 12)}`
          : stableStringify(script.output));
      return { output: text, text };
    }

    let output: unknown;
    let text: string;
    if (script.text !== undefined) {
      text = script.text;
      try {
        output = JSON.parse(text);
      } catch {
        throw new LlmOutputError(`${request.role}: model output is not valid JSON`, text);
      }
    } else {
      output = script.output ?? generateFromSchema(schema, key);
      if (script.patch !== undefined) output = deepMerge(output, script.patch);
      text = stableStringify(output);
    }
    const errors = validateAgainstSchema(schema, output);
    if (errors.length > 0) {
      throw new LlmOutputError(
        `${request.role}: output does not match the response schema: ${errors.join('; ')}`,
        text,
      );
    }
    return { output, text };
  }
}
