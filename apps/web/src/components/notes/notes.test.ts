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
    expect(html).not.toContain('note__permalink');
  });

  it('links to the note permalink when given one', async () => {
    const html = await container.renderToString(NoteCard, {
      props: {
        note: hebrewNote,
        method: 'auto',
        lastReviewedAt: null,
        permalink: '/2026-09-20/first-reading/notes/v8/',
      },
    });
    expect(html).toMatch(
      /<a class="note__permalink"[^>]*href="\/2026-09-20\/first-reading\/notes\/v8\/"[^>]*aria-label="Link to this note: verse 8, “thoughts”"[^>]*>\s*Link to this note\s*<\/a>/,
    );
  });
});

describe('Verification', () => {
  it('says "Not yet verified" instead of a verified mark when there are no sources', async () => {
    const html = await container.renderToString(Verification, {
      props: { sources: [], method: 'human', lastReviewedAt: null, reportUrl: 'https://x.test/' },
    });
    expect(html).toContain('Not yet verified');
    expect(html).not.toContain('Verified ·');
    expect(html).not.toContain('<details');
    expect(html).toContain('href="https://x.test/"');
  });

  it('shows the review date when the passage has one', async () => {
    const html = await container.renderToString(Verification, {
      props: {
        sources: [hebrewSource, { ...hebrewSource, id: 'b', number: 3, anchorId: 'b' }],
        method: 'human',
        lastReviewedAt: '2026-09-03T17:05:00Z',
        reportUrl: 'https://x.test/',
      },
    });
    expect(html).toContain('Verified · 2 sources');
    expect(html).toMatch(/<time datetime="2026-09-03T17:05:00Z"[^>]*>Last reviewed 3 September 2026<\/time>/);
    expect(html).toContain('href="https://x.test/"');
  });

  it('starts closed, and open when asked', async () => {
    const props = {
      sources: [hebrewSource],
      method: 'human',
      lastReviewedAt: null,
      reportUrl: 'https://x.test/',
    } as const;
    const closed = await container.renderToString(Verification, { props });
    expect(closed).toMatch(/<details class="verification__details"(?![^>]*\bopen\b)[^>]*>/);
    const open = await container.renderToString(Verification, { props: { ...props, open: true } });
    expect(open).toMatch(/<details class="verification__details"[^>]*\bopen\b[^>]*>/);
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
