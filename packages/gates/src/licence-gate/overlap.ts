/**
 * Commentary overlap: the longest run of consecutive words that a note field shares with the
 * fetched text of a cited web source, after the guard's normalisation (`@lectio/textguard`).
 * Unlike the Bible check this compares real words, so the run is exact: a word-level longest
 * common substring, computed with a position index of the source so it stays fast on long pages.
 */
import { tokenise } from '@lectio/textguard';
import type { Token } from '@lectio/textguard';

import type { FetchedSource } from '@lectio/providers';

/** A source text prepared for overlap checks: word positions by normalised word. */
export interface SourceWords {
  readonly words: number;
  readonly positions: ReadonlyMap<string, readonly number[]>;
}

/** The longest shared run: its length in words and its UTF-16 offsets in the note text; all 0 when none. */
export interface SharedRun {
  readonly words: number;
  readonly start: number;
  readonly end: number;
}

/** Indexes the words of a source text. */
export function indexSourceWords(text: string): SourceWords {
  const positions = new Map<string, number[]>();
  const tokens = tokenise(text);
  tokens.forEach(({ word }, i) => {
    const list = positions.get(word);
    if (list === undefined) positions.set(word, [i]);
    else list.push(i);
  });
  return { words: tokens.length, positions };
}

/** The longest run of consecutive words of `text` that also appears, in order, in the source. */
export function longestSharedRun(text: string, source: SourceWords): SharedRun {
  const tokens = tokenise(text);
  let best = { words: 0, first: 0, last: 0 };
  let previous = new Map<number, number>();
  tokens.forEach(({ word }, i) => {
    const current = new Map<number, number>();
    for (const position of source.positions.get(word) ?? []) {
      const length = (previous.get(position - 1) ?? 0) + 1;
      current.set(position, length);
      if (length > best.words) best = { words: length, first: i - length + 1, last: i };
    }
    previous = current;
  });
  if (best.words === 0) return { words: 0, start: 0, end: 0 };
  return {
    words: best.words,
    start: (tokens[best.first] as Token).start,
    end: (tokens[best.last] as Token).end,
  };
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
};

/** Reduces HTML to its text: drops scripts, styles and tags, decodes common entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (entity, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      return ENTITIES[lower] ?? entity;
    })
    .replace(/\s+/gu, ' ')
    .trim();
}

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json)|$)/u;
const LOOKS_LIKE_HTML = /<(html|body|div|p|span|br|head|article|section)\b/iu;

/**
 * The checkable text of a fetched page, or why there is none: an HTTP error, a non-text
 * content type (a PDF, an image) or a page with no words. Live fetchers already reduce HTML to
 * text; HTML that still arrives is reduced here.
 */
export function readableText(page: FetchedSource): { readonly text: string } | { readonly problem: string } {
  if (page.status >= 400) return { problem: `HTTP ${String(page.status)}` };
  const type = (page.contentType.split(';')[0] as string).trim().toLowerCase();
  if (!TEXTUAL.test(type)) return { problem: `cannot read content type "${type}"` };
  const text = type.includes('html') || LOOKS_LIKE_HTML.test(page.text) ? htmlToText(page.text) : page.text;
  if (tokenise(text).length === 0) return { problem: 'the page has no text' };
  return { text };
}
