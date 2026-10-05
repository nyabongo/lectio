/**
 * Turning a response body into text: what kind of content it is, which charset it uses, and the main text of an
 * HTML page (navigation, scripts and page furniture dropped).
 */
import { parseHTML } from 'linkedom';

export type ContentKind = 'html' | 'text' | 'pdf' | 'binary';

/** The lower-case media type of a Content-Type header (`''` when there is none). */
export function mediaType(contentType: string): string {
  return (contentType.split(';')[0] as string).trim().toLowerCase();
}

const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/javascript', 'application/ld+json']);

function sniffKind(bytes: Uint8Array): ContentKind {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  if (head.startsWith('%PDF-')) return 'pdf';
  if (/<(?:!doctype html|html|head|body)[\s>]/iu.test(head)) return 'html';
  return 'text';
}

/** What kind of body this is, from its Content-Type, or sniffed from its first bytes when there is none. */
export function contentKind(contentType: string, bytes: Uint8Array): ContentKind {
  const type = mediaType(contentType);
  if (type === '') return sniffKind(bytes);
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/') || TEXT_TYPES.has(type) || /\+(?:xml|json)$/u.test(type)) return 'text';
  return 'binary';
}

/** The Content-Type to report: the header, or the sniffed kind's type when the server sent none. */
export function reportedContentType(contentType: string | null, kind: ContentKind): string {
  if (contentType !== null && contentType.trim() !== '') return contentType;
  return { html: 'text/html', text: 'text/plain', pdf: 'application/pdf', binary: 'application/octet-stream' }[kind];
}

/** The `charset` parameter of a Content-Type header. */
export function charsetParam(contentType: string): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/iu.exec(contentType);
  return match?.[1];
}

/** The charset a `<meta>` declares in the first 1024 bytes of an HTML document. */
export function metaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return /<meta[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/iu.exec(head)?.[1];
}

function bomCharset(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  return undefined;
}

function decoder(label: string | undefined): InstanceType<typeof TextDecoder> | undefined {
  if (label === undefined) return undefined;
  try {
    return new TextDecoder(label);
  } catch {
    return undefined;
  }
}

/**
 * Decodes a body: a byte-order mark wins, then the header's charset, then (for HTML) a `<meta>` charset, then UTF-8.
 * An unknown charset label falls through to the next source.
 */
export function decodeBody(bytes: Uint8Array, contentType: string, kind: ContentKind): string {
  const chosen =
    decoder(bomCharset(bytes)) ??
    decoder(charsetParam(contentType)) ??
    (kind === 'html' ? decoder(metaCharset(bytes)) : undefined) ??
    new TextDecoder('utf-8');
  return chosen.decode(bytes);
}

/** Elements that are never main text. `#wm-ipp-base` is the Wayback Machine's toolbar on archived pages. */
const DROP =
  'script, style, noscript, template, iframe, svg, canvas, nav, header, footer, aside, form, button, select, ' +
  '#wm-ipp-base, #wm-ipp, #donato';

const PARAGRAPH = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'section',
  'article',
  'main',
  'table',
  'figure',
  'dl',
  'ul',
  'ol',
]);
const LINE = new Set(['div', 'li', 'tr', 'dt', 'dd', 'figcaption', 'caption', 'address', 'hr', 'td', 'th']);

/** The document frame stripped from a fragment before it is wrapped in a whole document. */
const FRAME = /<head[\s>][\s\S]*?<\/head>|<\/?(?:html|body)(?:\s[^>]*)?>|<!doctype[^>]*>/giu;

/** Placeholders for block boundaries, resolved once all text is collected: a line break, or a blank line. */
const LINE_GAP = '';
const PARAGRAPH_GAP = '';
const GAPS = /[ ]*[][ ]*/gu;

interface DomNode {
  readonly nodeType: number;
  readonly localName?: string;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<DomNode>;
}

interface DomElement extends DomNode {
  remove(): void;
}

/** The slice of linkedom's document this module uses (the package's DOM types need the DOM lib). */
interface DomDocument {
  readonly body: DomNode;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}

function collect(node: DomNode, out: string[]): void {
  if (node.nodeType === 3) {
    out.push((node.textContent as string).replace(/\s+/gu, ' '));
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.localName as string;
  if (tag === 'br') {
    out.push(LINE_GAP);
    return;
  }
  if (tag === 'pre') {
    out.push(PARAGRAPH_GAP, node.textContent as string, PARAGRAPH_GAP);
    return;
  }
  const gap = PARAGRAPH.has(tag) ? PARAGRAPH_GAP : LINE.has(tag) ? LINE_GAP : '';
  out.push(gap);
  for (const child of Array.from(node.childNodes)) collect(child, out);
  out.push(gap);
}

/** Collapses spaces in each line, trims lines, and keeps at most one blank line between blocks. */
export function tidyText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * The main text of an HTML document: the `<main>` (or `role="main"`) element if there is one, else the longest
 * `<article>`, else the body, with scripts, styles, navigation, headers, footers, asides and forms removed.
 * Paragraph-level blocks are separated by a blank line.
 */
export function htmlToText(html: string): string {
  // linkedom needs a whole document: anything short of <html> with a <body> is rewrapped as one.
  const whole = /<html[\s>]/iu.test(html) && /<body[\s>]/iu.test(html);
  const source = whole ? html : `<!doctype html><html><head></head><body>${html.replace(FRAME, '')}</body></html>`;
  const document = parseHTML(source).document as unknown as DomDocument;
  for (const element of Array.from(document.querySelectorAll(DROP))) element.remove();
  const articles = Array.from(document.querySelectorAll('article'));
  const longest = articles.sort((a, b) => (b.textContent as string).length - (a.textContent as string).length)[0];
  const out: string[] = [];
  collect(document.querySelector('main, [role="main"]') ?? longest ?? document.body, out);
  const text = out.join('').replace(GAPS, (gap) => (gap.includes(PARAGRAPH_GAP) ? '\n\n' : '\n'));
  return tidyText(text);
}
