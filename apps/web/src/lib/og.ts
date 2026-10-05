/**
 * Open Graph images (L-088): one 1200×630 PNG share card per day, per reading with approved notes and per insight,
 * rendered at build time by `@lectio/sharecards` and served as static files:
 *
 * - `/og/[date].png` for a day page (`src/pages/og/[date].png.ts`);
 * - `/og/[date]/[slot].png` for a Reading page whose passage is approved (a pending reading has no summary to show,
 *   so its page uses the day's image);
 * - `/og/[date]/[slot]/[noteId].png` for an Insight page.
 *
 * `<Seo>` (src/components/seo/Seo.astro) asks {@link ogImageForPage} for a page's image, so every day, reading and
 * insight page gets an absolute `og:image` with its size and alt text without the pages passing one in.
 *
 * Rendering goes through a content-hash cache ({@link renderOgImage}): `cardCacheKey()` covers the card's input, the
 * template version and the font bytes, so an unchanged card is copied from `.cache/og` instead of being rendered
 * again. The integration in src/integrations/og.ts points the endpoints at the cache, logs the build time, prunes
 * stale entries and checks the built pages ({@link checkOgDist}).
 *
 * Card text is commentary, references and short original-language phrases: never reading text.
 */
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { ContentRepo } from '@lectio/content';
import { getBook, tryParseRef } from '@lectio/refs';
import type { Segment } from '@lectio/refs';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HebrewLayoutError,
  MAX_PNG_BYTES,
  cardAltText,
  cardCacheKey,
  cardTemplate,
  loadFonts,
  renderCard,
} from '@lectio/sharecards';
import type { DayCard, InsightCard, OriginalLanguage, ReadingCard, RenderOptions, ShareCard } from '@lectio/sharecards';

import { calendarDates, dayPageView, dayPath, refLabel, slotLabel } from './day.ts';
import type { DayConfig, DayEnv } from './day.ts';
import { insightPage, insightStaticPaths } from './insight.ts';
import { readingPage, readingStaticPaths } from './reading.ts';
import { absoluteUrl } from './seo.ts';
import type { SeoImage } from './seo.ts';
import { withBase } from './site.ts';
import { colourAttribute } from './theme.ts';

/** The directory under the site root that holds the images. */
export const OG_DIR = 'og';
export const OG_WIDTH = CARD_WIDTH;
export const OG_HEIGHT = CARD_HEIGHT;
/** The largest image a crawler is handed (WhatsApp stops at 300 KB). */
export const OG_MAX_BYTES = MAX_PNG_BYTES;

/** Set by the integration: where the endpoints keep rendered cards between builds. Unset, nothing is cached. */
export const OG_CACHE_ENV = 'LECTIO_OG_CACHE_DIR';
/** Set by the integration: the sharecards font directory (the bundled endpoint cannot find it on its own). */
export const OG_FONTS_ENV = 'LECTIO_OG_FONTS_DIR';
/** Cache entries not used for this long are pruned after a build. */
export const OG_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Page paths (relative to the base path) that have a card, most specific first. */
const PAGE_PATTERNS = [
  /^(?<date>\d{4}-\d{2}-\d{2})\/(?<slot>[^/]+)\/notes\/(?<noteId>[^/]+)\/$/,
  /^(?<date>\d{4}-\d{2}-\d{2})\/(?<slot>[^/]+)\/$/,
  /^(?<date>\d{4}-\d{2}-\d{2})\/$/,
] as const;

/** What an image (or a page) is about. */
export type OgTarget =
  | { readonly kind: 'day'; readonly date: string }
  | { readonly kind: 'reading'; readonly date: string; readonly slot: string }
  | { readonly kind: 'insight'; readonly date: string; readonly slot: string; readonly noteId: string };

/** The image path of a target, relative to the base path: `og/2026-09-20/gospel.png`. */
export function ogImagePath(target: OgTarget): string {
  switch (target.kind) {
    case 'day':
      return `${OG_DIR}/${target.date}.png`;
    case 'reading':
      return `${OG_DIR}/${target.date}/${target.slot}.png`;
    default:
      return `${OG_DIR}/${target.date}/${target.slot}/${target.noteId}.png`;
  }
}

/**
 * The target of a page path relative to the base path: `2026-09-20/` is a day, `2026-09-20/gospel/` a reading,
 * `2026-09-20/gospel/notes/v15-evil-eye/` an insight; anything else is `null`.
 */
export function pageOgTarget(path: string): OgTarget | null {
  const clean = path.replace(/^\/+/, '');
  for (const pattern of PAGE_PATTERNS) {
    const groups = pattern.exec(clean)?.groups as { date: string; slot?: string; noteId?: string } | undefined;
    if (groups === undefined) continue;
    const { date, slot, noteId } = groups;
    if (slot === undefined) return { kind: 'day', date };
    return noteId === undefined ? { kind: 'reading', date, slot } : { kind: 'insight', date, slot, noteId };
  }
  return null;
}

/** What the card builders need: messages and paths (as the pages have them), the site URL and the content. */
export interface OgContext {
  readonly env: DayEnv;
  /** Absolute site URL (Astro's `site`). */
  readonly site: string | URL;
  /** Astro's `base`. */
  readonly base: string;
  readonly config: DayConfig;
  readonly repo: ContentRepo;
}

/** The day card for `date`, or `null` when no committed calendar has it. */
export function dayCard(context: OgContext, date: string): DayCard | null {
  const view = dayPageView(context.env, context, date);
  if (view === null) return null;
  const gospel = view.masses[0]?.readings.find((reading) => reading.slot === 'gospel');
  return {
    kind: 'day',
    date: view.date,
    colour: colourAttribute(view.colour),
    url: absoluteUrl(context.site, context.base, dayPath(view.date)),
    celebration: view.title,
    subtitle: view.season,
    ...(gospel === undefined ? {} : { gospelRef: gospel.refLabel }),
  };
}

/** The reading card for `date`/`slot`, or `null` when there is no such reading or its passage is not approved. */
export function readingCard(context: OgContext, date: string, slot: string): ReadingCard | null {
  const view = readingPage(context.repo, date, slot);
  if (view === null || view.notes === null) return null;
  return {
    kind: 'reading',
    date: view.date,
    colour: colourAttribute(view.colour),
    url: absoluteUrl(context.site, context.base, view.path),
    slotLabel: slotLabel(context.env, view.slot),
    ref: refLabel(view.ref),
    summary: view.notes.summary,
  };
}

/**
 * A note's verse written in full from the reading's reference: `Mt 20:1-16a` and `15` give `Matthew 20:15`, and
 * `21:3` (a verse in a later chapter) gives `Matthew 21:3`. A reference that does not parse is written as it is.
 */
export function noteVerseLabel(readingRef: string, verse: string): string {
  const parsed = tryParseRef(readingRef);
  if (!parsed.ok) return refLabel(readingRef);
  // A parsed reference always has at least one segment.
  const chapter = (parsed.value.segments[0] as Segment).start.c;
  const full = verse.includes(':') ? verse : `${String(chapter)}:${verse}`;
  return refLabel(`${getBook(parsed.value.book).abbrev} ${full}`);
}

/** The insight card for one note, or `null` when there is no such approved note. */
export function insightCard(context: OgContext, date: string, slot: string, noteId: string): InsightCard | null {
  const view = insightPage(context.repo, date, slot, noteId);
  if (view === null) return null;
  const { reading, note } = view;
  return {
    kind: 'insight',
    date: reading.date,
    colour: colourAttribute(reading.colour),
    url: absoluteUrl(context.site, context.base, view.path),
    quote: note.anchor,
    // `NoteView` carries the BCP 47 tag, which for the four original languages is the card's language code.
    original: {
      text: note.original.text,
      language: note.original.lang as OriginalLanguage,
      transliteration: note.original.translit,
    },
    slotLabel: slotLabel(context.env, reading.slot),
    ref: noteVerseLabel(reading.ref, note.verse),
  };
}

/**
 * Whether the card's original-language line can be drawn: `false` when the endpoint will fall back to a card
 * without it ({@link renderWithFallback}), so the alt text can leave it out too.
 */
export function canDrawOriginal(card: ShareCard): boolean {
  try {
    cardTemplate(card);
    return true;
  } catch (error) {
    if (error instanceof HebrewLayoutError) return false;
    throw error;
  }
}

/** The card an image target renders, or `null` when the content has none. */
export function ogCard(context: OgContext, target: OgTarget): ShareCard | null {
  switch (target.kind) {
    case 'day':
      return dayCard(context, target.date);
    case 'reading':
      return readingCard(context, target.date, target.slot);
    default:
      return insightCard(context, target.date, target.slot, target.noteId);
  }
}

/**
 * The share image of a page (`path` relative to the base path), or `null` for pages without a card of their own
 * (they keep the brand card). A Reading page without approved notes uses its day's image.
 */
export function ogImageForPage(context: OgContext, path: string): SeoImage | null {
  const target = pageOgTarget(path);
  if (target === null) return null;
  const candidates: OgTarget[] = target.kind === 'reading' ? [target, { kind: 'day', date: target.date }] : [target];
  for (const candidate of candidates) {
    const card = ogCard(context, candidate);
    if (card !== null) {
      return {
        src: withBase(context.base, ogImagePath(candidate)),
        width: OG_WIDTH,
        height: OG_HEIGHT,
        alt: cardAltText(card, { omitOriginal: !canDrawOriginal(card) }),
      };
    }
  }
  return null;
}

/** Static paths for `pages/og/[date].png.ts`: every day in the committed calendars. */
export function ogDayPaths(repo: ContentRepo): { params: { date: string } }[] {
  return calendarDates(repo).map((date) => ({ params: { date } }));
}

/** Static paths for `pages/og/[date]/[slot].png.ts`: every reading whose passage is approved. */
export function ogReadingPaths(repo: ContentRepo): { params: { date: string; slot: string } }[] {
  return readingStaticPaths(repo).filter(
    ({ params }) => (readingPage(repo, params.date, params.slot)?.notes ?? null) !== null,
  );
}

/** Static paths for `pages/og/[date]/[slot]/[noteId].png.ts`: every approved note. */
export function ogInsightPaths(repo: ContentRepo): { params: { date: string; slot: string; noteId: string } }[] {
  return insightStaticPaths(repo);
}

/** Running totals for the build log. Shared through `globalThis` so the integration sees what the endpoints did. */
export interface OgStats {
  rendered: number;
  cached: number;
  /** Milliseconds spent producing images (rendering or reading the cache). */
  ms: number;
}

const STATS_KEY = Symbol.for('lectio.og.stats');

/** The build's running totals (one object per process). */
export function ogStats(): OgStats {
  const holder = globalThis as { [STATS_KEY]?: OgStats };
  holder[STATS_KEY] ??= { rendered: 0, cached: 0, ms: 0 };
  return holder[STATS_KEY];
}

/** Zeroes the running totals (at the start of a build). */
export function resetOgStats(): void {
  Object.assign(ogStats(), { rendered: 0, cached: 0, ms: 0 });
}

export interface OgRenderOptions {
  /** Cache directory; `undefined` or `''` renders every card. */
  readonly cacheDir?: string | undefined;
  /** sharecards font directory; defaults to the package's own. */
  readonly fontsDir?: string | undefined;
  /** The renderer (tests pass a fake); defaults to `renderCard`. */
  readonly render?: (card: ShareCard, options: RenderOptions) => Promise<Buffer>;
  /** Clock for the timings; defaults to `performance.now`. */
  readonly now?: () => number;
}

/**
 * Renders a card, falling back to a card without the original-language line when its Hebrew cannot be drawn (rather
 * than failing the build).
 */
export async function renderWithFallback(
  card: ShareCard,
  options: RenderOptions,
  render: (card: ShareCard, options: RenderOptions) => Promise<Buffer> = renderCard,
): Promise<Buffer> {
  try {
    return await render(card, options);
  } catch (error) {
    if (!(error instanceof HebrewLayoutError)) throw error;
    return render(card, { ...options, omitOriginal: true });
  }
}

/** The options the endpoints read from the environment the integration set up. */
export function ogEnvOptions(env: Readonly<Record<string, string | undefined>> = process.env): OgRenderOptions {
  return { cacheDir: env[OG_CACHE_ENV], fontsDir: env[OG_FONTS_ENV] };
}

/**
 * The PNG for `card`: from the cache when an entry with its {@link cardCacheKey} exists (its mtime is bumped so
 * pruning keeps it), otherwise rendered and stored. Cache writes go through a temporary file and a rename, so an
 * interrupted build never leaves a truncated entry.
 */
export async function renderOgImage(card: ShareCard, options: OgRenderOptions = {}): Promise<Buffer> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const stats = ogStats();
  const fonts = await loadFonts(options.fontsDir || undefined);
  const render = (): Promise<Buffer> => renderWithFallback(card, { fonts }, options.render);
  try {
    const { cacheDir } = options;
    if (cacheDir === undefined || cacheDir === '') {
      stats.rendered += 1;
      return await render();
    }
    const file = join(cacheDir, `${await cardCacheKey(card, { fonts })}.png`);
    try {
      const cached = await readFile(file);
      const touched = new Date();
      await utimes(file, touched, touched);
      stats.cached += 1;
      return cached;
    } catch {
      // Not cached yet.
    }
    const png = await render();
    await mkdir(cacheDir, { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, png);
    await rename(temporary, file);
    stats.rendered += 1;
    return png;
  } finally {
    stats.ms += now() - started;
  }
}

/** A `Response` for an image endpoint. */
export function pngResponse(png: Buffer): Response {
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
}

/** Deletes cache entries (and stray temporary files) not used for `maxAgeMs`; returns how many it removed. */
export async function pruneOgCache(
  cacheDir: string,
  now: number = Date.now(),
  maxAgeMs: number = OG_CACHE_MAX_AGE_MS,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const file = join(cacheDir, entry);
    const info = await stat(file);
    if (info.isFile() && now - info.mtimeMs > maxAgeMs) {
      await rm(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/** Width and height of a PNG from its IHDR chunk, or `null` when the bytes are not a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || signature.some((byte, i) => png[i] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** `&quot;`, `&#39;`, `&lt;`, `&gt;` and `&amp;` decoded (what an HTML serialiser escapes in attributes). */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The `property`/`name` to `content` pairs of every `<meta>` element (the first wins), whatever the attribute order. */
export function metaContents(html: string): Map<string, string> {
  const contents = new Map<string, string>();
  for (const [element] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const match of element.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes.set((match[1] as string).toLowerCase(), unescapeAttribute(match[2] ?? match[3] ?? ''));
    }
    const key = attributes.get('property') ?? attributes.get('name');
    const content = attributes.get('content');
    if (key !== undefined && content !== undefined && !contents.has(key)) contents.set(key, content);
  }
  return contents;
}

/** The Open Graph image tags of an HTML document (attribute values unescaped), or `null` without `og:image`. */
export function ogImageMeta(html: string): { url: string; width?: string; height?: string; alt?: string } | null {
  const contents = metaContents(html);
  const url = contents.get('og:image');
  if (url === undefined) return null;
  const meta: { url: string; width?: string; height?: string; alt?: string } = { url };
  const width = contents.get('og:image:width');
  const height = contents.get('og:image:height');
  const alt = contents.get('og:image:alt');
  if (width !== undefined) meta.width = width;
  if (height !== undefined) meta.height = height;
  if (alt !== undefined) meta.alt = alt;
  return meta;
}

/** Every `index.html` under `dir`, as paths relative to it with `/` separators. */
async function htmlPages(dir: string, root: string = dir): Promise<string[]> {
  const pages: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages.push(...(await htmlPages(full, root)));
    else if (entry.name === 'index.html') pages.push(relative(root, full).split(sep).join('/'));
  }
  return pages.sort();
}

export interface OgDistReport {
  /** HTML pages checked. */
  readonly pages: number;
  /** Distinct images under `og/` that pages point at. */
  readonly images: number;
  /** One line per problem; empty when every page is fine. */
  readonly problems: readonly string[];
}

/**
 * Checks a built site: every page has an absolute `og:image` under the site URL whose file exists in `distDir` and
 * is a 1200×630 PNG of at most 300 KB, with matching width and height tags and alt text; day, reading and insight
 * pages point at an image under `og/`.
 */
export async function checkOgDist(distDir: string, site: string | URL, base: string): Promise<OgDistReport> {
  const problems: string[] = [];
  const images = new Set<string>();
  const checked = new Map<string, string | null>();
  const pages = await htmlPages(distDir);
  const root = new URL(withBase(base), site);
  for (const page of pages) {
    const pagePath = page.replace(/index\.html$/, '');
    const meta = ogImageMeta(await readFile(join(distDir, page), 'utf8'));
    if (meta === null) {
      problems.push(`${page}: no og:image`);
      continue;
    }
    if (!meta.url.startsWith(root.href)) {
      problems.push(`${page}: og:image ${meta.url} is not an absolute URL under ${root.href}`);
      continue;
    }
    const imagePath = decodeURIComponent(meta.url.slice(root.href.length));
    if (meta.width !== String(OG_WIDTH) || meta.height !== String(OG_HEIGHT)) {
      problems.push(`${page}: og:image:width/height are ${String(meta.width)}×${String(meta.height)}`);
    }
    if (meta.alt === undefined || meta.alt.trim() === '') problems.push(`${page}: no og:image:alt`);
    if (pageOgTarget(pagePath) !== null) {
      if (imagePath.startsWith(`${OG_DIR}/`)) images.add(imagePath);
      else problems.push(`${page}: og:image ${imagePath} is not a page image under ${OG_DIR}/`);
    }
    if (!checked.has(imagePath)) checked.set(imagePath, await imageProblem(join(distDir, imagePath)));
    const problem = checked.get(imagePath) ?? null;
    if (problem !== null) problems.push(`${page}: ${imagePath} ${problem}`);
  }
  return { pages: pages.length, images: images.size, problems };
}

/** Why an image file is not a valid share image, or `null` when it is. */
async function imageProblem(file: string): Promise<string | null> {
  let png: Buffer;
  try {
    png = await readFile(file);
  } catch {
    return 'does not exist';
  }
  const size = pngSize(png);
  if (size === null) return 'is not a PNG';
  if (size.width !== OG_WIDTH || size.height !== OG_HEIGHT) {
    return `is ${String(size.width)}×${String(size.height)}, not ${String(OG_WIDTH)}×${String(OG_HEIGHT)}`;
  }
  if (png.length > OG_MAX_BYTES) return `is ${String(png.length)} bytes, over ${String(OG_MAX_BYTES)}`;
  return null;
}
