import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';
import { addUsage, answerText, collectCitations, usageOf } from './response.ts';
import { toStructuredOutputSchema } from './schema.ts';

const blocks = (value: unknown[]): Anthropic.ContentBlock[] => value as Anthropic.ContentBlock[];

describe('response helpers', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/provider-anthropic');
  });

  it('ignores non-text blocks after the last tool block', () => {
    const content = blocks([
      { type: 'tool_use', id: 't', name: 'x', input: {} },
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'answer', citations: null },
    ]);
    expect(answerText(content)).toBe('answer');
    expect(answerText([])).toBe('');
  });

  it('keeps distinct passages from the same page and drops repeats', () => {
    const url = 'https://example.org/a';
    const cite = (cited_text: string): Record<string, unknown> => ({
      type: 'web_search_result_location',
      url,
      title: null,
      cited_text,
      encrypted_index: 'e',
    });
    const content = blocks([{ type: 'text', text: 'x', citations: [cite('one'), cite('two'), cite('one')] }]);
    expect(collectCitations(content)).toEqual([
      { url, citedText: 'one' },
      { url, citedText: 'two' },
    ]);
  });

  it('reads usage with missing optional counters', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    } as unknown as Anthropic.Usage;
    expect(usageOf(usage)).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(
      usageOf({
        ...usage,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
      }),
    ).toEqual({ inputTokens: 13, outputTokens: 5, cachedInputTokens: 4, webSearches: 2 });
    expect(addUsage({ inputTokens: 1, outputTokens: 1 }, { inputTokens: 2, outputTokens: 3, webSearches: 1 })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      webSearches: 1,
    });
  });

  it('returns non-object schemas unchanged', () => {
    expect(toStructuredOutputSchema(true as unknown as Record<string, unknown>)).toBe(true);
  });
});
