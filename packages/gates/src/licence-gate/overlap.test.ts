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

  it('decodes only valid code points and never throws', () => {
    expect(htmlToText('<p>a &#99999999; b &#x110000; c &#xD800; d &#65;</p>')).toBe('a � b � c � d A');
  });
});

describe('readableText', () => {
  it('returns plain text as it is', () => {
    expect(readableText(page({}))).toEqual({ text: 'Some commentary text.' });
    expect(readableText(page({ contentType: '' }))).toEqual({ text: 'Some commentary text.' });
  });

  it('keeps already reduced text/html text as it is, literal < and > included', () => {
    const text = 'if n < 3 then the copied words stay while m > 2';
    expect(readableText(page({ contentType: 'text/html; charset=utf-8', text }))).toEqual({ text });
    expect(readableText(page({ text: '<p>Para</p> is prose here' }))).toEqual({ text: '<p>Para</p> is prose here' });
  });

  it('reduces a body that is a whole HTML document', () => {
    expect(readableText(page({ text: '<!DOCTYPE html><p>Para</p>' }))).toEqual({ text: 'Para' });
    expect(readableText(page({ contentType: 'text/html', text: ' <html lang="en"><b>bold</b> words' }))).toEqual({
      text: 'bold words',
    });
  });

  it('explains why a page cannot be read', () => {
    expect(readableText(page({ status: 404 }))).toEqual({ problem: 'HTTP 404' });
    expect(readableText(page({ contentType: 'application/pdf' }))).toEqual({
      problem: 'cannot read content type "application/pdf"',
    });
    expect(readableText({ ...page({ text: '' }), unsupported: 'pdf' } as FetchedSource)).toEqual({
      problem: 'the fetcher could not read the pdf body',
    });
    expect(readableText(page({ text: '<html><p> 12 </p></html>' }))).toEqual({ problem: 'the page has no text' });
  });
});

describe('bounded work', () => {
  it('refuses a page over the word cap', () => {
    expect(() => indexSourceWords('one two three', 2)).toThrow('the page has 3 words, more than the 2 checked');
  });

  it('stays linear on a pathological page and note', () => {
    const started = performance.now();
    const source = indexSourceWords('the '.repeat(200_000));
    const run = longestSharedRun('the '.repeat(1_200), source);
    const mixed = longestSharedRun(`${'the a '.repeat(600)}`, indexSourceWords('the a the '.repeat(50_000)));
    expect(run.words).toBe(1_200);
    expect(mixed.words).toBe(3);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('agrees with a brute-force longest common run on random word strings', () => {
    let seed = 7;
    const random = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const text = (n: number): string[] => Array.from({ length: n }, () => ['a', 'b', 'c'][random(3)] as string);
    const brute = (a: string[], b: string[]): number => {
      let best = 0;
      for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
          let k = 0;
          while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
          best = Math.max(best, k);
        }
      }
      return best;
    };
    for (let round = 0; round < 40; round++) {
      const a = text(5 + random(30));
      const b = text(5 + random(60));
      expect(longestSharedRun(a.join(' '), indexSourceWords(b.join(' '))).words).toBe(brute(a, b));
    }
  });
});
