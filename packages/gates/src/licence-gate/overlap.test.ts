import { describe, expect, it } from 'vitest';

import type { FetchedSource } from '@lectio/providers';

import { htmlToText, indexSourceWords, longestSharedRun, readableText } from './overlap.ts';

const page = (overrides: Partial<FetchedSource>): FetchedSource => ({
  status: 200,
  text: 'Some commentary text.',
  contentType: 'text/plain',
  retrievedAt: '2026-10-05T00:00:00.000Z',
  ...overrides,
});

describe('longestSharedRun', () => {
  const source = indexSourceWords('the owner went out early, and the owner hired workers for the vineyard at dawn');

  it('finds the longest run of consecutive shared words, ignoring case and punctuation', () => {
    const text = 'Note: The Owner went out early and the owner hired workers — later.';
    const run = longestSharedRun(text, source);
    expect(run.words).toBe(10);
    expect(text.slice(run.start, run.end)).toBe('The Owner went out early and the owner hired workers');
  });

  it('is exact: it does not join words that are apart in the source', () => {
    expect(longestSharedRun('owner hired the vineyard', source).words).toBe(2);
  });

  it('returns 0 when nothing is shared', () => {
    expect(longestSharedRun('nothing alike here', source)).toEqual({ words: 0, start: 0, end: 0 });
    expect(indexSourceWords('').words).toBe(0);
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles, comments and tags and decodes entities', () => {
    const html =
      '<html><head><style>p{}</style><script>var x = "<p>";</script></head>' +
      '<body><!-- nav --><p>Owner&rsquo;s &amp; &#39;friend&#39; &#x2014; &bogus; ok</p></body></html>';
    expect(htmlToText(html)).toBe("Owner’s & 'friend' — &bogus; ok");
  });
});

describe('readableText', () => {
  it('returns plain text as it is', () => {
    expect(readableText(page({}))).toEqual({ text: 'Some commentary text.' });
    expect(readableText(page({ contentType: '' }))).toEqual({ text: 'Some commentary text.' });
  });

  it('reduces HTML by content type or by its look', () => {
    expect(readableText(page({ contentType: 'text/html; charset=utf-8', text: '<b>bold</b> words' }))).toEqual({
      text: 'bold words',
    });
    expect(readableText(page({ text: '<p>Para</p>' }))).toEqual({ text: 'Para' });
  });

  it('explains why a page cannot be read', () => {
    expect(readableText(page({ status: 404 }))).toEqual({ problem: 'HTTP 404' });
    expect(readableText(page({ contentType: 'application/pdf' }))).toEqual({
      problem: 'cannot read content type "application/pdf"',
    });
    expect(readableText(page({ text: '<p> 12 </p>' }))).toEqual({ problem: 'the page has no text' });
  });
});
