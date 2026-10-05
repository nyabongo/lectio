import { DEFAULT_CONFIG } from '@lectio/config';
import { BudgetExceededError, LlmOutputError, ProviderError, createCostMeter } from '@lectio/providers';
import type { CostMeter, JsonSchema, LlmRequest } from '@lectio/providers';
import { CONTRACT_RESPONSE_SCHEMA } from '@lectio/providers/contracts';
import { server } from '@lectio/shared/test-server';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { OPENAI_FAMILY, OpenAiLlmClient } from './client.ts';
import type { OpenAiLlmClientOptions } from './client.ts';
import { LlmRefusalError } from './errors.ts';
import { RESPONSES_URL, fixture, recordedHandler, sequenceHandler } from './fixtures/recorded.ts';
import type { SentBody } from './fixtures/recorded.ts';

const MODEL = 'gpt-5';

function meter(ceilingUsd?: number): CostMeter {
  return createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ...(ceilingUsd === undefined ? {} : { ceilingUsd }) });
}

function client(options: Partial<OpenAiLlmClientOptions> = {}): OpenAiLlmClient {
  return new OpenAiLlmClient({ apiKey: 'sk-test-offline', costMeter: meter(), maxRetries: 0, ...options });
}

function ask(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    role: 'refuter',
    system: 'Try to refute the claim.',
    messages: [{ role: 'user', content: 'Claim: water boils at 100 degrees Celsius at sea level.' }],
    model: MODEL,
    maxTokens: 800,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

const STRICT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['supported', 'refuted', 'unclear'] } },
};

describe('OpenAiLlmClient: success', () => {
  it('is the openai family', () => {
    expect(client().family).toBe('openai');
    expect(OPENAI_FAMILY).toBe('openai');
  });

  it('sends a plain prompt to the Responses API and returns its text', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    const costMeter = meter();
    const response = await client({ costMeter }).generate(ask());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      model: MODEL,
      instructions: 'Try to refute the claim.',
      input: [{ type: 'message', role: 'user', content: 'Claim: water boils at 100 degrees Celsius at sea level.' }],
      max_output_tokens: 800,
      store: false,
    });
    expect(response).toEqual({
      output: 'Yes. At standard sea-level pressure, water boils at 100 degrees Celsius.',
      citations: [],
      usage: { inputTokens: 58, outputTokens: 96 },
      // The dated snapshot the API reports is not priced, so the call is billed as the requested id.
      model: MODEL,
      family: 'openai',
    });
    expect(costMeter.entries()).toEqual([
      {
        meter: 'run',
        note: 'llm:gpt-5:refuter',
        usd: costMeter.price(MODEL, response.usage),
        model: MODEL,
        usage: response.usage,
      },
    ]);
  });

  it('bills the answering model id when it is priced', async () => {
    server.use(sequenceHandler([{ ...fixture('text'), model: 'gpt-5' }]));
    const pricing = { ...DEFAULT_CONFIG.pricing, 'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2 } };
    const costMeter = createCostMeter({ pricing });
    const response = await client({ costMeter }).generate(ask({ model: 'gpt-5-mini' }));
    expect(response.model).toBe('gpt-5');
    expect(costMeter.entries()[0]?.model).toBe('gpt-5');
  });

  it('raises max_output_tokens to the API minimum', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    await client().generate(ask({ maxTokens: 4 }));
    expect(sent[0]?.['max_output_tokens']).toBe(16);
  });

  it('passes assistant turns through', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    await client().generate(
      ask({
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' },
        ],
      }),
    );
    expect(sent[0]?.input).toEqual([
      { type: 'message', role: 'user', content: 'a' },
      { type: 'message', role: 'assistant', content: 'b' },
      { type: 'message', role: 'user', content: 'c' },
    ]);
  });

  it('returns parsed structured output and splits cached input tokens out', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    const response = await client().generate(ask({ responseSchema: CONTRACT_RESPONSE_SCHEMA }));
    expect(sent[0]?.text).toEqual({
      format: { type: 'json_schema', name: 'lectio_response', schema: CONTRACT_RESPONSE_SCHEMA, strict: false },
    });
    expect(response.output).toEqual({
      verdict: 'supported',
      support: 0.97,
      sensitive: false,
      reasons: ['Standard boiling point of water at 1 atm is 100 degrees Celsius.'],
    });
    expect(response.usage).toEqual({ inputTokens: 82, cachedInputTokens: 128, outputTokens: 150 });
  });

  it('asks for strict structured output when the schema allows it', async () => {
    const sent: SentBody[] = [];
    server.use(
      sequenceHandler(
        [
          {
            ...fixture('structured'),
            output: [
              {
                id: 'msg_x',
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: '{"verdict":"refuted"}', annotations: [] }],
              },
            ],
          },
        ],
        sent,
      ),
    );
    const response = await client().generate(ask({ responseSchema: STRICT_SCHEMA }));
    expect(sent[0]?.text?.format?.['strict']).toBe(true);
    expect(response.output).toEqual({ verdict: 'refuted' });
  });

  it('maps web tools onto one web_search tool and returns deduplicated citations', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    const response = await client().generate(
      ask({
        tools: [
          { kind: 'web_search', maxUses: 2, allowedDomains: ['en.wikipedia.org'] },
          { kind: 'web_fetch', maxUses: 1, allowedDomains: ['usgs.gov', 'en.wikipedia.org'] },
        ],
        responseSchema: CONTRACT_RESPONSE_SCHEMA,
      }),
    );
    expect(sent[0]?.tools).toEqual([
      { type: 'web_search', filters: { allowed_domains: ['en.wikipedia.org', 'usgs.gov'] } },
    ]);
    expect(sent[0]?.['max_tool_calls']).toBe(3);
    expect(response.citations).toEqual([
      { url: 'https://en.wikipedia.org/wiki/Boiling_point', title: 'Boiling point - Wikipedia' },
      { url: 'https://www.usgs.gov/water-science-school/science/boiling-point-water' },
    ]);
    // One search; the open_page action is not a billed search.
    expect(response.usage).toEqual({ inputTokens: 1840, outputTokens: 220, webSearches: 1 });
  });

  it('drops the domain filter and call limit when any tool is unrestricted', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    await client({ webSearchTool: 'web_search_2025_08_26' }).generate(
      ask({
        tools: [
          { kind: 'web_search', allowedDomains: ['a.example'] },
          { kind: 'web_fetch', allowedDomains: [] },
        ],
      }),
    );
    expect(sent[0]?.tools).toEqual([{ type: 'web_search_2025_08_26' }]);
    expect(sent[0]).not.toHaveProperty('max_tool_calls');
  });

  it('sends no tools for an empty tool list', async () => {
    const sent: SentBody[] = [];
    server.use(recordedHandler(sent));
    await client().generate(ask({ tools: [] }));
    expect(sent[0]).not.toHaveProperty('tools');
  });

  it('treats a missing usage block as zero tokens', async () => {
    const body = fixture('text');
    delete body['usage'];
    server.use(sequenceHandler([body]));
    const response = await client().generate(ask());
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('retries server errors by default', async () => {
    const sent: SentBody[] = [];
    server.use(
      sequenceHandler(
        [{ status: 503, body: { error: { message: 'busy' } }, headers: { 'retry-after-ms': '1' } }, fixture('text')],
        sent,
      ),
    );
    const response = await new OpenAiLlmClient({ apiKey: 'sk-test-offline', costMeter: meter() }).generate(ask());
    expect(typeof response.output).toBe('string');
    expect(sent).toHaveLength(2);
  });

  it('uses a custom base URL and fetch', async () => {
    server.use(http.post('https://proxy.example/v1/responses', () => HttpResponse.json(fixture('text'))));
    const calls: string[] = [];
    const tracking: typeof fetch = (input, init) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return fetch(input, init);
    };
    const response = await client({ baseURL: 'https://proxy.example/v1', fetch: tracking }).generate(ask());
    expect(typeof response.output).toBe('string');
    expect(calls).toEqual(['https://proxy.example/v1/responses']);
  });
});

describe('OpenAiLlmClient: refusal and malformed output', () => {
  it('rejects a refusal with LlmRefusalError after charging the call', async () => {
    server.use(sequenceHandler([fixture('refusal')]));
    const costMeter = meter();
    const error = await failure(client({ costMeter }).generate(ask({ responseSchema: CONTRACT_RESPONSE_SCHEMA })));
    expect(error).toBeInstanceOf(LlmRefusalError);
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error).toMatchObject({
      code: 'malformed-output',
      retryable: false,
      rawText: "I can't help with that request.",
    });
    expect(error.name).toBe('LlmRefusalError');
    expect(costMeter.entries()).toHaveLength(1);
  });

  it('retries malformed JSON once with the validation error, charging both calls', async () => {
    const sent: SentBody[] = [];
    server.use(sequenceHandler([fixture('malformed'), fixture('structured')], sent));
    const costMeter = meter();
    const response = await client({ costMeter }).generate(ask({ responseSchema: CONTRACT_RESPONSE_SCHEMA }));
    expect(response.output).toMatchObject({ verdict: 'supported' });
    expect(costMeter.entries()).toHaveLength(2);
    expect(sent).toHaveLength(2);
    const retryInput = sent[1]?.input ?? [];
    expect(retryInput).toHaveLength(3);
    expect(retryInput[1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: '{"verdict": "supported", "support": 0.9',
    });
    expect(retryInput[2]).toMatchObject({ type: 'message', role: 'user' });
    expect((retryInput[2] as { content: string }).content).toContain('invalid JSON');
    // The first request's input was not mutated after it was sent.
    expect(sent[0]?.input).toHaveLength(1);
  });

  it('rejects with LlmOutputError when every attempt is malformed', async () => {
    server.use(sequenceHandler([fixture('malformed')]));
    const costMeter = meter();
    const error = await failure(client({ costMeter }).generate(ask({ responseSchema: CONTRACT_RESPONSE_SCHEMA })));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error).not.toBeInstanceOf(LlmRefusalError);
    expect(error.message).toContain('status incomplete, max_output_tokens');
    expect((error as LlmOutputError).rawText).toBe('{"verdict": "supported", "support": 0.9');
    expect(costMeter.entries()).toHaveLength(2);
  });

  it('reports schema violations without retrying when outputRetries is 0', async () => {
    const sent: SentBody[] = [];
    server.use(sequenceHandler([fixture('off-schema')], sent));
    const error = await failure(
      client({ outputRetries: 0 }).generate(ask({ responseSchema: CONTRACT_RESPONSE_SCHEMA })),
    );
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error.message).toContain('status completed');
    expect(error.message).toContain('$.verdict');
    expect(sent).toHaveLength(1);
  });

  it('rejects an empty text answer', async () => {
    server.use(sequenceHandler([{ ...fixture('text'), output: [{ id: 'rs', type: 'reasoning', summary: [] }] }]));
    const error = await failure(client().generate(ask()));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error.message).toContain('empty answer');
  });
});

describe('OpenAiLlmClient: HTTP failures', () => {
  it('retries a rate limit (honouring retry-after-ms) and then succeeds', async () => {
    const sent: SentBody[] = [];
    server.use(
      sequenceHandler(
        [{ status: 429, body: fixture('rate-limit'), headers: { 'retry-after-ms': '1' } }, fixture('text')],
        sent,
      ),
    );
    const response = await client({ maxRetries: 2 }).generate(ask());
    expect(typeof response.output).toBe('string');
    expect(sent).toHaveLength(2);
  });

  it('maps an exhausted rate limit to a retryable rate-limited error', async () => {
    server.use(sequenceHandler([{ status: 429, body: fixture('rate-limit'), headers: { 'x-should-retry': 'false' } }]));
    const error = await failure(client().generate(ask()));
    expect(error).toMatchObject({ code: 'rate-limited', retryable: true });
    expect(error.message).toContain('HTTP 429');
  });

  it('does not mark an exhausted quota as retryable', async () => {
    server.use(sequenceHandler([{ status: 429, body: fixture('insufficient-quota') }]));
    const error = await failure(client().generate(ask()));
    expect(error).toMatchObject({ code: 'rate-limited', retryable: false });
  });

  it.each([
    [400, 'invalid-request', false],
    [401, 'invalid-request', false],
    [404, 'not-found', false],
    [408, 'timeout', true],
    [409, 'conflict', false],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    server.use(sequenceHandler([{ status, body: { error: { message: 'nope', type: 'x', param: null, code: null } } }]));
    const error = await failure(client().generate(ask()));
    expect(error).toMatchObject({ code, retryable });
  });

  it('maps a network failure to unavailable', async () => {
    server.use(http.post(RESPONSES_URL, () => HttpResponse.error()));
    const error = await failure(client().generate(ask()));
    expect(error).toMatchObject({ code: 'unavailable', retryable: true });
  });

  it('maps a client-side timeout to timeout', async () => {
    server.use(
      http.post(RESPONSES_URL, async () => {
        await delay(500);
        return HttpResponse.json(fixture('text'));
      }),
    );
    const error = await failure(client({ timeoutMs: 20 }).generate(ask()));
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('maps a failed response to unavailable', async () => {
    server.use(
      sequenceHandler([{ ...fixture('text'), status: 'failed', error: { code: 'server_error', message: 'boom' } }]),
    );
    const error = await failure(client().generate(ask()));
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(error.message).toContain('server_error: boom');
  });

  it('maps a failed response without detail to unavailable', async () => {
    server.use(sequenceHandler([{ ...fixture('text'), status: 'failed' }]));
    const error = await failure(client().generate(ask()));
    expect(error.message).toContain('no detail');
  });
});

describe('OpenAiLlmClient: requests rejected before any HTTP call', () => {
  // No handler is registered: any request would fail the test through the msw guard.
  it.each([
    ['no messages', { messages: [] }],
    ['a zero maxTokens', { maxTokens: 0 }],
    ['a fractional maxTokens', { maxTokens: 1.5 }],
    ['an empty model', { model: '' }],
    ['an unpriced model', { model: 'gpt-unpriced' }],
  ] as const)('rejects %s as invalid-request', async (_label, overrides) => {
    const error = await failure(client().generate(ask(overrides as Partial<LlmRequest>)));
    expect(error.code).toBe('invalid-request');
  });

  it('refuses to start once the budget is spent', async () => {
    await expect(client({ costMeter: meter(0) }).generate(ask())).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('refuses an empty API key', () => {
    expect(() => client({ apiKey: '' })).toThrow(/API key is required/);
  });
});

describe('OpenAiLlmClient: budget', () => {
  it('records the spend and then rejects when a call crosses the ceiling', async () => {
    server.use(recordedHandler());
    const costMeter = meter(0.000001);
    await expect(client({ costMeter }).generate(ask())).rejects.toBeInstanceOf(BudgetExceededError);
    expect(costMeter.entries()).toHaveLength(1);
  });
});
