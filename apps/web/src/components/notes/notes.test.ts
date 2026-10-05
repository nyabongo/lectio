import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import type { NoteView, SourceView } from '../../lib/reading.ts';
import NoteCard from './NoteCard.astro';
import SourceList from './SourceList.astro';
import Verification from './Verification.astro';

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

const hebrewSource: SourceView = {
  id: 'is-55-8',
  number: 2,
  anchorId: 'note-v8-source-is-55-8',
  type: 'scripture',
  citation: 'Isaiah 55:8',
  url: null,
  archivedUrl: null,
  excerpt: 'מַחְשְׁבוֹתַי',
  excerptLang: 'hbo',
  excerptDir: 'rtl',
};

const hebrewNote: NoteView = {
  id: 'v8-thoughts',
  anchorId: 'note-v8-thoughts',
  verse: '8',
  anchor: 'thoughts',
  original: { text: 'מַחְשְׁבוֹתַי', lang: 'hbo', dir: 'rtl', translit: 'maḥšəḇôṯay', gloss: 'my plans' },
  summary: 'Hebrew speaks of plans, not musings.',
  body: [
    { kind: 'text', text: 'The word names designs.' },
    { kind: 'cite', sources: [hebrewSource, { ...hebrewSource, id: 'other', number: 3, anchorId: 'o' }] },
  ],
  sources: [hebrewSource],
  reportUrl: 'https://github.com/nyabongo/lectio/issues/new?template=content-issue.yml&note=v8-thoughts',
};

describe('NoteCard', () => {
  it('renders Hebrew right to left with its transliteration, gloss and superscripts', async () => {
    const html = await container.renderToString(NoteCard, {
      props: { note: hebrewNote, method: 'auto', lastReviewedAt: null },
    });
    expect(html).toMatch(/<dd[^>]*lang="hbo" dir="rtl"[^>]*>מַחְשְׁבוֹתַי<\/dd>/);
    expect(html).toContain('Verse 8');
    expect(html).toContain('“thoughts”');
    expect(html).toContain('maḥšəḇôṯay');
    expect(html).toContain('“my plans”');
    expect(html).toMatch(/aria-label="Source 2"[^>]*>2<\/a>,<a href="#o"[^>]*aria-label="Source 3"/);
    expect(html).toContain('Verified · 1 source');
    expect(html).toContain('two independent AI verifiers');
    expect(html).not.toContain('Last reviewed');
    expect(html).toContain('Report an issue');
  });
});

describe('Verification', () => {
  it('shows the review date when the passage has one', async () => {
    const html = await container.renderToString(Verification, {
      props: { sources: [], method: 'human', lastReviewedAt: '2026-09-03T17:05:00Z', reportUrl: 'https://x.test/' },
    });
    expect(html).toContain('Verified · 0 sources');
    expect(html).toMatch(/<time datetime="2026-09-03T17:05:00Z"[^>]*>Last reviewed 3 September 2026<\/time>/);
    expect(html).toContain('href="https://x.test/"');
  });
});

describe('SourceList', () => {
  it('links web sources and their archived copies, and marks excerpt language and direction', async () => {
    const web: SourceView = {
      ...hebrewSource,
      id: 'lsj',
      number: 5,
      anchorId: 'context-source-lsj',
      type: 'web',
      citation: 'LSJ',
      url: 'https://example.test/lsj',
      archivedUrl: 'https://archive.test/lsj',
      excerpt: null,
      excerptLang: null,
      excerptDir: null,
    };
    const html = await container.renderToString(SourceList, { props: { sources: [web, hebrewSource] } });
    expect(html).toMatch(/<li id="context-source-lsj" value="5"/);
    expect(html).toContain('<a href="https://example.test/lsj"');
    expect(html).toContain('href="https://archive.test/lsj"');
    expect(html).toContain('Archived copy');
    expect(html).toMatch(/<blockquote[^>]*lang="hbo" dir="rtl"/);
    expect(html).toContain('Isaiah 55:8');
  });
});
