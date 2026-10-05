/**
 * Reads what Lectio needs out of Anthropic Messages API responses: the answer text,
 * the cited sources and the billed usage.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmCitation, LlmUsage } from '@lectio/providers';

const TOOL_BLOCKS = new Set(['server_tool_use', 'web_search_tool_result', 'web_fetch_tool_result', 'tool_use']);

/**
 * The final answer: the text blocks after the last tool block (earlier text is the model
 * narrating its searches), joined. With citations a single answer spans several blocks.
 */
export function answerText(content: readonly Anthropic.ContentBlock[]): string {
  let start = 0;
  content.forEach((block, index) => {
    if (TOOL_BLOCKS.has(block.type)) start = index + 1;
  });
  return content
    .slice(start)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

function citationOf(citation: Anthropic.TextCitation, fetched: readonly string[]): LlmCitation | undefined {
  if (citation.type === 'web_search_result_location') {
    return {
      url: citation.url,
      ...(citation.title ? { title: citation.title } : {}),
      ...(citation.cited_text ? { citedText: citation.cited_text } : {}),
    };
  }
  // Document citations point at a fetched page by its index among the documents in the conversation.
  if (citation.type === 'char_location' || citation.type === 'page_location') {
    const url = fetched[citation.document_index];
    if (url === undefined) return undefined;
    return {
      url,
      ...(citation.document_title ? { title: citation.document_title } : {}),
      ...(citation.cited_text ? { citedText: citation.cited_text } : {}),
    };
  }
  return undefined;
}

/**
 * The sources behind an answer: every URL-bearing citation in the text, then every page the
 * model fetched (structured outputs carry no inline citations, so fetched pages are the
 * citations there). Search results the model did not cite are not included. Deduplicated,
 * and only absolute URLs.
 */
export function collectCitations(content: readonly Anthropic.ContentBlock[]): LlmCitation[] {
  const fetched: string[] = [];
  const fetchedTitles = new Map<string, string>();
  for (const block of content) {
    if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
      fetched.push(block.content.url);
      const title = block.content.content.title;
      if (title) fetchedTitles.set(block.content.url, title);
    }
  }

  const found: LlmCitation[] = [];
  for (const block of content) {
    if (block.type !== 'text') continue;
    for (const citation of block.citations ?? []) {
      const mapped = citationOf(citation, fetched);
      if (mapped) found.push(mapped);
    }
  }
  for (const url of fetched) {
    const title = fetchedTitles.get(url);
    found.push({ url, ...(title ? { title } : {}) });
  }

  const seen = new Set<string>();
  const unique: LlmCitation[] = [];
  for (const citation of found) {
    if (!URL.canParse(citation.url)) continue;
    const cited = found.some((c) => c.url === citation.url && c.citedText !== undefined);
    // A bare fetched-page entry adds nothing when the same page is already cited with a passage.
    if (citation.citedText === undefined && cited) continue;
    const key = `${citation.url}\u0000${citation.citedText ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }
  return unique;
}

/**
 * Billed usage of one response. Cache writes are counted as plain input (this client sets
 * no cache breakpoints, so they are normally zero).
 */
export function usageOf(usage: Anthropic.Usage): LlmUsage {
  const cached = usage.cache_read_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return {
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
    ...(searches > 0 ? { webSearches: searches } : {}),
  };
}

/** The sum of several usages (continuations and repair turns of one call). */
export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  const cached = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  const searches = (a.webSearches ?? 0) + (b.webSearches ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
    ...(searches > 0 ? { webSearches: searches } : {}),
  };
}
