/**
 * Commentary overlap: the longest run of consecutive words that a note field shares with the
 * fetched text of a cited web source, after the guard's normalisation (`@lectio/textguard`).
 * Unlike the Bible check this compares real words, so the run is exact: a word-level longest
 * common substring. The source is indexed once as a suffix automaton over word ids, so building
 * it is linear in the page and matching a note field is linear in the field, whatever the words
 * (a page of "the the the …" costs no more than any other).
 */
import { tokenise } from '@lectio/textguard';
import type { Token } from '@lectio/textguard';

import type { FetchedSource } from '@lectio/providers';

/** Pages longer than this are not checked (they are flagged instead), which bounds memory and time. */
export const MAX_SOURCE_WORDS = 1_000_000;

/** Transition keys are `state * ID_SPACE + wordId`; word ids stay below MAX_SOURCE_WORDS < ID_SPACE. */
const ID_SPACE = 2 ** 21;

/** A source text prepared for overlap checks: a suffix automaton over its words. */
export interface SourceWords {
  readonly words: number;
  /** Word → id, for the words of the source. */
  readonly ids: ReadonlyMap<string, number>;
  /** Suffix link of each state (`-1` for the root). */
  readonly link: Int32Array;
  /** Length of the longest word sequence of each state. */
  readonly length: Int32Array;
  /** Transitions, keyed `state * ID_SPACE + wordId`. */
  readonly next: ReadonlyMap<number, number>;
}

/** The longest shared run: its length in words and its UTF-16 offsets in the note text; all 0 when none. */
export interface SharedRun {
  readonly words: number;
  readonly start: number;
  readonly end: number;
}

/** Indexes the words of a source text; throws on a page over `maxWords` words. */
export function indexSourceWords(text: string, maxWords = MAX_SOURCE_WORDS): SourceWords {
  const tokens = tokenise(text);
  if (tokens.length > maxWords) {
    throw new RangeError(`the page has ${String(tokens.length)} words, more than the ${String(maxWords)} checked`);
  }
  const ids = new Map<string, number>();
  const capacity = 2 * tokens.length + 1;
  const link = new Int32Array(capacity);
  const length = new Int32Array(capacity);
  const edges: number[][] = [[]];
  const next = new Map<number, number>();
  const set = (state: number, id: number, target: number): void => {
    const key = state * ID_SPACE + id;
    if (!next.has(key)) (edges[state] as number[]).push(id);
    next.set(key, target);
  };
  link[0] = -1;
  let size = 1;
  let last = 0;
  for (const { word } of tokens) {
    let id = ids.get(word);
    if (id === undefined) {
      id = ids.size;
      ids.set(word, id);
    }
    const current = size++;
    length[current] = (length[last] as number) + 1;
    edges.push([]);
    let p = last;
    while (p !== -1 && !next.has(p * ID_SPACE + id)) {
      set(p, id, current);
      p = link[p] as number;
    }
    if (p === -1) {
      link[current] = 0;
    } else {
      const q = next.get(p * ID_SPACE + id) as number;
      if ((length[p] as number) + 1 === length[q]) {
        link[current] = q;
      } else {
        const clone = size++;
        length[clone] = (length[p] as number) + 1;
        link[clone] = link[q] as number;
        edges.push([]);
        for (const edge of edges[q] as number[]) set(clone, edge, next.get(q * ID_SPACE + edge) as number);
        while (p !== -1 && next.get(p * ID_SPACE + id) === q) {
          set(p, id, clone);
          p = link[p] as number;
        }
        link[q] = clone;
        link[current] = clone;
      }
    }
    last = current;
  }
  return { words: tokens.length, ids, link, length, next };
}

/** The longest run of consecutive words of `text` that also appears, in order, in the source. */
export function longestSharedRun(text: string, source: SourceWords): SharedRun {
  const tokens = tokenise(text);
  let best = { words: 0, last: 0 };
  let state = 0;
  let matched = 0;
  tokens.forEach(({ word }, i) => {
    const id = source.ids.get(word);
    if (id === undefined) {
      state = 0;
      matched = 0;
      return;
    }
    while (!source.next.has(state * ID_SPACE + id)) {
      state = source.link[state] as number;
      matched = source.length[state] as number;
    }
    // The root has a transition for every source word, so the walk above always stops.
    state = source.next.get(state * ID_SPACE + id) as number;
    matched++;
    if (matched > best.words) best = { words: matched, last: i };
  });
  if (best.words === 0) return { words: 0, start: 0, end: 0 };
  return {
    words: best.words,
    start: (tokens[best.last - best.words + 1] as Token).start,
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

/** The character of a numeric entity; U+FFFD for a number that is not a Unicode scalar value. */
function codePoint(code: number): string {
  const valid = code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return valid ? String.fromCodePoint(code) : '�';
}

/** Reduces HTML to its text: drops scripts, styles and tags, decodes common entities. Never throws. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (entity, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith('#x')) return codePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith('#')) return codePoint(Number.parseInt(lower.slice(1), 10));
      return ENTITIES[lower] ?? entity;
    })
    .replace(/\s+/gu, ' ')
    .trim();
}

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json)|$)/u;
/** A whole HTML document: only then is the text treated as markup. */
const MARKUP = /^\s*(<!doctype\s+html|<html[\s>])/iu;

/**
 * The checkable text of a fetched page, or why there is none: an HTTP error, a body the fetcher
 * could not read (its `unsupported` kind, such as a PDF), a non-text content type or a page with
 * no words.
 *
 * `FetchedSource.text` is already reduced text: the live fetcher (L-030) strips HTML and keeps
 * the `text/html` content type. So the text is used as it is, because reducing it again would
 * delete everything between a literal `<` and `>` in the prose. Only a body that is itself a
 * whole HTML document (from a fake or a raw fetcher) is reduced here.
 */
export function readableText(page: FetchedSource): { readonly text: string } | { readonly problem: string } {
  if (page.status >= 400) return { problem: `HTTP ${String(page.status)}` };
  const unsupported = (page as { readonly unsupported?: unknown }).unsupported;
  if (typeof unsupported === 'string') return { problem: `the fetcher could not read the ${unsupported} body` };
  const type = (page.contentType.split(';')[0] as string).trim().toLowerCase();
  if (!TEXTUAL.test(type)) return { problem: `cannot read content type "${type}"` };
  const text = MARKUP.test(page.text) ? htmlToText(page.text) : page.text;
  if (tokenise(text).length === 0) return { problem: 'the page has no text' };
  return { text };
}
