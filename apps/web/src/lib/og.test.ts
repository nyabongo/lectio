import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentRepo } from '@lectio/content';
import { DEFAULT_FONTS_DIR, HebrewLayoutError, cardCacheKey, loadFonts, renderCard } from '@lectio/sharecards';
import type { DayCard, InsightCard, RenderOptions, ShareCard } from '@lectio/sharecards';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDate, t } from '../i18n/index.ts';
import {
  OG_CACHE_ENV,
  OG_CACHE_MAX_AGE_MS,
  OG_FONTS_ENV,
  OG_HEIGHT,
  OG_MAX_BYTES,
  OG_WIDTH,
  canDrawOriginal,
  checkOgDist,
  dayCard,
  insightCard,
  metaContents,
  noteVerseLabel,
  ogAltLabels,
  ogCard,
  ogDayPaths,
  ogEnvOptions,
  ogImageForPage,
  ogImageMeta,
  ogImagePath,
  ogInsightPaths,
  ogReadingPaths,
  ogStats,
  pageOgTarget,
  pngResponse,
  pngSize,
  pruneOgCache,
  readingCard,
  renderOgImage,
  renderWithFallback,
  resetOgStats,
} from './og.ts';
import { localeRepo } from './notes-locale.ts';
import type { OgContext } from './og.ts';
import { siteContext } from './site.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { config, repo } = siteContext({
  cwd: webRoot,
  env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' },
});
const SITE = 'https://lectio.example/';
const BASE = '/lectio/';
const context: OgContext = {
  env: { lang: 'en', messages: { t, formatDate }, paths: (path) => `${BASE}${path}` },
  site: SITE,
  base: BASE,
  config,
  repo,
};
const SUNDAY = '2026-09-20';

/** `repo` with every resolved day's Masses replaced (a day with no readings). */
function withoutMasses(source: ContentRepo): ContentRepo {
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property === 'resolveDay') {
        return (date: string) => {
          const day = target.resolveDay(date);
          return day === null ? null : { ...day, masses: [] };
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** A minimal PNG header (signature and IHDR) for the given size, padded to `bytes`. */
function pngHeader(width: number, height: number, bytes = 64): Buffer {
  const png = Buffer.alloc(Math.max(bytes, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'latin1');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

describe('paths and targets', () => {
  it('puts each image under og/', () => {
    expect(ogImagePath({ kind: 'day', date: SUNDAY })).toBe('og/2026-09-20.png');
    expect(ogImagePath({ kind: 'reading', date: SUNDAY, slot: 'gospel' })).toBe('og/2026-09-20/gospel.png');
    expect(ogImagePath({ kind: 'insight', date: SUNDAY, slot: 'gospel', noteId: 'v15-evil-eye' })).toBe(
      'og/2026-09-20/gospel/v15-evil-eye.png',
    );
  });

  it('reads the target of a day, reading or insight page path', () => {
    expect(pageOgTarget('2026-09-20/')).toEqual({ kind: 'day', date: SUNDAY });
    expect(pageOgTarget('/2026-09-20/gospel/')).toEqual({ kind: 'reading', date: SUNDAY, slot: 'gospel' });
    expect(pageOgTarget('2026-09-20/gospel/notes/v15-evil-eye/')).toEqual({
      kind: 'insight',
      date: SUNDAY,
      slot: 'gospel',
      noteId: 'v15-evil-eye',
    });
    for (const path of ['', 'calendar/', 'calendar/2026/09/', 'passages/MT.20.1-16/', '2026-09-20', 'about/'])
      expect(pageOgTarget(path), path).toBeNull();
  });
});

describe('cards', () => {
  it('builds the day card from the day view', () => {
    expect(dayCard(context, SUNDAY)).toEqual({
      kind: 'day',
      date: SUNDAY,
      colour: 'green',
      url: 'https://lectio.example/lectio/2026-09-20/',
      celebration: 'Twenty-fifth Sunday in Ordinary Time',
      subtitle: 'Ordinary Time · Week 25',
      gospelRef: 'Matthew 20:1–16a',
    });
    expect(dayCard(context, '1999-01-01')).toBeNull();
  });

  it('leaves the Gospel off a day without readings', () => {
    const card = dayCard({ ...context, repo: withoutMasses(repo) }, SUNDAY);
    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty('gospelRef');
  });

  it('names Holy Saturday without the Vigil and leaves the Gospel off its card', () => {
    const card = dayCard(context, '2026-04-04');
    expect(card).toMatchObject({ kind: 'day', colour: 'violet', celebration: 'Holy Saturday' });
    expect(card).not.toHaveProperty('gospelRef');
  });

  it('builds the reading card from the approved summary, and none for a pending reading', () => {
    const card = readingCard(context, SUNDAY, 'gospel');
    expect(card).toMatchObject({
      kind: 'reading',
      date: SUNDAY,
      colour: 'green',
      url: 'https://lectio.example/lectio/2026-09-20/gospel/',
      slotLabel: 'Gospel',
      ref: 'Matthew 20:1–16a',
    });
    expect(card?.summary.length).toBeGreaterThan(0);
    expect(readingCard(context, SUNDAY, 'first-reading')).toBeNull();
    expect(readingCard(context, SUNDAY, 'no-such-slot')).toBeNull();
    expect(readingCard(context, '1999-01-01', 'gospel')).toBeNull();
  });

  it('writes a note verse in full', () => {
    expect(noteVerseLabel('Mt 20:1-16a', '15')).toBe('Matthew 20:15');
    expect(noteVerseLabel('Mt 20:1-16a', '21:3')).toBe('Matthew 21:3');
    expect(noteVerseLabel('not a reference', '15')).toBe('not a reference');
  });

  it('builds the insight card from the note', () => {
    expect(insightCard(context, SUNDAY, 'gospel', 'v15-evil-eye')).toEqual({
      kind: 'insight',
      date: SUNDAY,
      colour: 'green',
      url: 'https://lectio.example/lectio/2026-09-20/gospel/notes/v15-evil-eye/',
      quote: 'envious',
      original: { text: 'ὀφθαλμός σου πονηρός', language: 'grc', transliteration: 'ophthalmos sou ponēros' },
      slotLabel: 'Gospel',
      ref: 'Matthew 20:15',
    });
    expect(insightCard(context, SUNDAY, 'gospel', 'no-such-note')).toBeNull();
  });

  it('dispatches on the target kind', () => {
    expect(ogCard(context, { kind: 'day', date: SUNDAY })?.kind).toBe('day');
    expect(ogCard(context, { kind: 'reading', date: SUNDAY, slot: 'gospel' })?.kind).toBe('reading');
    expect(ogCard(context, { kind: 'insight', date: SUNDAY, slot: 'gospel', noteId: 'v15-evil-eye' })?.kind).toBe(
      'insight',
    );
  });
});

describe('ogImageForPage', () => {
  it('gives day, reading and insight pages their own image with size and alt text', () => {
    expect(ogImageForPage(context, '2026-09-20/')).toEqual({
      src: '/lectio/og/2026-09-20.png',
      width: 1200,
      height: 630,
      alt: expect.stringMatching(/^Lectio card for Sunday 20 September 2026: Twenty-fifth Sunday/) as string,
    });
    expect(ogImageForPage(context, '2026-09-20/gospel/')?.src).toBe('/lectio/og/2026-09-20/gospel.png');
    expect(ogImageForPage(context, '2026-09-20/gospel/notes/v15-evil-eye/')?.src).toBe(
      '/lectio/og/2026-09-20/gospel/v15-evil-eye.png',
    );
  });

  it('describes the original phrase in the insight alt text', () => {
    expect(ogImageForPage(context, '2026-09-20/gospel/notes/v15-evil-eye/')?.alt).toBe(
      'Lectio card for Sunday 20 September 2026: “envious”. Greek: ophthalmos sou ponēros. ' +
        'What the Greek of today’s Gospel really says — Matthew 20:15',
    );
  });

  it('gives a pending reading the day image', () => {
    expect(ogImageForPage(context, '2026-09-20/first-reading/')?.src).toBe('/lectio/og/2026-09-20.png');
  });

  it('gives other pages none', () => {
    expect(ogImageForPage(context, 'calendar/')).toBeNull();
    expect(ogImageForPage(context, '1999-01-01/')).toBeNull();
    expect(ogImageForPage(context, '1999-01-01/gospel/')).toBeNull();
    expect(ogImageForPage(context, '2026-09-20/gospel/notes/no-such-note/')).toBeNull();
  });
});

describe('Kiswahili cards (L-113)', () => {
  const sw: OgContext = {
    ...context,
    env: { lang: 'sw', messages: { t, formatDate }, paths: (path) => `${BASE}sw/${path}` },
    repo: localeRepo(repo, 'sw'),
    defaultLocale: 'en',
  };

  it('puts each Kiswahili image under og/sw/, and the default locale’s at the root', () => {
    expect(ogImagePath({ kind: 'day', date: SUNDAY }, 'sw')).toBe('og/sw/2026-09-20.png');
    expect(ogImagePath({ kind: 'reading', date: SUNDAY, slot: 'gospel' }, 'sw', 'en')).toBe(
      'og/sw/2026-09-20/gospel.png',
    );
    expect(ogImagePath({ kind: 'day', date: SUNDAY }, 'en')).toBe('og/2026-09-20.png');
    expect(ogImagePath({ kind: 'day', date: SUNDAY }, 'sw', 'sw')).toBe('og/2026-09-20.png');
  });

  it('writes the day card’s date, Gospel label and reference in Kiswahili', () => {
    expect(dayCard(sw, SUNDAY)).toMatchObject({
      url: 'https://lectio.example/lectio/sw/2026-09-20/',
      dateLabel: 'Jumapili 20 Septemba 2026',
      gospelLabel: 'Injili',
      gospelRef: 'Mathayo 20:1–16a',
    });
    expect(dayCard({ ...sw, repo: withoutMasses(sw.repo) }, SUNDAY)).not.toHaveProperty('gospelLabel');
  });

  it('builds the reading card from the reviewed Kiswahili summary', () => {
    expect(readingCard(sw, SUNDAY, 'gospel')).toMatchObject({
      url: 'https://lectio.example/lectio/sw/2026-09-20/gospel/',
      slotLabel: 'Injili',
      ref: 'Mathayo 20:1–16a',
      dateLabel: 'Jumapili 20 Septemba 2026',
      summary: expect.stringMatching(/^Mwenye shamba anawalipa/) as string,
    });
  });

  it('builds the insight card from the Kiswahili anchor with a Kiswahili caption', () => {
    expect(insightCard(sw, SUNDAY, 'gospel', 'v15-evil-eye')).toMatchObject({
      url: 'https://lectio.example/lectio/sw/2026-09-20/gospel/notes/v15-evil-eye/',
      quote: 'wivu',
      ref: 'Mathayo 20:15',
      caption: 'Kile ambacho Kigiriki cha Injili ya leo kinasema hasa — Mathayo 20:15',
    });
    expect(noteVerseLabel('Mt 20:1-16a', '15', 'sw')).toBe('Mathayo 20:15');
  });

  it('points a Kiswahili page at its Kiswahili image with Kiswahili alt text', () => {
    expect(ogImageForPage(sw, '2026-09-20/gospel/notes/v15-evil-eye/')).toEqual({
      src: '/lectio/og/sw/2026-09-20/gospel/v15-evil-eye.png',
      width: 1200,
      height: 630,
      alt:
        'Kadi ya Lectio ya Jumapili 20 Septemba 2026: “wivu”. Kigiriki: ophthalmos sou ponēros. ' +
        'Kile ambacho Kigiriki cha Injili ya leo kinasema hasa — Mathayo 20:15',
    });
    expect(ogImageForPage(sw, '2026-09-20/first-reading/')?.src).toBe('/lectio/og/sw/2026-09-20.png');
    expect(ogAltLabels(context)).toEqual({});
  });

  it('shows the English summary on a Kiswahili card when the translation is stale or missing', () => {
    const fallback = { ...sw, repo: localeRepo(repo, 'sw', { translations: () => null }) };
    expect(readingCard(fallback, SUNDAY, 'gospel')?.summary).toBe(readingCard(context, SUNDAY, 'gospel')?.summary);
    expect(insightCard(fallback, SUNDAY, 'gospel', 'v15-evil-eye')?.quote).toBe('envious');
  });
});

describe('static paths', () => {
  it('has one day image per calendar day, reading images only for approved passages, and every insight', () => {
    expect(ogDayPaths(repo).map(({ params }) => params.date)).toEqual([
      '2026-04-04',
      '2026-09-14',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ]);
    expect(ogReadingPaths(repo)).toEqual([
      { params: { date: '2026-09-14', slot: 'first-reading' } },
      { params: { date: SUNDAY, slot: 'gospel' } },
    ]);
    const insights = ogInsightPaths(repo);
    expect(insights).toContainEqual({ params: { date: SUNDAY, slot: 'gospel', noteId: 'v15-evil-eye' } });
    expect(insights).toContainEqual({
      params: { date: '2026-09-14', slot: 'first-reading', noteId: 'v9-bronze-serpent' },
    });
    expect(
      insights.filter(({ params }) => params.date === SUNDAY).every(({ params }) => params.slot === 'gospel'),
    ).toBe(true);
  });
});

describe('rendering', () => {
  const card = dayCard(context, SUNDAY) as DayCard;
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'lectio-og-'));
    resetOgStats();
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('falls back with the real renderer when a mixed-script Hebrew phrase has no transliteration', async () => {
    const insight = insightCard(context, SUNDAY, 'gospel', 'v15-evil-eye') as InsightCard;
    const mixed: InsightCard = { ...insight, original: { text: 'רָעָה 15:9', language: 'hbo' } };
    expect(canDrawOriginal(mixed)).toBe(false);
    await expect(renderCard(mixed, { fonts: await loadFonts() })).rejects.toBeInstanceOf(HebrewLayoutError);
    const png = await renderWithFallback(mixed, { fonts: await loadFonts() });
    expect(pngSize(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
    expect(png.equals(await renderCard(mixed, { fonts: await loadFonts(), omitOriginal: true }))).toBe(true);
  });

  it('only treats a Hebrew layout failure as an undrawable original', () => {
    expect(canDrawOriginal(card)).toBe(true);
    expect(() => canDrawOriginal({ ...card, kind: 'poster' } as unknown as ShareCard)).toThrow(/Unexpected value/);
  });

  it('falls back to a card without the original line when the Hebrew cannot be drawn', async () => {
    const render = vi.fn((_card: ShareCard, options: RenderOptions) =>
      options.omitOriginal === true
        ? Promise.resolve(Buffer.from('bare'))
        : Promise.reject(new HebrewLayoutError('רָעָה 15:9')),
    );
    expect((await renderWithFallback(card, {}, render)).toString()).toBe('bare');
    expect(render).toHaveBeenCalledTimes(2);
    const broken = () => Promise.reject(new Error('boom'));
    await expect(renderWithFallback(card, {}, broken)).rejects.toThrow('boom');
  });

  it('reads the cache and font directories from the environment', () => {
    expect(ogEnvOptions({ [OG_CACHE_ENV]: '/cache', [OG_FONTS_ENV]: '/fonts' })).toEqual({
      cacheDir: '/cache',
      fontsDir: '/fonts',
    });
    expect(ogEnvOptions({})).toEqual({ cacheDir: undefined, fontsDir: undefined });
    expect(ogEnvOptions()).toHaveProperty('cacheDir');
  });

  it('renders every card when there is no cache', async () => {
    const render = vi.fn(() => Promise.resolve(Buffer.from('png')));
    let clock = 0;
    const now = () => (clock += 5);
    expect((await renderOgImage(card, { render, now })).toString()).toBe('png');
    expect((await renderOgImage(card, { render, now, cacheDir: '' })).toString()).toBe('png');
    expect(render).toHaveBeenCalledTimes(2);
    expect(ogStats()).toEqual({ rendered: 2, cached: 0, ms: 10 });
  });

  it('stores a rendered card under its cache key and reuses it', async () => {
    const render = vi.fn(() => Promise.resolve(Buffer.from('png')));
    const options = { render, cacheDir: join(cacheDir, 'nested'), fontsDir: DEFAULT_FONTS_DIR };
    await renderOgImage(card, options);
    const key = await cardCacheKey(card, { fonts: await loadFonts() });
    expect(await readdir(join(cacheDir, 'nested'))).toEqual([`${key}.png`]);

    const file = join(cacheDir, 'nested', `${key}.png`);
    const old = new Date(Date.now() - OG_CACHE_MAX_AGE_MS * 2);
    await utimes(file, old, old);
    expect((await renderOgImage(card, options)).toString()).toBe('png');
    expect(render).toHaveBeenCalledTimes(1);
    expect((await stat(file)).mtimeMs).toBeGreaterThan(old.getTime());
    expect(ogStats()).toMatchObject({ rendered: 1, cached: 1 });
  });

  it('renders a real card by default', async () => {
    const png = await renderOgImage(card, { cacheDir });
    expect(pngSize(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
    expect(png.length).toBeLessThanOrEqual(OG_MAX_BYTES);
  });

  it('wraps a PNG in an image response', async () => {
    const response = pngResponse(Buffer.from('png'));
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(await response.text()).toBe('png');
  });
});

describe('pruneOgCache', () => {
  it('removes entries unused for the maximum age and keeps the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lectio-og-prune-'));
    try {
      const now = Date.now();
      await writeFile(join(dir, 'old.png'), 'x');
      await writeFile(join(dir, 'fresh.png'), 'x');
      await mkdir(join(dir, 'folder'));
      const old = new Date(now - OG_CACHE_MAX_AGE_MS - 1000);
      await utimes(join(dir, 'old.png'), old, old);
      await utimes(join(dir, 'folder'), old, old);
      expect(await pruneOgCache(dir, now)).toBe(1);
      expect((await readdir(dir)).sort()).toEqual(['folder', 'fresh.png']);
      expect(await pruneOgCache(dir)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does nothing without a cache directory', async () => {
    expect(await pruneOgCache(join(tmpdir(), 'lectio-og-missing-dir'))).toBe(0);
  });
});

describe('pngSize', () => {
  it('reads the IHDR size and rejects anything else', () => {
    expect(pngSize(pngHeader(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect(pngSize(Buffer.from('not a png at all, really not'))).toBeNull();
    expect(pngSize(Buffer.alloc(10))).toBeNull();
    const noHeader = pngHeader(1, 1);
    noHeader.write('IDAT', 12, 'latin1');
    expect(pngSize(noHeader)).toBeNull();
  });
});

describe('ogImageMeta', () => {
  it('reads the image tags and unescapes them', () => {
    const html =
      '<meta property="og:image" content="https://x/og/a.png?a=1&amp;b=2">' +
      '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
      '<meta property="og:image:alt" content="&quot;Q&quot; &lt;b&gt; it&#39;s">';
    expect(ogImageMeta(html)).toEqual({
      url: 'https://x/og/a.png?a=1&b=2',
      width: '1200',
      height: '630',
      alt: '"Q" <b> it\'s',
    });
    expect(ogImageMeta('<meta property="og:image" content="https://x/a.png">')).toEqual({ url: 'https://x/a.png' });
    expect(ogImageMeta('<title>x</title>')).toBeNull();
  });

  it('does not depend on the attribute order or quoting', () => {
    const html =
      `<meta content="https://x/b.png" property="og:image"><META CONTENT='630' PROPERTY='og:image:height'>` +
      '<meta data-x="1" content="Alt" property="og:image:alt" /><meta property="og:image" content="https://x/2.png">' +
      '<meta charset="utf-8"><meta name="twitter:card" content="summary_large_image">';
    expect(ogImageMeta(html)).toEqual({ url: 'https://x/b.png', height: '630', alt: 'Alt' });
    expect(metaContents(html).get('twitter:card')).toBe('summary_large_image');
    expect(metaContents(html).has('charset')).toBe(false);
  });
});

describe('checkOgDist', () => {
  let dist: string;
  const page = (image: string, { width = '1200', height = '630', alt = 'Alt' } = {}) =>
    `<html><head><meta property="og:image" content="${image}">` +
    `<meta property="og:image:width" content="${width}"><meta property="og:image:height" content="${height}">` +
    (alt === '' ? '' : `<meta property="og:image:alt" content="${alt}">`) +
    '</head></html>';

  async function put(path: string, content: string | Buffer): Promise<void> {
    await mkdir(dirname(join(dist, path)), { recursive: true });
    await writeFile(join(dist, path), content);
  }

  beforeEach(async () => {
    dist = await mkdtemp(join(tmpdir(), 'lectio-og-dist-'));
    await put('og/2026-09-20.png', pngHeader(1200, 630));
    await put('_astro/brand.png', pngHeader(1200, 630));
    await put('index.html', page('https://lectio.example/lectio/_astro/brand.png'));
    await put('2026-09-20/index.html', page('https://lectio.example/lectio/og/2026-09-20.png'));
    await put('2026-09-20/gospel/index.html', page('https://lectio.example/lectio/og/2026-09-20.png'));
    await put('404.html', '<html></html>');
  });

  afterEach(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  it('passes a site whose pages all have valid images', async () => {
    expect(await checkOgDist(dist, SITE, '/lectio')).toEqual({ pages: 3, images: 1, problems: [] });
  });

  it('wants a page under a locale to use that locale’s image (L-113)', async () => {
    await put('og/sw/2026-09-20.png', pngHeader(1200, 630));
    await put('sw/2026-09-20/index.html', page('https://lectio.example/lectio/og/sw/2026-09-20.png'));
    await put('sw/2026-09-20/gospel/index.html', page('https://lectio.example/lectio/og/2026-09-20.png'));
    await put('sw/calendar/index.html', page('https://lectio.example/lectio/_astro/brand.png'));
    const report = await checkOgDist(dist, SITE, '/lectio/', ['sw']);
    expect(report.images).toBe(2);
    expect(report.problems).toEqual([
      'sw/2026-09-20/gospel/index.html: og:image og/2026-09-20.png is not a page image under og/sw/',
    ]);
  });

  it('reports every kind of problem', async () => {
    await put('og/small.png', pngHeader(600, 315));
    await put('og/big.png', pngHeader(1200, 630, OG_MAX_BYTES + 1));
    await put('og/text.png', 'not a png');
    await put('about/index.html', '<html></html>');
    await put('calendar/index.html', page('https://elsewhere.example/og.png'));
    await put('passages/index.html', page('https://lectio.example/lectio/og/small.png', { width: '600' }));
    await put('search/index.html', page('https://lectio.example/lectio/og/big.png', { alt: '' }));
    await put('settings/index.html', page('https://lectio.example/lectio/og/text.png'));
    await put('2026-09-21/index.html', page('https://lectio.example/lectio/_astro/brand.png'));
    await put('2026-09-22/index.html', page('https://lectio.example/lectio/og/2026-09-22.png'));
    const report = await checkOgDist(dist, SITE, '/lectio/');
    expect(report.pages).toBe(10);
    expect(report.problems).toEqual([
      '2026-09-21/index.html: og:image _astro/brand.png is not a page image under og/',
      '2026-09-22/index.html: og/2026-09-22.png does not exist',
      'about/index.html: no og:image',
      'calendar/index.html: og:image https://elsewhere.example/og.png is not an absolute URL under https://lectio.example/lectio/',
      'passages/index.html: og:image:width/height are 600×630',
      'passages/index.html: og/small.png is 600×315, not 1200×630',
      'search/index.html: no og:image:alt',
      `search/index.html: og/big.png is ${String(OG_MAX_BYTES + 1)} bytes, over ${String(OG_MAX_BYTES)}`,
      'settings/index.html: og/text.png is not a PNG',
    ]);
  });
});
