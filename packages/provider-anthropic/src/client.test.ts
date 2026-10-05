import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CONFIG } from '@lectio/config';
import { BudgetExceededError, LlmOutputError, ProviderError, createCostMeter, systemClock } from '@lectio/providers';
import type { CostMeter, LlmRequest, ProviderContext } from '@lectio/providers';
import { CONTRACT_RESPONSE_SCHEMA } from '@lectio/providers/contracts';
import { server } from '@lectio/shared/test-server';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { AnthropicLlmClient, createAnthropicLlmClient } from './client.ts';
import type { AnthropicLlmClientOptions } from './client.ts';
import {
  BASE_URL,
  MESSAGES_URL,
  errorResponse,
  loadRecorded,
  sseResponse,
  streamErrorResponse,
  variant,
} from './fixtures/recorded.ts';
import type { RecordedMessage } from './fixtures/recorded.ts';

type Body = Record<string, unknown> & {
  messages: { role: string; content: unknown }[];
  tools?: Record<string, unknown>[];
  output_config?: { effort?: string; format?: { type: string; schema: Record<string, unknown> } };
};

interface Recorded {
  readonly bodies: Body[];
  readonly headers: Headers[];
}

/** Serves `replies` in order (the last repeats) and records every request. */
function serve(...replies: (RecordedMessage | (() => Response))[]): Recorded {
  const recorded: Recorded = { bodies: [], headers: [] };
  server.use(
    http.post(MESSAGES_URL, async ({ request }) => {
      recorded.bodies.push((await request.json()) as Body);
      recorded.headers.push(request.headers);
      const reply = replies[Math.min(recorded.bodies.length - 1, replies.length - 1)];
      if (reply === undefined) throw new Error('no reply scripted');
      return typeof reply === 'function' ? reply() : sseResponse(reply);
    }),
  );
  return recorded;
}

const sleeps: number[] = [];

function setup(options: Partial<AnthropicLlmClientOptions> = {}): { client: AnthropicLlmClient; meter: CostMeter } {
  sleeps.length = 0;
  const meter = options.costMeter ?? createCostMeter({ pricing: DEFAULT_CONFIG.pricing });
  const client = new AnthropicLlmClient({
    apiKey: 'test-key',
    baseURL: BASE_URL,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...options,
    costMeter: meter,
  });
  return { client, meter };
}

function ask(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    role: 'confirmer',
    system: 'You check claims.',
    messages: [{ role: 'user', content: 'Does water boil at 100 °C at sea level?' }],
    model: 'claude-sonnet-5-5',
    maxTokens: 1024,
    ...overrides,
  };
}

const schemaAsk = (overrides: Partial<LlmRequest> = {}): LlmRequest =>
  ask({ responseSchema: CONTRACT_RESPONSE_SCHEMA, ...overrides });

function textMessage(text: string, usage: Record<string, unknown> = {}): RecordedMessage {
  const base = loadRecorded('text');
  return { ...base, content: [{ type: 'text', text, citations: null }], usage: { ...base.usage, ...usage } };
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('AnthropicLlmClient requests', () => {
  it('streams a plain prompt and charges its usage', async () => {
    const calls = serve(loadRecorded('text'));
    const { client, meter } = setup();
    const response = await client.generate(ask());

    expect(response).toEqual({
      output: 'Yes. At standard sea-level pressure (1 atm), pure water boils at 100 °C.',
      citations: [],
      usage: { inputTokens: 41, outputTokens: 23 },
      model: 'claude-sonnet-5-5',
      family: 'anthropic',
    });
    expect(calls.bodies).toEqual([
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 1024,
        system: 'You check claims.',
        messages: [{ role: 'user', content: 'Does water boil at 100 °C at sea level?' }],
        output_config: { effort: 'high' },
        stream: true,
      },
    ]);
    expect(calls.headers[0]?.get('x-api-key')).toBe('test-key');
    expect(meter.entries()).toEqual([
      {
        meter: 'run',
        note: 'anthropic:confirmer:claude-sonnet-5-5',
        usd: meter.price('claude-sonnet-5-5', response.usage),
        model: 'claude-sonnet-5-5',
        usage: response.usage,
      },
    ]);
  });

  it('sends no effort for the cheap role and honours an effort override', async () => {
    const calls = serve(loadRecorded('text'));
    await setup().client.generate(ask({ role: 'cheap', model: 'claude-haiku-4-5-20251001' }));
    expect(calls.bodies[0]).not.toHaveProperty('output_config');

    const again = serve(loadRecorded('text'));
    await setup({ effort: { cheap: 'low' } }).client.generate(ask({ role: 'cheap' }));
    expect(again.bodies[0]?.output_config).toEqual({ effort: 'low' });
  });

  it('maps web tools to the configured server tool versions', async () => {
    const calls = serve(loadRecorded('text-citations'));
    const { client } = setup({ tools: { webSearch: 'web_search_20250305', webFetch: 'web_fetch_20250910' } });
    await client.generate(
      ask({
        role: 'generator',
        tools: [
          { kind: 'web_search', maxUses: 3, allowedDomains: ['usgs.gov'] },
          { kind: 'web_fetch', allowedDomains: ['wikipedia.org'] },
        ],
      }),
    );
    expect(calls.bodies[0]?.tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3, allowed_domains: ['usgs.gov'] },
      {
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        allowed_domains: ['wikipedia.org'],
        citations: { enabled: true },
      },
    ]);
  });

  it('asks for structured output without the keywords the API rejects, and no fetch citations', async () => {
    const calls = serve(loadRecorded('web-tools'));
    const { client } = setup();
    const response = await client.generate(
      schemaAsk({ tools: [{ kind: 'web_search' }, { kind: 'web_fetch', maxUses: 1 }] }),
    );

    const body = calls.bodies[0];
    expect(body?.tools).toEqual([
      { type: 'web_search_20260209', name: 'web_search' },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1 },
    ]);
    expect(body?.output_config?.effort).toBe('high');
    expect(body?.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(body?.output_config?.format?.schema)).not.toMatch(/"(minimum|maximum|maxItems|minLength)"/);
    expect(response.output).toEqual({
      verdict: 'supported',
      support: 0.95,
      sensitive: false,
      reasons: ['Reference sources give 100 °C at one standard atmosphere.'],
    });
    expect(response.citations).toEqual([
      { url: 'https://en.wikipedia.org/wiki/Boiling_point', title: 'Boiling point - Wikipedia' },
    ]);
    expect(response.usage).toEqual({ inputTokens: 5821, outputTokens: 187, cachedInputTokens: 1024, webSearches: 1 });
  });
});

describe('AnthropicLlmClient answers', () => {
  it('maps text citations to sources and keeps only the final answer text', async () => {
    serve(loadRecorded('text-citations'));
    const response = await setup().client.generate(ask({ model: 'claude-opus-5-5', role: 'generator' }));
    expect(response.output).toBe('Water boils at 100 °C at sea level, and lower at altitude.');
    expect(response.citations).toEqual([
      {
        url: 'https://www.usgs.gov/special-topics/water-science-school/science/boiling-point-water',
        title: 'Boiling Point of Water | USGS',
        citedText: 'At sea level, pure water boils at 212 °F (100 °C).',
      },
      {
        url: 'https://en.wikipedia.org/wiki/Boiling_point',
        title: 'Boiling point',
        citedText: 'Water boils at 100 degrees Celsius at sea level.',
      },
    ]);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const fenced = '```json\n{"verdict":"unclear","support":0.5,"sensitive":true,"reasons":["r"]}\n```';
    serve(textMessage(fenced));
    const response = await setup().client.generate(schemaAsk());
    expect(response.output).toEqual({ verdict: 'unclear', support: 0.5, sensitive: true, reasons: ['r'] });
  });

  it('rejects an empty plain answer as malformed', async () => {
    serve(textMessage('  '));
    const { client, meter } = setup();
    const error = await rejection(client.generate(ask()));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(meter.entries()).toHaveLength(1);
  });

  it('continues a paused server-tool turn and joins its content', async () => {
    const full = loadRecorded('web-tools');
    const paused = { ...full, content: full.content.slice(0, 2), stop_reason: 'pause_turn' };
    const rest = { ...full, content: full.content.slice(2) };
    const calls = serve(paused, rest);
    const response = await setup().client.generate(schemaAsk({ tools: [{ kind: 'web_search' }] }));

    expect(calls.bodies).toHaveLength(2);
    expect(calls.bodies[1]?.messages).toEqual([
      { role: 'user', content: 'Does water boil at 100 °C at sea level?' },
      { role: 'assistant', content: full.content.slice(0, 2) },
    ]);
    expect(response.usage).toEqual({ inputTokens: 11642, outputTokens: 374, cachedInputTokens: 2048, webSearches: 2 });
    expect(response.citations).toHaveLength(1);
  });

  it('gives up on a turn that stays paused', async () => {
    serve(variant('text', { stop_reason: 'pause_turn' }));
    const { client, meter } = setup({ maxContinuations: 1 });
    const error = await rejection(client.generate(ask()));
    expect(error.code).toBe('unavailable');
    expect(error.retryable).toBe(false);
    expect(meter.entries()[0]?.usage).toEqual({ inputTokens: 82, outputTokens: 46 });
  });

  it('reports a refusal with its category, charging the spend', async () => {
    serve(variant('text', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }));
    const { client, meter } = setup();
    const error = await rejection(client.generate(ask()));
    expect(error.code).toBe('unsupported');
    expect(error.message).toContain('(cyber)');
    expect(meter.entries()).toHaveLength(1);

    serve(variant('text', { stop_reason: 'refusal', stop_details: null }));
    const bare = await rejection(setup().client.generate(ask()));
    expect(bare.message).toBe('Anthropic declined the request');
  });

  it('reports an overflowing context as an invalid request', async () => {
    serve(variant('text', { stop_reason: 'model_context_window_exceeded' }));
    expect((await rejection(setup().client.generate(ask()))).code).toBe('invalid-request');
  });
});

describe('AnthropicLlmClient malformed JSON', () => {
  const good = '{"verdict":"refuted","support":0.1,"sensitive":false,"reasons":["no"]}';

  it('repairs malformed JSON with one extra turn, without tools', async () => {
    const calls = serve(textMessage('{"verdict": "supp'), textMessage(good));
    const { client, meter } = setup();
    const response = await client.generate(schemaAsk({ tools: [{ kind: 'web_search' }] }));

    expect(response.output).toEqual({ verdict: 'refuted', support: 0.1, sensitive: false, reasons: ['no'] });
    expect(calls.bodies).toHaveLength(2);
    expect(calls.bodies[1]).not.toHaveProperty('tools');
    expect(calls.bodies[1]?.messages.slice(1)).toEqual([
      { role: 'assistant', content: '{"verdict": "supp' },
      {
        role: 'user',
        content: expect.stringMatching(/^Your answer is not valid JSON \(.+\)\. Reply again/) as unknown,
      },
    ]);
    expect(response.usage).toEqual({ inputTokens: 82, outputTokens: 46 });
    expect(meter.entries()).toHaveLength(1);
  });

  it('repairs JSON that does not match the schema', async () => {
    const calls = serve(
      textMessage('{"verdict":"maybe","support":2,"sensitive":false,"reasons":["x"]}'),
      textMessage(good),
    );
    await setup().client.generate(schemaAsk());
    expect(calls.bodies[1]?.messages[2]?.content).toMatch(/^Your answer does not match the schema: /);
  });

  it('rejects with LlmOutputError after the repair turns run out, charging every turn', async () => {
    serve(textMessage(''));
    const { client, meter } = setup({ jsonRetries: 2 });
    const error = await rejection(client.generate(schemaAsk()));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as LlmOutputError).rawText).toBe('');
    expect(meter.entries()[0]?.usage).toEqual({ inputTokens: 123, outputTokens: 69 });
  });

  it('keeps the sources of the first attempt across a repair, without duplicates', async () => {
    const research = loadRecorded('web-tools');
    const broken = { ...research, content: [...research.content.slice(0, -1), { type: 'text', text: '{' }] };
    serve(broken, research);
    const response = await setup().client.generate(schemaAsk({ tools: [{ kind: 'web_fetch' }] }));
    expect(response.citations).toEqual([
      { url: 'https://en.wikipedia.org/wiki/Boiling_point', title: 'Boiling point - Wikipedia' },
    ]);
  });

  it('does not repair when jsonRetries is 0', async () => {
    const calls = serve(textMessage('nope'));
    const error = await rejection(setup({ jsonRetries: 0 }).client.generate(schemaAsk()));
    expect(error.code).toBe('malformed-output');
    expect(calls.bodies).toHaveLength(1);
  });
});

describe('AnthropicLlmClient retries', () => {
  it('retries a rate limit after the retry-after delay', async () => {
    const calls = serve(
      () => errorResponse(429, 'rate_limit_error', 'slow down', { 'retry-after': '2' }),
      loadRecorded('text'),
    );
    const { client } = setup();
    await expect(client.generate(ask())).resolves.toMatchObject({ family: 'anthropic' });
    expect(calls.bodies).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('retries 529 overloaded and mid-stream overloads with backoff', async () => {
    const calls = serve(
      () => errorResponse(529, 'overloaded_error', 'Overloaded'),
      () => streamErrorResponse('overloaded_error', 'Overloaded'),
      () => errorResponse(500, 'api_error', 'boom'),
      loadRecorded('text'),
    );
    const { client, meter } = setup();
    await client.generate(ask());
    expect(calls.bodies).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(meter.entries()).toHaveLength(1);
  });

  it('retries a dropped connection', async () => {
    serve(() => HttpResponse.error(), loadRecorded('text'));
    await setup().client.generate(ask());
    expect(sleeps).toEqual([1000]);
  });

  it('stops after maxRetries with a retryable rate-limit error and charges nothing', async () => {
    const calls = serve(() => errorResponse(429, 'rate_limit_error', 'slow down', { 'retry-after-ms': '5' }));
    const { client, meter } = setup({ maxRetries: 2 });
    const error = await rejection(client.generate(ask()));
    expect(error.code).toBe('rate-limited');
    expect(error.retryable).toBe(true);
    expect(calls.bodies).toHaveLength(3);
    expect(sleeps).toEqual([5, 5]);
    expect(meter.entries()).toEqual([]);
  });

  it('does not retry client errors', async () => {
    const cases = [
      [400, 'invalid_request_error', 'invalid-request'],
      [401, 'authentication_error', 'invalid-request'],
      [404, 'not_found_error', 'not-found'],
    ] as const;
    for (const [status, type, code] of cases) {
      const calls = serve(() => errorResponse(status, type, 'no'));
      const error = await rejection(setup().client.generate(ask()));
      expect(error.code).toBe(code);
      expect(calls.bodies).toHaveLength(1);
    }
  });

  it('waits for real with the default sleep', async () => {
    serve(() => errorResponse(429, 'rate_limit_error', 'slow down', { 'retry-after-ms': '1' }), loadRecorded('text'));
    const client = new AnthropicLlmClient({
      costMeter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing }),
      apiKey: 'test-key',
      baseURL: BASE_URL,
    });
    await expect(client.generate(ask())).resolves.toMatchObject({ model: 'claude-sonnet-5-5' });
  });
});

describe('AnthropicLlmClient validation and budget', () => {
  it('rejects invalid requests before any HTTP call', async () => {
    const { client } = setup();
    const invalid = [
      ask({ messages: [] }),
      ask({ messages: [{ role: 'assistant', content: 'hi' }] }),
      ask({ model: '' }),
      ask({ maxTokens: 0 }),
      ask({ maxTokens: 1.5 }),
      ask({ model: 'claude-unpriced' }),
    ];
    for (const request of invalid) {
      expect((await rejection(client.generate(request))).code).toBe('invalid-request');
    }
  });

  it('records the spend and then stops at the budget ceiling', async () => {
    serve(loadRecorded('text'));
    const meter = createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: 0.0000001 });
    const { client } = setup({ costMeter: meter });
    await expect(client.generate(ask())).rejects.toBeInstanceOf(BudgetExceededError);
    expect(meter.entries()).toHaveLength(1);
  });

  it('checks its options', () => {
    const costMeter = createCostMeter({ pricing: DEFAULT_CONFIG.pricing });
    expect(() => new AnthropicLlmClient({ costMeter })).toThrow(/ANTHROPIC_API_KEY is not set/);
    expect(() => new AnthropicLlmClient({ costMeter, apiKey: 'k', maxRetries: -1 })).toThrow(RangeError);
    expect(() => new AnthropicLlmClient({ costMeter, apiKey: 'k', timeoutMs: 0 })).toThrow(RangeError);
    expect(new AnthropicLlmClient({ costMeter, apiKey: 'k' }).family).toBe('anthropic');
  });

  it('uses an injected SDK client', async () => {
    const calls = serve(loadRecorded('text'));
    const sdk = new Anthropic({ apiKey: 'injected', baseURL: BASE_URL, maxRetries: 0 });
    const client = new AnthropicLlmClient({
      costMeter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing }),
      client: sdk,
    });
    await client.generate(ask());
    expect(calls.headers[0]?.get('x-api-key')).toBe('injected');
  });
});

describe('createAnthropicLlmClient', () => {
  const context = (env: Record<string, string>): ProviderContext => ({
    config: { ...DEFAULT_CONFIG, tools: { anthropic: { webSearch: 'web_search_x', webFetch: 'web_fetch_x' } } },
    env,
    clock: systemClock,
    costMeter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing }),
  });

  it('reads the key from ANTHROPIC_API_KEY and tool versions from config', async () => {
    const calls = serve(loadRecorded('text'));
    const ctx = context({ ANTHROPIC_API_KEY: 'from-env' });
    const client = createAnthropicLlmClient(ctx, { baseURL: BASE_URL });
    await client.generate(ask({ tools: [{ kind: 'web_search' }] }));
    expect(calls.headers[0]?.get('x-api-key')).toBe('from-env');
    expect(calls.bodies[0]?.tools).toEqual([{ type: 'web_search_x', name: 'web_search' }]);
    expect(ctx.costMeter.entries()).toHaveLength(1);
  });

  it('fails clearly without a key', () => {
    expect(() => createAnthropicLlmClient(context({}))).toThrow(ProviderError);
  });
});
