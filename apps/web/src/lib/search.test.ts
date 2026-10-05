import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openRepo } from '@lectio/content';
import { describe, expect, it, vi } from 'vitest';

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
import type { PagefindApi, PagefindIndexApi, SearchDocument, SearchLabels } from './search.ts';

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
  sections: [{ heading: 'Heading', paragraphs: ['One.', 'Two.'] }],
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
    expect(context?.heading).toBe('Labourers in the vineyard');
    expect(context?.paragraphs[1]).toContain('the Jewish idiom of the evil eye');
    // Citation markers never reach the index.
    expect(JSON.stringify(gospel)).not.toMatch(/\[c\d+\]/);
    expect(notes[0]).toEqual({
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
      '<main data-pagefind-body><p>A &lt;summary&gt; &amp; &quot;quotes&quot;</p><section><h2>Heading</h2><p>One.</p><p>Two.</p></section></main>',
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

function fakeApi(overrides: {
  create?: { errors: string[]; index?: PagefindIndexApi };
  add?: string[];
  write?: string[];
}): PagefindApi & { added: { url: string; content: string }[]; written: string[]; close: ReturnType<typeof vi.fn> } {
  const added: { url: string; content: string }[] = [];
  const written: string[] = [];
  const index: PagefindIndexApi = {
    addHTMLFile: (file) => {
      added.push(file);
      return Promise.resolve({ errors: overrides.add ?? [] });
    },
    writeFiles: ({ outputPath }) => {
      written.push(outputPath);
      return Promise.resolve({ errors: overrides.write ?? [] });
    },
  };
  return {
    added,
    written,
    createIndex: vi.fn(() => Promise.resolve(overrides.create ?? { errors: [], index })),
    close: vi.fn(() => Promise.resolve(null)),
  };
}

describe('writeSearchIndex', () => {
  it('indexes every document at its URL and writes the bundle', async () => {
    const api = fakeApi({});
    await expect(writeSearchIndex(api, [doc], '/out/pagefind', 'en')).resolves.toBe(1);
    expect(api.createIndex).toHaveBeenCalledWith({ forceLanguage: 'en' });
    expect(api.added).toEqual([{ url: doc.url, content: searchDocumentHtml(doc) }]);
    expect(api.written).toEqual(['/out/pagefind']);
    expect(api.close).toHaveBeenCalledOnce();
  });

  it('fails on Pagefind errors and still closes the service', async () => {
    const createFails = fakeApi({ create: { errors: ['boom'] } });
    await expect(writeSearchIndex(createFails, [doc], '/o', 'en')).rejects.toThrow('Pagefind createIndex failed: boom');
    expect(createFails.close).toHaveBeenCalledOnce();

    const noIndex = fakeApi({ create: { errors: [] } });
    await expect(writeSearchIndex(noIndex, [doc], '/o', 'en')).rejects.toThrow('returned no index');

    const addFails = fakeApi({ add: ['bad html', 'worse'] });
    await expect(writeSearchIndex(addFails, [doc], '/o', 'en')).rejects.toThrow(
      'Pagefind indexing /2026-09-20/gospel/ failed: bad html; worse',
    );

    const writeFails = fakeApi({ write: ['disk full'] });
    await expect(writeSearchIndex(writeFails, [doc], '/o', 'en')).rejects.toThrow('Pagefind writeFiles failed');
    expect(writeFails.close).toHaveBeenCalledOnce();
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
