import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openRepo } from '@lectio/content';
import { describe, expect, it, vi } from 'vitest';

import { localeRepo } from './notes-locale.ts';
import {
  PAGEFIND_DIR,
  SEARCH_FILTERS,
  SEARCH_META,
  bookCode,
  escapeHtml,
  pagefindUiAssets,
  parseSearchPageConfig,
  plainText,
  queryFromSearch,
  searchDocumentHtml,
  searchDocuments,
  searchPageConfig,
  writeSearchIndex,
} from './search.ts';
import type {
  PagefindApi,
  PagefindBundleFile,
  PagefindIndexApi,
  SearchDocument,
  SearchLabels,
  WriteBundleFile,
} from './search.ts';

const contentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/content');
const repo = openRepo(contentRoot);

const labels: SearchLabels = {
  book: (code) => (code === 'MT' ? 'Matthew' : code),
  season: (season) => `season:${season}`,
  slot: (slot) => `slot:${slot}`,
  date: (date) => `date:${date}`,
};

const doc: SearchDocument = {
  url: '/2026-09-20/gospel/',
  lang: 'en',
  title: 'Mt 20:1-16a · Gospel · Sunday 20 September 2026',
  ref: '1 Cor 15:35-37, 42-49',
  isoDate: '2026-09-20',
  date: 'Sunday 20 September 2026',
  book: 'Matthew',
  season: 'Ordinary Time',
  summary: 'A <summary> & "quotes"',
  sections: [{ id: 'note-x', heading: 'Heading', paragraphs: ['One.', 'Two.'] }],
};

describe('bookCode', () => {
  it('is the part of a passage key before the first dot', () => {
    expect(bookCode('MT.20.1-16')).toBe('MT');
    expect(bookCode('1COR.15.35-37_15.42-49')).toBe('1COR');
    expect(bookCode('JUDE')).toBe('JUDE');
  });
});

describe('plainText', () => {
  it('joins the text segments and drops citations', () => {
    expect(
      plainText([
        { kind: 'text', text: ' The evil eye' },
        { kind: 'cite', sources: [] },
        { kind: 'text', text: ' was an idiom. ' },
      ]),
    ).toBe('The evil eye was an idiom.');
  });
});

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });
});

describe('searchDocuments', () => {
  const docs = searchDocuments(repo, 'en', labels);

  it('has one document per reading with approved notes, and none for pending passages', () => {
    expect(docs.map((d) => d.url)).toEqual(['/2026-09-20/gospel/']);
  });

  it('carries the filters, meta and the note content of the passage', () => {
    const [gospel] = docs;
    expect(gospel).toMatchObject({
      lang: 'en',
      title: 'Mt 20:1-16a · slot:gospel · date:2026-09-20',
      ref: 'Mt 20:1-16a',
      isoDate: '2026-09-20',
      date: 'date:2026-09-20',
      book: 'Matthew',
      season: 'season:ordinary-time',
    });
    expect(gospel?.summary).toContain('landowner');
    const [context, ...notes] = gospel?.sections ?? [];
    expect(context?.id).toBe('context');
    expect(context?.heading).toBe('Labourers in the vineyard');
    expect(context?.paragraphs[1]).toContain('the Jewish idiom of the evil eye');
    // Citation markers never reach the index.
    expect(JSON.stringify(gospel)).not.toMatch(/\[c\d+\]/);
    expect(notes[0]).toEqual({
      id: 'note-v15-evil-eye',
      heading: 'envious: ophthalmos sou ponēros (your eye evil)',
      paragraphs: [
        'Greek asks “is your eye evil?”, an idiom for begrudging another’s good.',
        expect.stringContaining('The evil eye was a familiar image') as string,
      ],
    });
  });
});

describe('searchDocumentHtml', () => {
  const html = searchDocumentHtml(doc);

  it('puts data-pagefind-body on the note content only, escaped', () => {
    const bodies = html.match(/data-pagefind-body/g) ?? [];
    expect(bodies).toHaveLength(1);
    expect(html).toContain(
      '<main data-pagefind-body><p>A &lt;summary&gt; &amp; &quot;quotes&quot;</p><section><h2 id="note-x">Heading</h2><p>One.</p><p>Two.</p></section></main>',
    );
    expect(html).toContain('<html lang="en">');
  });

  it('declares the filters, meta and sort key outside the body', () => {
    const outside = html.slice(0, html.indexOf('<main'));
    for (const filter of SEARCH_FILTERS) expect(outside).toContain(`data-pagefind-filter="${filter}"`);
    for (const meta of [...SEARCH_META, 'title']) expect(outside).toContain(`data-pagefind-meta="${meta}"`);
    expect(outside).toContain('<p data-pagefind-meta="ref">1 Cor 15:35-37, 42-49</p>');
    expect(outside).toContain('data-pagefind-sort="date:2026-09-20"');
    expect(outside).toContain('<p data-pagefind-filter="book">Matthew</p>');
    expect(outside).toContain('<p data-pagefind-filter="season">Ordinary Time</p>');
  });
});

const bundleFiles: PagefindBundleFile[] = [
  { path: 'pagefind.js', content: new Uint8Array([1]) },
  { path: 'index/en_1.pf_index', content: new Uint8Array([2]) },
];

function fakeApi(overrides: {
  create?: { errors: string[]; index?: PagefindIndexApi };
  add?: string[];
  files?: { errors: string[]; files?: PagefindBundleFile[] };
}): PagefindApi & { added: { url: string; content: string }[]; close: ReturnType<typeof vi.fn> } {
  const added: { url: string; content: string }[] = [];
  const index: PagefindIndexApi = {
    addHTMLFile: (file) => {
      added.push(file);
      return Promise.resolve({ errors: overrides.add ?? [] });
    },
    getFiles: () => Promise.resolve(overrides.files ?? { errors: [], files: bundleFiles }),
  };
  return {
    added,
    createIndex: vi.fn(() => Promise.resolve(overrides.create ?? { errors: [], index })),
    close: vi.fn(() => Promise.resolve(null)),
  };
}

/** A writer that records each file only once its (asynchronous) write has finished. */
function fakeWriter(): WriteBundleFile & { written: string[] } {
  const written: string[] = [];
  const write = async ({ path }: PagefindBundleFile): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    written.push(path);
  };
  return Object.assign(write, { written });
}

describe('searchDocuments in Kiswahili (L-113)', () => {
  it('indexes the /sw/ Reading page with the reviewed Kiswahili notes, in sw', () => {
    const [gospel, ...rest] = searchDocuments(localeRepo(repo, 'sw'), 'sw', labels, 'sw/');
    expect(rest).toEqual([]);
    expect(gospel).toMatchObject({ url: '/sw/2026-09-20/gospel/', lang: 'sw', ref: 'Mt 20:1-16a' });
    expect(gospel?.summary).toMatch(/^Mwenye shamba/);
    expect(gospel?.sections[0]?.heading).toBe('Wafanyakazi katika shamba la mizabibu');
    expect(gospel?.sections[1]?.heading).toBe('wivu: ophthalmos sou ponēros (jicho lako ovu)');
  });

  it('indexes the English notes on a /sw/ page without a reviewed translation', () => {
    const [gospel] = searchDocuments(localeRepo(repo, 'sw', { translations: () => null }), 'sw', labels, 'sw/');
    expect(gospel).toMatchObject({ url: '/sw/2026-09-20/gospel/', lang: 'sw' });
    expect(gospel?.summary).toContain('landowner');
  });
});

describe('writeSearchIndex', () => {
  it('indexes documents in several languages by their own lang', async () => {
    const api = fakeApi({});
    await expect(writeSearchIndex(api, [doc, { ...doc, url: '/sw/x/', lang: 'sw' }], fakeWriter(), 'en')).resolves.toBe(
      2,
    );
    expect(api.createIndex).toHaveBeenCalledWith({});
    expect(api.added[1]?.content).toContain('<html lang="sw">');
  });

  it('indexes every document at its URL and resolves only once every bundle file is written', async () => {
    const api = fakeApi({});
    const write = fakeWriter();
    await expect(writeSearchIndex(api, [doc], write, 'en')).resolves.toBe(1);
    expect(api.createIndex).toHaveBeenCalledWith({ forceLanguage: 'en' });
    expect(api.added).toEqual([{ url: doc.url, content: searchDocumentHtml(doc) }]);
    expect(write.written.toSorted()).toEqual(['index/en_1.pf_index', 'pagefind.js']);
    expect(api.close).toHaveBeenCalledOnce();
  });

  it('fails on Pagefind errors and still closes the service', async () => {
    const write = fakeWriter();
    const createFails = fakeApi({ create: { errors: ['boom'] } });
    await expect(writeSearchIndex(createFails, [doc], write, 'en')).rejects.toThrow(
      'Pagefind createIndex failed: boom',
    );
    expect(createFails.close).toHaveBeenCalledOnce();

    const noIndex = fakeApi({ create: { errors: [] } });
    await expect(writeSearchIndex(noIndex, [doc], write, 'en')).rejects.toThrow('returned no index');

    const addFails = fakeApi({ add: ['bad html', 'worse'] });
    await expect(writeSearchIndex(addFails, [doc], write, 'en')).rejects.toThrow(
      'Pagefind indexing /2026-09-20/gospel/ failed: bad html; worse',
    );

    const getFails = fakeApi({ files: { errors: ['out of memory'] } });
    await expect(writeSearchIndex(getFails, [doc], write, 'en')).rejects.toThrow(
      'Pagefind getFiles failed: out of memory',
    );
    expect(getFails.close).toHaveBeenCalledOnce();

    for (const files of [{ errors: [] }, { errors: [], files: [] }])
      await expect(writeSearchIndex(fakeApi({ files }), [doc], write, 'en')).rejects.toThrow(
        'Pagefind getFiles returned no files',
      );
    expect(write.written).toEqual([]);
  });

  it('fails when a bundle file cannot be written, and still closes the service', async () => {
    const api = fakeApi({});
    const diskFull = (): Promise<void> => Promise.reject(new Error('disk full'));
    await expect(writeSearchIndex(api, [doc], diskFull, 'en')).rejects.toThrow('disk full');
    expect(api.close).toHaveBeenCalledOnce();
  });
});

describe('search page helpers', () => {
  it('builds base-aware bundle paths', () => {
    expect(searchPageConfig('/', {})).toEqual({ bundlePath: `/${PAGEFIND_DIR}/`, baseUrl: '/', translations: {} });
    expect(searchPageConfig('/lectio', { placeholder: 'Search' })).toEqual({
      bundlePath: '/lectio/pagefind/',
      baseUrl: '/lectio/',
      translations: { placeholder: 'Search' },
    });
    expect(pagefindUiAssets('/lectio/pagefind/')).toEqual({
      script: '/lectio/pagefind/pagefind-ui.js',
      style: '/lectio/pagefind/pagefind-ui.css',
    });
  });

  it('reads the ?q= search term', () => {
    expect(queryFromSearch('?q=evil+eye')).toBe('evil eye');
    expect(queryFromSearch('?q=%20%20')).toBeNull();
    expect(queryFromSearch('')).toBeNull();
  });

  it('parses the embedded config and rejects malformed input', () => {
    const config = searchPageConfig('/x/', { a: 'b' });
    expect(parseSearchPageConfig(JSON.stringify(config))).toEqual(config);
    expect(parseSearchPageConfig(undefined)).toBeNull();
    expect(parseSearchPageConfig('{')).toBeNull();
    expect(parseSearchPageConfig('null')).toBeNull();
    expect(parseSearchPageConfig('{"bundlePath":1,"baseUrl":"/","translations":{}}')).toBeNull();
    expect(parseSearchPageConfig('{"bundlePath":"/","baseUrl":2,"translations":{}}')).toBeNull();
    expect(parseSearchPageConfig('{"bundlePath":"/","baseUrl":"/","translations":"x"}')).toBeNull();
    expect(parseSearchPageConfig('{"bundlePath":"/","baseUrl":"/","translations":null}')).toBeNull();
  });
});
