/**
 * Static search (L-060): what Pagefind indexes and how the `/search/` page loads it. No server is involved: the
 * `lectio:pagefind` integration (src/integrations/pagefind.ts) writes the index into `dist/pagefind/` after the
 * build, and the search page lazily loads Pagefind's own UI from there.
 *
 * Every locale is indexed (L-113): the `/sw/` Reading pages are documents in `sw` with the notes they show (the
 * reviewed Kiswahili translation, else English), under `/sw/…` URLs; see `writeSearchIndex`.
 *
 * Only note content is searchable. Each Reading page with an approved passage becomes one search document whose
 * `data-pagefind-body` holds the passage summary, its Context panel and its translation notes, never the reading
 * text (which Lectio never stores). The document is generated from the same view models the Reading page renders
 * (`readingView` in src/lib/reading.ts, so unapproved notes never reach the index), and carries the filters
 * `book` and `season`, the meta `date` and `ref` (plus `title`) and a `date` sort key. URLs are relative to the base
 * path; the page passes the base as Pagefind's `baseUrl`, so results stay right under any `site.basePath`.
 *
 * The Pagefind node API is injected (`PagefindApi`), so tests can run the real one or a fake. This module has
 * type-only imports apart from src/lib/reading.ts (itself type-only), so the search page's client script can import
 * its helpers without pulling Node code or the book table into the browser bundle.
 */
import type { ContentRepo, ResolvedDay } from '@lectio/content';

import type { Segment } from './reading.ts';
import { readingsBySlot, readingView } from './reading.ts';

/** The directory under the build output that holds the Pagefind bundle. */
export const PAGEFIND_DIR = 'pagefind';

/** The filter names every search document carries. */
export const SEARCH_FILTERS = ['book', 'season'] as const;

/** The meta fields every search document carries besides `title`. */
export const SEARCH_META = ['date', 'ref'] as const;

/** Labels the documents need that come from the UI catalogs. */
export interface SearchLabels {
  /** The book name for a book code (`MT` → `Matthew`). */
  readonly book: (code: string) => string;
  /** The reader-facing season name for a calendar season id (`ordinary-time` → `Ordinary Time`). */
  readonly season: (season: string) => string;
  /** The reader-facing slot name (`gospel` → `Gospel`). */
  readonly slot: (slot: string) => string;
  /** An ISO date as the site writes it (`Sunday 20 September 2026`). */
  readonly date: (date: string) => string;
}

/** A titled block of note text. */
export interface SearchSection {
  /** The element id of this block on the Reading page (`context`, `note-<id>`): Pagefind's sub-result anchor. */
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/** One searchable Reading page. */
export interface SearchDocument {
  /** Page URL relative to the base path, with a leading slash: `/2026-09-20/gospel/`. */
  readonly url: string;
  readonly lang: string;
  /** `Mt 20:1-16a · Gospel · Sunday 20 September 2026`. */
  readonly title: string;
  readonly ref: string;
  /** The ISO date (the sort key). */
  readonly isoDate: string;
  /** The formatted date (the `date` meta). */
  readonly date: string;
  readonly book: string;
  readonly season: string;
  readonly summary: string;
  readonly sections: readonly SearchSection[];
}

/** The book code a passage key starts with: `MT.20.1-16` → `MT`. */
export function bookCode(key: string): string {
  return key.split('.', 1)[0] as string;
}

/** The prose of marked-up segments, without the citation markers. */
export function plainText(segments: readonly Segment[]): string {
  return segments
    .map((segment) => (segment.kind === 'text' ? segment.text : ''))
    .join('')
    .trim();
}

/**
 * The search documents for one day: one per reading slot whose passage is approved. `lang` is the language of the
 * pages they stand for, and `localePrefix` those pages' path prefix (`sw/` for the Kiswahili mirror, L-113; empty
 * for the default locale). Pass the day as that locale's content view (`localeRepo`), so the documents hold the
 * notes the page shows: the reviewed translation, else the English notes.
 */
export function dayDocuments(
  day: ResolvedDay,
  lang: string,
  labels: SearchLabels,
  localePrefix = '',
): SearchDocument[] {
  return [...readingsBySlot(day).values()].flatMap((reading) => {
    const view = readingView(day, reading, lang);
    const { notes } = view;
    if (notes === null) return [];
    const date = labels.date(view.date);
    const sections: SearchSection[] = [
      { id: 'context', heading: notes.context.title, paragraphs: notes.context.paragraphs.map(plainText) },
      ...notes.translationNotes.map((note) => ({
        id: note.anchorId,
        heading: `${note.anchor}: ${note.original.translit} (${note.original.gloss})`,
        paragraphs: [note.summary, plainText(note.body)],
      })),
    ];
    return [
      {
        url: `/${localePrefix}${view.path}`,
        lang,
        title: `${view.ref} · ${labels.slot(view.slot)} · ${date}`,
        ref: view.ref,
        isoDate: view.date,
        date,
        book: labels.book(bookCode(view.key)),
        season: labels.season(day.day.season),
        summary: notes.summary,
        sections,
      },
    ];
  });
}

/** Every search document of the content repository, in calendar order (see `dayDocuments` for the locale). */
export function searchDocuments(
  repo: ContentRepo,
  lang: string,
  labels: SearchLabels,
  localePrefix = '',
): SearchDocument[] {
  return repo
    .years()
    .flatMap((year) =>
      repo
        .listDays(`${String(year)}-01-01`, `${String(year)}-12-31`)
        .flatMap((day) => dayDocuments(day, lang, labels, localePrefix)),
    );
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** `text` safe for HTML text and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] as string);
}

/**
 * The HTML Pagefind indexes for `doc`. Filters, meta and the sort key sit outside the `data-pagefind-body` element
 * (as elements, so values may contain commas), so only the note content is searchable text.
 */
export function searchDocumentHtml(doc: SearchDocument): string {
  const e = escapeHtml;
  const sections = doc.sections
    .map(
      (section) =>
        `<section><h2 id="${e(section.id)}">${e(section.heading)}</h2>${section.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')}</section>`,
    )
    .join('');
  return [
    `<!doctype html><html lang="${e(doc.lang)}"><head><meta charset="utf-8"><title>${e(doc.title)}</title></head><body>`,
    `<h1 data-pagefind-meta="title">${e(doc.title)}</h1>`,
    `<p data-pagefind-meta="ref">${e(doc.ref)}</p>`,
    `<p data-pagefind-meta="date" data-pagefind-sort="date:${e(doc.isoDate)}">${e(doc.date)}</p>`,
    `<p data-pagefind-filter="book">${e(doc.book)}</p>`,
    `<p data-pagefind-filter="season">${e(doc.season)}</p>`,
    `<main data-pagefind-body><p>${e(doc.summary)}</p>${sections}</main>`,
    '</body></html>',
  ].join('');
}

/** The subset of the `pagefind` package's node API the index build uses. */
export interface PagefindApi {
  createIndex(config?: { forceLanguage?: string }): Promise<{ errors: string[]; index?: PagefindIndexApi }>;
  close(): Promise<unknown>;
}

export interface PagefindIndexApi {
  addHTMLFile(file: { url: string; content: string }): Promise<{ errors: string[] }>;
  writeFiles(options: { outputPath: string }): Promise<{ errors: string[] }>;
}

function check(step: string, errors: readonly string[]): void {
  if (errors.length > 0) throw new Error(`Pagefind ${step} failed: ${errors.join('; ')}`);
}

/**
 * Indexes `docs` with Pagefind and writes the bundle to `outputPath` (normally `<outDir>/pagefind`). Throws on any
 * Pagefind error so a broken index fails the build. Returns the number of pages indexed. The Pagefind service is
 * closed afterwards, even on failure.
 *
 * Documents in one language are indexed as `lang`. Documents in several (the `/sw/` mirror, L-113) are indexed by
 * each document's `<html lang>`: Pagefind writes one index per language and the search UI loads the one matching
 * its own page's `lang`, so `/sw/search/` finds Kiswahili pages and `/search/` English ones.
 */
export async function writeSearchIndex(
  api: PagefindApi,
  docs: readonly SearchDocument[],
  outputPath: string,
  lang: string,
): Promise<number> {
  try {
    const multilingual = new Set(docs.map((doc) => doc.lang)).size > 1;
    const { errors, index } = await api.createIndex(multilingual ? {} : { forceLanguage: lang });
    check('createIndex', errors);
    if (index === undefined) throw new Error('Pagefind createIndex returned no index');
    for (const doc of docs)
      check(
        `indexing ${doc.url}`,
        (await index.addHTMLFile({ url: doc.url, content: searchDocumentHtml(doc) })).errors,
      );
    check('writeFiles', (await index.writeFiles({ outputPath })).errors);
    return docs.length;
  } finally {
    await api.close();
  }
}

/** What the search page hands its client script. */
export interface SearchPageConfig {
  /** The Pagefind bundle URL, with a trailing slash: `/lectio/pagefind/`. */
  readonly bundlePath: string;
  /** The site base Pagefind prefixes to result URLs: `/lectio/`. */
  readonly baseUrl: string;
  /** Pagefind UI strings (its `translations` option). */
  readonly translations: Readonly<Record<string, string>>;
}

/** The search page's client config for the site base (`/` or `/lectio/`, as Astro's `BASE_URL` gives it). */
export function searchPageConfig(base: string, translations: Readonly<Record<string, string>>): SearchPageConfig {
  const baseUrl = base.endsWith('/') ? base : `${base}/`;
  return { bundlePath: `${baseUrl}${PAGEFIND_DIR}/`, baseUrl, translations };
}

/** The Pagefind UI script and stylesheet URLs in the bundle. */
export function pagefindUiAssets(bundlePath: string): { script: string; style: string } {
  return { script: `${bundlePath}pagefind-ui.js`, style: `${bundlePath}pagefind-ui.css` };
}

/** The search term a `?q=` link carries, trimmed, or `null`. */
export function queryFromSearch(search: string): string | null {
  const term = new URLSearchParams(search).get('q')?.trim() ?? '';
  return term === '' ? null : term;
}

/** Parses the config the search page embeds in `data-search`; `null` when it is missing or malformed. */
export function parseSearchPageConfig(raw: string | undefined): SearchPageConfig | null {
  if (raw === undefined) return null;
  try {
    const value = JSON.parse(raw) as Partial<SearchPageConfig> | null;
    if (
      value === null ||
      typeof value.bundlePath !== 'string' ||
      typeof value.baseUrl !== 'string' ||
      typeof value.translations !== 'object' ||
      value.translations === null
    )
      return null;
    return { bundlePath: value.bundlePath, baseUrl: value.baseUrl, translations: value.translations };
  } catch {
    return null;
  }
}
