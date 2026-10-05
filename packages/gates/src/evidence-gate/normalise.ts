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
const TAG = /<\/?[A-Za-z][^>]*>/gu;

/** Removes HTML markup, keeping the text; tags become spaces so words on either side stay apart. */
export function stripTags(text: string): string {
  return text.replace(HIDDEN_BLOCKS, ' ').replace(TAG, ' ');
}

const SINGLE_QUOTES = /[‘’‚‛′`´ʼ]/gu;
const DOUBLE_QUOTES = /[“”„‟″«»]/gu;
const DASHES = /[‐‑‒–—―−]/gu;
const ELLIPSIS = /…/gu;
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/gu;
const SPACES = /\s+/gu;

/** The comparison form of a page or an excerpt. */
export function normaliseText(text: string): string {
  return decodeEntities(stripTags(text))
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

/** Positions where `piece` occurs in `text` from `from` on, as whole words. */
function* occurrences(text: string, piece: string, from: number): Generator<number> {
  const needsStart = WORD_CHAR.test(piece.charAt(0));
  const needsEnd = WORD_CHAR.test(piece.charAt(piece.length - 1));
  for (let at = text.indexOf(piece, from); at >= 0; at = text.indexOf(piece, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + piece.length);
    if (needsStart && at > 0 && WORD_CHAR.test(before)) continue;
    if (needsEnd && WORD_CHAR.test(after)) continue;
    yield at;
  }
}

/** Whether `pieces[index…]` follow on from `end`, each starting within {@link MAX_PIECE_GAP} of the last. */
function restFollows(text: string, pieces: readonly string[], index: number, end: number): boolean {
  const piece = pieces[index];
  if (piece === undefined) return true;
  for (const at of occurrences(text, piece, end)) {
    if (at - end > MAX_PIECE_GAP) return false;
    if (restFollows(text, pieces, index + 1, at + piece.length)) return true;
  }
  return false;
}

/**
 * Whether `excerpt` occurs in `page`: every piece as whole words (`he` does not match inside
 * "the", `vine` not inside "vineyard"), pieces in order and each within {@link MAX_PIECE_GAP}
 * characters of the one before. An excerpt with no words never matches.
 */
export function excerptOccurs(excerpt: string, page: string): boolean {
  const pieces = excerptPieces(excerpt);
  const [first] = pieces;
  if (first === undefined) return false;
  const text = normaliseText(page);
  for (const at of occurrences(text, first, 0)) {
    if (restFollows(text, pieces, 1, at + first.length)) return true;
  }
  return false;
}
