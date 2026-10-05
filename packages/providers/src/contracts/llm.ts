import { describe, expect, it } from 'vitest';

import { ProviderError } from '../errors.ts';
import { validateAgainstSchema } from '../json-schema.ts';
import type { JsonSchema, LlmClient, LlmRequest } from '../llm.ts';

export interface LlmContractOptions {
  /** Suite name suffix, for example `fake` or `anthropic (recorded)`. */
  readonly name?: string;
  /** Model id to request (must be priced if the client charges a cost meter). */
  readonly model: string;
  /** Assert that two fresh clients answer the same request identically (fakes and recorded HTTP). */
  readonly deterministic?: boolean;
  /** Per-test timeout in ms (live runs). */
  readonly timeoutMs?: number;
}

const FAMILIES = ['anthropic', 'openai', 'google', 'fake'];

/** A small verifier-like schema: the shapes the gates rely on (enum, bounded number, boolean, array). */
export const CONTRACT_RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'support', 'sensitive', 'reasons'],
  properties: {
    verdict: { type: 'string', enum: ['supported', 'refuted', 'unclear'] },
    support: { type: 'number', minimum: 0, maximum: 1 },
    sensitive: { type: 'boolean' },
    reasons: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
  },
};

const SYSTEM = 'You are a careful assistant used in an automated contract test. Answer briefly.';

function request(model: string, overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    role: 'confirmer',
    system: SYSTEM,
    messages: [{ role: 'user', content: 'Is the claim "water boils at 100 degrees Celsius at sea level" supported?' }],
    model,
    maxTokens: 512,
    ...overrides,
  };
}

function expectUsage(usage: Record<string, unknown>): void {
  expect(usage).toHaveProperty('inputTokens');
  expect(usage).toHaveProperty('outputTokens');
  for (const [key, value] of Object.entries(usage)) {
    expect(Number.isInteger(value) && (value as number) >= 0, `usage.${key} = ${String(value)}`).toBe(true);
  }
}

/**
 * The behaviour every `LlmClient` must have. Live implementations run it offline
 * against recorded HTTP in unit CI and against the real API in `npm run test:live` (L-212).
 */
export function describeLlmContract(factory: () => LlmClient | Promise<LlmClient>, options: LlmContractOptions): void {
  const { model, timeoutMs } = options;
  describe(`LlmClient contract${options.name ? ` (${options.name})` : ''}`, () => {
    it('names a known model family', async () => {
      const client = await factory();
      expect(FAMILIES).toContain(client.family);
    });

    it('answers a plain prompt with text', { timeout: timeoutMs }, async () => {
      const client = await factory();
      const response = await client.generate(request(model, { role: 'cheap' }));
      expect(typeof response.output).toBe('string');
      expect((response.output as string).length).toBeGreaterThan(0);
      expect(response.family).toBe(client.family);
      expect(response.model.length).toBeGreaterThan(0);
      expectUsage({ ...response.usage });
      expect(response.usage.outputTokens).toBeGreaterThan(0);
    });

    it('returns parsed JSON that matches the response schema', { timeout: timeoutMs }, async () => {
      const client = await factory();
      const response = await client.generate(request(model, { responseSchema: CONTRACT_RESPONSE_SCHEMA }));
      expect(validateAgainstSchema(CONTRACT_RESPONSE_SCHEMA, response.output)).toEqual([]);
      expect(Array.isArray(response.citations)).toBe(true);
      expectUsage({ ...response.usage });
    });

    it('accepts server-side web tools and returns well-formed citations', { timeout: timeoutMs }, async () => {
      const client = await factory();
      const response = await client.generate(
        request(model, {
          role: 'generator',
          tools: [
            { kind: 'web_search', maxUses: 1 },
            { kind: 'web_fetch', maxUses: 1 },
          ],
          responseSchema: CONTRACT_RESPONSE_SCHEMA,
        }),
      );
      expect(validateAgainstSchema(CONTRACT_RESPONSE_SCHEMA, response.output)).toEqual([]);
      for (const citation of response.citations) expect(URL.canParse(citation.url)).toBe(true);
    });

    it('rejects a request without messages as invalid', { timeout: timeoutMs }, async () => {
      const client = await factory();
      const error = await client.generate(request(model, { messages: [] })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('invalid-request');
    });

    if (options.deterministic) {
      it('answers identically across runs', async () => {
        const ask = request(model, { responseSchema: CONTRACT_RESPONSE_SCHEMA });
        const first = await (await factory()).generate(ask);
        const second = await (await factory()).generate(ask);
        expect(second).toEqual(first);
      });
    }
  });
}
