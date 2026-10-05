/**
 * Text normalisation for `evidence/web-excerpt-found`: a cited excerpt matches a fetched page when
 * both agree after HTML-entity decoding, tag stripping, Unicode compatibility folding and
 * collapsing whitespace, with typographic quotes, dashes and case ignored, and only as whole words.
 * An ellipsis in the excerpt (`…` or `...`) stands for omitted words: each piece must occur, in
 * order, close to the one before, and quote at least three words, so an excerpt cannot be
 * stitched together from scattered fragments.
 *
 * Markup is stripped with regular expressions, not parsed: text in hidden elements (`hidden`,
 * `display: none`) still counts as page text. The live fetcher (L-030) already reduces pages to
 * their main text.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  shy: '',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  prime: '′',
  Prime: '″',
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]+));/gu;

function fromCodePoint(code: number, original: string): string {
  return code > 0x10ffff ? original : String.fromCodePoint(code);
}

/** Decodes numeric character references and the common named entities; unknown names stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, decimal?: string, hex?: string, name?: string) => {
    if (decimal !== undefined) return fromCodePoint(Number.parseInt(decimal, 10), whole);
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16), whole);
    return NAMED_ENTITIES[name as string] ?? whole;
  });
}

/** Script and style blocks, comments, then any remaining tag. */
const HIDDEN_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/giu;
/** Inline formatting and link tags, which can sit inside a word (`day<a>’s</a>`, `Ἑ<i>ταῖρε</i>`). */
const INLINE_TAG = /<\/?(?:a|abbr|b|cite|em|i|small|span|strong|sub|sup|u)\b[^>]*>/giu;
const TAG = /<\/?[A-Za-z][^>]*>/gu;

/**
 * Removes HTML markup, keeping the text. Block tags (paragraphs, line breaks, cells) always become
 * a space so words on either side stay apart. Inline tags (links, emphasis, spans, superscripts)
 * are dropped without a space when `glueInline` is true, so a word they split stays whole
 * (`Ἑ<i>ταῖρε</i>`), and become a space otherwise, so a verse number or link set against the next
 * word (`<sup>1</sup>The`) does not join it. Neither reading is right for every page, so
 * {@link excerptOccurs} tries both.
 */
export function stripTags(text: string, glueInline = true): string {
  return text
    .replace(HIDDEN_BLOCKS, ' ')
    .replace(INLINE_TAG, glueInline ? '' : ' ')
    .replace(TAG, ' ');
}

const SINGLE_QUOTES = /[‘’‚‛′`´ʼ]/gu;
const DOUBLE_QUOTES = /[“”„‟″«»]/gu;
const DASHES = /[‐‑‒–—―−]/gu;
const ELLIPSIS = /…/gu;
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/gu;
const SPACES = /\s+/gu;

/** The comparison form of a page or an excerpt. */
export function normaliseText(text: string, glueInline = true): string {
  return decodeEntities(stripTags(text, glueInline))
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(ELLIPSIS, '...')
    .replace(SPACES, ' ')
    .trim()
    .toLowerCase();
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** The normalised pieces of an excerpt between ellipses; pieces without a letter or digit are dropped. */
export function excerptPieces(excerpt: string): string[] {
  return normaliseText(excerpt)
    .split(/\.{3,}/u)
    .map((piece) => piece.trim())
    .filter((piece) => WORD_CHAR.test(piece));
}

/** Pieces of an ellipsis-joined excerpt must each quote at least this many words. */
export const MIN_PIECE_WORDS = 3;

/** Consecutive pieces of an excerpt must lie within this many characters of each other on the page. */
export const MAX_PIECE_GAP = 400;

/** The number of words in a normalised piece. */
export function wordCount(piece: string): number {
  return piece.split(' ').filter((word) => WORD_CHAR.test(word)).length;
}

/** Whether every piece quotes at least {@link MIN_PIECE_WORDS} words. */
export function excerptLongEnough(excerpt: string): boolean {
  const pieces = excerptPieces(excerpt);
  return pieces.length > 0 && pieces.every((piece) => wordCount(piece) >= MIN_PIECE_WORDS);
}

/**
 * Work done by one {@link excerptOccurs} call, counted so tests can check how it grows with the
 * page and the excerpt without timing it.
 */
export interface MatchWork {
  /** Characters of page text handed to substring searches (each search window counted once). */
  scanned: number;
  /** Visits to an `(index, end)` pair: calls of the memoised search for the rest of the pieces. */
  visits: number;
}

/**
 * Positions where `piece` occurs in `text` as whole words, starting at `from` or later and at
 * `last` or earlier. Only that stretch of the text is searched (plus the piece's length and one
 * boundary character), so a bounded search costs the size of the window, not of the page.
 */
function* occurrences(text: string, piece: string, from: number, work: MatchWork, last = Infinity): Generator<number> {
  const needsStart = WORD_CHAR.test(piece.charAt(0));
  const needsEnd = WORD_CHAR.test(piece.charAt(piece.length - 1));
  const window = text.slice(from, last + piece.length + 1);
  work.scanned += window.length;
  for (let rel = window.indexOf(piece); rel >= 0; rel = window.indexOf(piece, rel + 1)) {
    const at = from + rel;
    if (at > last) return;
    const before = text.charAt(at - 1);
    const after = text.charAt(at + piece.length);
    if (needsStart && at > 0 && WORD_CHAR.test(before)) continue;
    if (needsEnd && WORD_CHAR.test(after)) continue;
    yield at;
  }
}

/**
 * Whether `pieces[index…]` follow on from `end`, each starting within {@link MAX_PIECE_GAP} of the
 * last. `dead` remembers the `(index, end)` pairs already known to fail, so each pair is explored
 * once: the work is bounded by pieces × occurrences, not exponential in the number of pieces.
 * (Taking the earliest occurrence of each piece greedily is not enough: a later occurrence moves
 * the window for the next piece and can be the only one that reaches it.)
 */
function restFollows(
  text: string,
  pieces: readonly string[],
  index: number,
  end: number,
  dead: Set<string>,
  work: MatchWork,
): boolean {
  work.visits += 1;
  const piece = pieces[index];
  if (piece === undefined) return true;
  const key = `${String(index)}:${String(end)}`;
  if (dead.has(key)) return false;
  for (const at of occurrences(text, piece, end, work, end + MAX_PIECE_GAP)) {
    if (restFollows(text, pieces, index + 1, at + piece.length, dead, work)) return true;
  }
  dead.add(key);
  return false;
}

/**
 * Whether `excerpt` occurs in `page`: every piece as whole words (`he` does not match inside
 * "the", `vine` not inside "vineyard"), pieces in order and each within {@link MAX_PIECE_GAP}
 * characters of the one before. An excerpt with no words never matches.
 *
 * The page is read twice, with inline tags glued (`Ἑ<i>ταῖρε</i>` → `Ἑταῖρε`) and spaced
 * (`<sup>1</sup>The` → `1 The`); the excerpt matches if it occurs in either reading.
 *
 * Pass `work` to have the search add up what it did (see {@link MatchWork}).
 */
export function excerptOccurs(excerpt: string, page: string, work: MatchWork = { scanned: 0, visits: 0 }): boolean {
  const pieces = excerptPieces(excerpt);
  const [first] = pieces;
  if (first === undefined) return false;
  return [true, false].some((glue) => {
    const text = normaliseText(page, glue);
    const dead = new Set<string>();
    for (const at of occurrences(text, first, 0, work)) {
      if (restFollows(text, pieces, 1, at + first.length, dead, work)) return true;
    }
    return false;
  });
}
