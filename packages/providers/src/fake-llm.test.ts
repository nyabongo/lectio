import { describe, expect, it } from 'vitest';

import { LlmOutputError, ProviderError } from './errors.ts';
import { FakeLlmClient, llmPromptKey } from './fake-llm.ts';
import type { JsonSchema, LlmRequest } from './llm.ts';

const verdictSchema: JsonSchema = {
  type: 'object',
  required: ['verdict', 'support', 'sensitive', 'claims'],
  properties: {
    verdict: { enum: ['supported', 'refuted'] },
    support: { type: 'number', minimum: 0, maximum: 1 },
    sensitive: { type: 'boolean' },
    claims: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
  },
};

const base: LlmRequest = {
  role: 'refuter',
  system: 'Try to refute each claim.',
  messages: [{ role: 'user', content: 'Claim c1: the codex replaced the scroll.' }],
  responseSchema: verdictSchema,
  model: 'fake',
  maxTokens: 1000,
};

describe('llmPromptKey', () => {
  it('is a sha256 of role, system and messages only', () => {
    const key = llmPromptKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(llmPromptKey({ ...base, model: 'other', maxTokens: 1 } as LlmRequest)).toBe(key);
    expect(llmPromptKey({ ...base, role: 'confirmer' })).not.toBe(key);
    expect(llmPromptKey({ ...base, system: 'x' })).not.toBe(key);
  });
});

describe('FakeLlmClient defaults', () => {
  it('answers with a clean, schema-valid default and records the call', async () => {
    const llm = new FakeLlmClient();
    const response = await llm.generate(base);
    expect(response.output).toMatchObject({ verdict: 'supported', support: 1, sensitive: false });
    expect(response).toMatchObject({ citations: [], model: 'fake', family: 'fake' });
    expect(response.usage).toEqual({
      inputTokens: Math.ceil((base.system + base.messages[0]?.content).length / 4),
      outputTokens: expect.any(Number) as number,
      cachedInputTokens: 0,
      webSearches: 0,
    });
    expect(llm.calls).toEqual([base]);
  });

  it('answers plain prompts with deterministic text', async () => {
    const { responseSchema: _schema, ...plain } = base;
    const a = await new FakeLlmClient().generate(plain);
    const b = await new FakeLlmClient().generate(plain);
    expect(a.output).toMatch(/^fake refuter answer [0-9a-f]{12}$/);
    expect(b).toEqual(a);
  });

  it('rejects requests without messages or tokens', async () => {
    const llm = new FakeLlmClient();
    await expect(llm.generate({ ...base, messages: [] })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(llm.generate({ ...base, maxTokens: 0 })).rejects.toThrow(ProviderError);
  });
});

describe('FakeLlmClient scripts', () => {
  it('uses a prompt-keyed script before the role fallback', async () => {
    const llm = new FakeLlmClient({
      scripts: { [llmPromptKey(base)]: { output: { verdict: 'refuted', support: 0, sensitive: false, claims: [] } } },
      roles: { refuter: { patch: { support: 0.5 } } },
    });
    expect((await llm.generate(base)).output).toMatchObject({ verdict: 'refuted', support: 0 });
    const other = { ...base, messages: [{ role: 'user' as const, content: 'Claim c2' }] };
    expect((await llm.generate(other)).output).toMatchObject({ verdict: 'supported', support: 0.5 });
  });

  it('patches the default to script refutations, low confidence and sensitive flags', async () => {
    const llm = new FakeLlmClient().scriptRole('refuter', {
      patch: { verdict: 'refuted', support: 0.2, sensitive: true, claims: [{ id: 'c1' }] },
      citations: [{ url: 'https://example.org/source', title: 'Source' }],
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'gpt-5',
    });
    const response = await llm.generate(base);
    expect(response.output).toEqual({ verdict: 'refuted', support: 0.2, sensitive: true, claims: [{ id: 'c1' }] });
    expect(response.citations).toEqual([{ url: 'https://example.org/source', title: 'Source' }]);
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, webSearches: 0 });
    expect(response.model).toBe('gpt-5');
  });

  it('deep-merges nested patches', async () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { meta: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } } } },
    };
    const llm = new FakeLlmClient().scriptRole('cheap', { patch: { meta: { b: 7 } } });
    const response = await llm.generate({ ...base, role: 'cheap', responseSchema: schema });
    expect(response.output).toEqual({ meta: { a: expect.stringMatching(/^fake meta\.a /) as string, b: 7 } });
    const { output } = await new FakeLlmClient()
      .scriptRole('cheap', { patch: { extra: { x: 1 } } })
      .generate({ ...base, role: 'cheap', responseSchema: { type: 'object' } });
    expect(output).toEqual({ extra: { x: 1 } });
  });

  it('plays a sequence one call at a time and repeats the last entry', async () => {
    const llm = new FakeLlmClient().script(base, [{ text: '{"broken' }, { patch: { support: 0.9 } }]);
    await expect(llm.generate(base)).rejects.toBeInstanceOf(LlmOutputError);
    expect((await llm.generate(base)).output).toMatchObject({ support: 0.9 });
    expect((await llm.generate(base)).output).toMatchObject({ support: 0.9 });
    const empty = new FakeLlmClient().scriptRole('refuter', []);
    expect((await empty.generate(base)).output).toMatchObject({ support: 1 });
  });

  it('scripts malformed JSON and schema mismatches as LlmOutputError with the raw text', async () => {
    const malformed = new FakeLlmClient().scriptRole('refuter', { text: 'not json' });
    const error = await malformed.generate(base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error).toMatchObject({ code: 'malformed-output', rawText: 'not json', retryable: false });

    const mismatch = new FakeLlmClient().scriptRole('refuter', { text: '{"verdict":"maybe"}' });
    await expect(mismatch.generate(base)).rejects.toThrow(/does not match the response schema/);
    const wrongOutput = new FakeLlmClient().scriptRole('refuter', { output: { verdict: 'supported' } });
    await expect(wrongOutput.generate(base)).rejects.toThrow(/missing required property "support"/);
  });

  it('parses scripted JSON text that matches the schema', async () => {
    const text = '{"verdict":"refuted","support":0.1,"sensitive":false,"claims":[]}';
    const response = await new FakeLlmClient().scriptRole('refuter', { text }).generate(base);
    expect(response.output).toEqual(JSON.parse(text));
    expect(response.usage.outputTokens).toBe(Math.ceil(text.length / 4));
  });

  it('scripts plain-text outputs', async () => {
    const { responseSchema: _schema, ...plain } = base;
    const llm = new FakeLlmClient();
    llm.scriptRole('refuter', [{ text: 'raw' }, { output: 'as output' }, { output: { a: 1 } }]);
    expect((await llm.generate(plain)).output).toBe('raw');
    expect((await llm.generate(plain)).output).toBe('as output');
    expect((await llm.generate(plain)).output).toBe('{"a":1}');
  });

  it('scripts failures by code or as an exact error', async () => {
    const llm = new FakeLlmClient().scriptRole('refuter', [{ fail: 'rate-limited' }, { fail: new Error('boom') }]);
    await expect(llm.generate(base)).rejects.toMatchObject({ code: 'rate-limited', retryable: true });
    await expect(llm.generate(base)).rejects.toThrow('boom');
  });
});
