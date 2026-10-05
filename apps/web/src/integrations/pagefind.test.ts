/**
 * Post-build test for L-060: runs the `lectio:pagefind` build hook with the real Pagefind node API over the fixture
 * build's config and content (`npm run build:fixture`: test/lectio.config.fixture.json), then loads the generated
 * `pagefind.js` in Node, the way the search page does in a browser, and searches it.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { AstroIntegration } from 'astro';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PAGEFIND_DIR } from '../lib/search.ts';
import type { PagefindApi } from '../lib/search.ts';
import { normaliseBase, siteContext } from '../lib/site.ts';
import { buildSearchIndex, pagefind, searchLabels } from './pagefind.ts';

type Hook = NonNullable<AstroIntegration['hooks']['astro:build:done']>;

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
  sub_results: { url: string }[];
}
interface PagefindModule {
  options(options: { basePath: string; baseUrl: string }): Promise<void>;
  search(term: string): Promise<{ results: { data(): Promise<PagefindResultData> }[] }>;
  filters(): Promise<Record<string, Record<string, number>>>;
}

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { config, contentRoot } = siteContext({
  env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' },
  cwd: webRoot,
});
const options = { config, contentRoot };
const base = normaliseBase(config.site.basePath);

let outDir: string;
const logged: string[] = [];
let pagefindJs: PagefindModule;
let pagefindSw: PagefindModule;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'lectio-pagefind-'));
  const done = pagefind(options).hooks['astro:build:done'] as Hook;
  await done({
    dir: pathToFileURL(`${outDir}/`),
    logger: { info: (message: string) => logged.push(message) },
  } as unknown as Parameters<Hook>[0]);
  // pagefind.js fetches its chunks from the bundle URL; serve them from the output directory.
  const bundle = join(outDir, PAGEFIND_DIR);
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = new URL(String(input), 'http://site.test').pathname;
    const file = join(bundle, path.slice(`${base}${PAGEFIND_DIR}/`.length));
    return new Response(await readFile(file));
  });
  // Pagefind picks the index of the page's <html lang>, as the search page in each locale does (L-113).
  const load = async (lang: string): Promise<PagefindModule> => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', new URL(`http://site.test${base}`));
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => lang }) });
    const url = `${pathToFileURL(join(bundle, 'pagefind.js')).href}?lang=${lang}`;
    const module = (await import(/* @vite-ignore */ url)) as PagefindModule;
    await module.options({ basePath: `${base}${PAGEFIND_DIR}/`, baseUrl: base });
    await module.filters();
    return module;
  };
  pagefindJs = await load('en');
  pagefindSw = await load('sw');
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  vi.stubGlobal('location', undefined);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(outDir, { recursive: true, force: true });
});

describe('Pagefind on the fixture build', () => {
  it('writes the index and the Pagefind UI into <outDir>/pagefind', () => {
    for (const file of ['pagefind.js', 'pagefind-entry.json', 'pagefind-ui.js', 'pagefind-ui.css'])
      expect(existsSync(join(outDir, PAGEFIND_DIR, file)), file).toBe(true);
    expect(logged).toEqual(['Pagefind indexed 4 reading pages']);
  });

  it("finds the 2026-09-20 Gospel page for 'evil eye'", async () => {
    const { results } = await pagefindJs.search('evil eye');
    expect(results.length).toBeGreaterThan(0);
    const first = await results[0]?.data();
    expect(first?.url).toBe(`${base}2026-09-20/gospel/`);
    expect(first?.excerpt).toContain('<mark>evil</mark>');
    // Sub-results deep-link to the Context panel and the note on the Reading page.
    expect(first?.sub_results.map((sub) => sub.url)).toEqual(
      expect.arrayContaining([`${base}2026-09-20/gospel/#context`, `${base}2026-09-20/gospel/#note-v15-evil-eye`]),
    );
    expect(first?.meta).toMatchObject({
      title: 'Mt 20:1-16a · Gospel · Sunday 20 September 2026',
      ref: 'Mt 20:1-16a',
      date: 'Sunday 20 September 2026',
    });
    expect(first?.filters).toEqual({ book: ['Matthew'], season: ['Ordinary Time'] });
  });

  it('offers the book and season filters', async () => {
    expect(await pagefindJs.filters()).toEqual({ book: { Matthew: 1, Numbers: 1 }, season: { 'Ordinary Time': 2 } });
  });

  it('indexes note content only: page chrome and pending passages are not searchable', async () => {
    // "Calendar" is in every page header; the Isaiah 55 passage (about the exiles) is pending in the fixture.
    expect((await pagefindJs.search('calendar')).results).toHaveLength(0);
    expect((await pagefindJs.search('exiles')).results).toHaveLength(0);
  });
});

describe('Pagefind in Kiswahili (L-113)', () => {
  it('finds the /sw/ Gospel page by its Kiswahili notes', async () => {
    const { results } = await pagefindSw.search('jicho ovu');
    expect(results.length).toBeGreaterThan(0);
    const first = await results[0]?.data();
    expect(first?.url).toBe(`${base}sw/2026-09-20/gospel/`);
    expect(first?.filters).toEqual({ book: ['Mathayo'], season: ['Kipindi cha Kawaida'] });
    expect(first?.meta.date).toBe('Jumapili 20 Septemba 2026');
  });

  it('keeps the two languages apart: each index holds only its own pages', async () => {
    const urls = async (module: PagefindModule, term: string): Promise<string[]> =>
      Promise.all((await module.search(term)).results.map(async (result) => (await result.data()).url));
    expect(await urls(pagefindJs, 'evil')).toEqual([`${base}2026-09-20/gospel/`]);
    expect(await urls(pagefindSw, 'jicho')).toEqual([`${base}sw/2026-09-20/gospel/`]);
  });
});

describe('buildSearchIndex', () => {
  it('writes the bundle Pagefind returns into <outDir>/pagefind, subdirectories included', async () => {
    const files = [
      { path: 'pagefind.js', content: new TextEncoder().encode('js') },
      { path: 'fragment/en_1.pf_fragment', content: new Uint8Array([31, 139, 8]) },
    ];
    const api: PagefindApi = {
      createIndex: () =>
        Promise.resolve({
          errors: [],
          index: {
            addHTMLFile: () => Promise.resolve({ errors: [] }),
            getFiles: () => Promise.resolve({ errors: [], files }),
          },
        }),
      close: () => Promise.resolve(null),
    };
    const site = await mkdtemp(join(tmpdir(), 'lectio-pagefind-fake-'));
    try {
      await expect(buildSearchIndex(options, site, api)).resolves.toBe(4);
      expect(await readFile(join(site, PAGEFIND_DIR, 'pagefind.js'), 'utf8')).toBe('js');
      expect([...(await readFile(join(site, PAGEFIND_DIR, 'fragment/en_1.pf_fragment')))]).toEqual([31, 139, 8]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe('searchLabels', () => {
  const labels = searchLabels(options, 'en');

  it('names books, seasons, slots and dates from the catalogs', () => {
    expect(labels.book('MT')).toBe('Matthew');
    expect(labels.book('NOPE')).toBe('NOPE');
    expect(labels.season('lent')).toBe('Lent');
    expect(labels.slot('first-reading')).toBe('First reading');
    expect(labels.date('2026-09-20')).toBe('Sunday 20 September 2026');
  });

  it('names books in Kiswahili for the /sw/ documents (L-113)', () => {
    const sw = searchLabels(options, 'sw');
    expect(sw.book('MT')).toBe('Mathayo');
    expect(sw.slot('gospel')).toBe('Injili');
    expect(sw.date('2026-09-20')).toBe('Jumapili 20 Septemba 2026');
  });
});
