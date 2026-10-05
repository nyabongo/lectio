/**
 * One verifier call per claim: the versioned prompt as the system message, the claim input as
 * JSON, and a response schema for the structured verdict. Malformed output (invalid JSON, or JSON
 * that does not match the schema) is retried once; a provider error is not retried here (live
 * clients retry transient failures themselves).
 */
import { BudgetExceededError, LlmOutputError, validateAgainstSchema } from '@lectio/providers';
import type { JsonSchema, LlmClient, LlmUsage } from '@lectio/providers';

import type { ClaimInput } from './input.ts';
import type { VerifierPrompt, VerifierRole } from './prompts.ts';

export const VERDICTS = ['supported', 'unsupported', 'refuted', 'uncertain'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const MAX_RATIONALE_CHARS = 300;

/** Output tokens a verifier may spend on one verdict. */
export const VERIFIER_MAX_TOKENS = 1024;

/** The structured answer each verifier gives for one claim. */
export const VERDICT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'support', 'sensitive', 'rationale'],
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    support: { type: 'number', minimum: 0, maximum: 1 },
    sensitive: { type: 'boolean' },
    rationale: { type: 'string', minLength: 1, maxLength: MAX_RATIONALE_CHARS },
  },
};

export interface ClaimVerdict {
  readonly verdict: Verdict;
  readonly support: number;
  readonly sensitive: boolean;
  readonly rationale: string;
}

/** A completed call: the verdict, or why there is none. */
export type CallOutcome =
  | {
      readonly ok: true;
      readonly verdict: ClaimVerdict;
      readonly model: string;
      readonly usages: readonly { readonly model: string; readonly usage: LlmUsage }[];
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      readonly error: string;
      /** `malformed` after the retry, `provider` for any other failure, `budget` when the meter ran out. */
      readonly kind: 'malformed' | 'provider' | 'budget';
      readonly usages: readonly { readonly model: string; readonly usage: LlmUsage }[];
      readonly attempts: number;
    };

export interface VerifyRequest {
  readonly role: VerifierRole;
  readonly client: LlmClient;
  readonly model: string;
  readonly prompt: VerifierPrompt;
  readonly input: ClaimInput;
}

/** Calls the verifier for one claim, retrying once on malformed output. */
export async function verifyClaim(request: VerifyRequest): Promise<CallOutcome> {
  const usages: { model: string; usage: LlmUsage }[] = [];
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await request.client.generate({
        role: request.role,
        system: request.prompt.text,
        messages: [{ role: 'user', content: JSON.stringify(request.input, null, 2) }],
        responseSchema: VERDICT_SCHEMA,
        model: request.model,
        maxTokens: VERIFIER_MAX_TOKENS,
      });
      usages.push({ model: response.model, usage: response.usage });
      const errors = validateAgainstSchema(VERDICT_SCHEMA, response.output);
      if (errors.length === 0) {
        return { ok: true, verdict: response.output as ClaimVerdict, model: response.model, usages, attempts: attempt };
      }
      lastError = `output does not match the verdict schema: ${errors.join('; ')}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof BudgetExceededError)
        return { ok: false, kind: 'budget', error: message, usages, attempts: attempt };
      if (!(error instanceof LlmOutputError))
        return { ok: false, kind: 'provider', error: message, usages, attempts: attempt };
      lastError = message;
    }
  }
  return { ok: false, kind: 'malformed', error: lastError, usages, attempts: 2 };
}
