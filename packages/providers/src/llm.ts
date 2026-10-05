import type { LlmFamily } from '@lectio/config';

import type { LlmUsage } from './cost-meter.ts';

export type { LlmFamily } from '@lectio/config';

/**
 * Who is asking. Research roles map to `config.research.models`; verifier roles to
 * `config.verifiers`. Fakes key their scripts on it.
 */
export type LlmRole = 'generator' | 'repair' | 'cheap' | 'confirmer' | 'refuter';

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * A server-side tool the model may use. Live clients map these to the provider's own
 * tool types (versions come from `config.tools`).
 */
export type LlmTool =
  | { readonly kind: 'web_search'; readonly maxUses?: number; readonly allowedDomains?: readonly string[] }
  | { readonly kind: 'web_fetch'; readonly maxUses?: number; readonly allowedDomains?: readonly string[] };

/** A JSON Schema document (draft 2020-12 subset; see `json-schema.ts`). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface LlmRequest {
  readonly role: LlmRole;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly tools?: readonly LlmTool[];
  /** When set, `output` is the parsed JSON value and it matches this schema. */
  readonly responseSchema?: JsonSchema;
  /** Model id (priced in `config.pricing`). */
  readonly model: string;
  readonly maxTokens: number;
}

/** A source the model cited, from a web search/fetch tool result. */
export interface LlmCitation {
  readonly url: string;
  readonly title?: string;
  /** The passage of the source the model relied on. */
  readonly citedText?: string;
}

export interface LlmResponse {
  /** Parsed JSON matching `responseSchema` when one was given, otherwise the model's text. */
  readonly output: unknown;
  readonly citations: readonly LlmCitation[];
  readonly usage: LlmUsage;
  /** The model id that answered (as billed). */
  readonly model: string;
  /** The family that answered. Fakes report `fake`, which gates reject as provenance. */
  readonly family: LlmFamily;
}

/**
 * One LLM call. Implementations charge `usage` to their cost meter, so a call that
 * crosses the budget ceiling rejects with `BudgetExceededError` after the spend is recorded.
 * Malformed JSON (after any retries) rejects with `LlmOutputError`.
 */
export interface LlmClient {
  /** The family this client talks to (`fake` for the deterministic double). */
  readonly family: LlmFamily;
  generate(request: LlmRequest): Promise<LlmResponse>;
}
