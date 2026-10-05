import { getBook } from '../books.ts';
import { formatRef } from '../format.ts';
import { chapterLabel } from '../greek-esther.ts';
import type { Ref } from '../types.ts';
import { firstChapter } from './drbo.ts';
import { LinkoutError } from './errors.ts';

/**
 * The tokens a `linkout.providers.<name>.template` may use. Every value is
 * URL-encoded with `encodeURIComponent` before it is substituted.
 *
 * - `{book}`: Lectio book code (ADR 0004), `MT`, `1COR`
 * - `{bookName}`: English name, `Matthew`, `1 Corinthians`
 * - `{bookSlug}`: the name lower-cased with everything but letters and digits removed, `matthew`, `1corinthians`, `songofsongs`
 * - `{chapter}`: the first chapter of the reference; Esther's lettered chapters give their letter, `C`
 * - `{verse}`: the first verse of the reference, empty for a whole chapter
 * - `{query}`: the whole reference written out, `Matthew 20:1–16`
 * - `{osis}`: OSIS book id, `Matt`
 * - `{usfm}`: USFM book id, `MAT`
 * - `{date}`: the reading's date as `YYYYMMDD` (Universalis-style URLs), empty without a date
 */
export const TEMPLATE_TOKENS = [
  'book',
  'bookName',
  'bookSlug',
  'chapter',
  'verse',
  'query',
  'osis',
  'usfm',
  'date',
] as const;

export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

const TOKEN = /\{([^{}]*)\}/g;
const KNOWN: ReadonlySet<string> = new Set(TEMPLATE_TOKENS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → `YYYYMMDD`; throws `INVALID_DATE` for anything that is not a real calendar date. */
export function compactDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!ISO_DATE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new LinkoutError('INVALID_DATE', `"${date}" is not a YYYY-MM-DD date`);
  }
  return date.replaceAll('-', '');
}

/** The token values for a reference (already in the target site's versification) and an optional date. */
export function templateValues(ref: Ref, date?: string): Record<TemplateToken, string> {
  const book = getBook(ref.book);
  return {
    book: book.code,
    bookName: book.name,
    bookSlug: book.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    chapter: chapterLabel(ref.book, firstChapter(ref)),
    verse: String(ref.segments[0]?.start.v ?? ''),
    query: formatRef(ref, { style: 'long' }),
    osis: book.osis,
    usfm: book.usfm,
    date: date === undefined ? '' : compactDate(date),
  };
}

/** The names of the tokens a template uses, in order of first appearance; throws `UNKNOWN_TOKEN` on any other. */
export function templateTokens(template: string): TemplateToken[] {
  const used: TemplateToken[] = [];
  for (const [, name = ''] of template.matchAll(TOKEN)) {
    if (!KNOWN.has(name)) {
      throw new LinkoutError(
        'UNKNOWN_TOKEN',
        `Unknown link-out template token "{${name}}"; use ${TEMPLATE_TOKENS.map((t) => `{${t}}`).join(', ')}`,
      );
    }
    if (!used.includes(name as TemplateToken)) used.push(name as TemplateToken);
  }
  return used;
}

/** Substitutes every token with its URL-encoded value. The result must be an `https://` URL. */
export function fillTemplate(template: string, values: Readonly<Record<TemplateToken, string>>): string {
  templateTokens(template);
  const url = template.replace(TOKEN, (_, name: TemplateToken) => encodeURIComponent(values[name]));
  if (!URL.canParse(url) || new URL(url).protocol !== 'https:') {
    throw new LinkoutError('INVALID_URL', `The link-out template "${template}" does not give an https:// URL`);
  }
  return url;
}
