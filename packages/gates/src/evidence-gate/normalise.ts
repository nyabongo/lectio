/**
 * Text normalisation for `evidence/web-excerpt-found`: a cited excerpt matches a fetched page when
 * both agree after HTML-entity decoding, tag stripping, Unicode compatibility folding and
 * collapsing whitespace, with typographic quotes, dashes and case ignored. An ellipsis in the
 * excerpt (`…` or `...`) stands for omitted words: each piece must occur, in order.
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

/** The normalised pieces of an excerpt between ellipses (empty pieces dropped). */
export function excerptPieces(excerpt: string): string[] {
  return normaliseText(excerpt)
    .split(/\.{3,}/u)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');
}

/** Whether every piece of `excerpt` occurs in `page`, in order. An excerpt with no text never matches. */
export function excerptOccurs(excerpt: string, page: string): boolean {
  const pieces = excerptPieces(excerpt);
  if (pieces.length === 0) return false;
  const text = normaliseText(page);
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    if (at < 0) return false;
    from = at + piece.length;
  }
  return true;
}
