import { describe, expect, it } from 'vitest';

import { clausesHolding, fixtureName, reducePage } from './seed-pages.ts';

// An invented page in the shape of a Bible Hub commentary page: a header (where the verse would
// be), a public-domain section, a section that is not, and a footer.
const PAGE = [
  'Bible > Commentaries > Example 1:1',
  'Header line standing in for the verse text.',
  'Pulpit Commentary',
  'Verse 1. The first paragraph of the old commentary says something worth citing here.',
  'A second paragraph of the same section.',
  'Topical Lexicon',
  'A modern essay. Its second sentence holds the cited words in it. A third sentence follows.',
  'Links',
  'Footer links.',
].join('\n');

const URL = 'https://biblehub.com/commentaries/example/1-1.htm';

describe('reducePage', () => {
  it('keeps a cited public-domain section whole and drops the header and the other sections', () => {
    const reduced = reducePage(URL, PAGE, ['something worth citing']);
    expect(reduced).toEqual({
      text: 'Pulpit Commentary\nVerse 1. The first paragraph of the old commentary says something worth citing here.\nA second paragraph of the same section.\n',
      missing: [],
      unplaced: [],
      sections: ['Pulpit Commentary'],
    });
  });

  it('keeps only the clauses of an excerpt found outside a public-domain section', () => {
    const reduced = reducePage(URL, PAGE, ['holds the cited words', 'something worth citing', 'holds the cited']);
    expect(reduced.text).toBe(
      'Pulpit Commentary\nVerse 1. The first paragraph of the old commentary says something worth citing here.\nA second paragraph of the same section.\n\nIts second sentence holds the cited words in it.\n',
    );
    expect(reduced.sections).toEqual(['Pulpit Commentary']);
  });

  it('joins clauses from the same lines, and keeps lines an excerpt spans', () => {
    const reduced = reducePage(URL, PAGE, ['A modern essay', 'A third sentence follows', 'cited words in it. A third']);
    expect(reduced.text).toBe(
      'A modern essay.\nA third sentence follows.\nIts second sentence holds the cited words in it. A third sentence follows.\n',
    );
    expect(reducePage(URL, PAGE, ['the verse text. Pulpit Commentary Verse 1.']).text).toBe(
      'Header line standing in for the verse text. Pulpit Commentary Verse 1.\n',
    );
  });

  it('reports excerpts missing from the page, and excerpts spanning too many lines', () => {
    const reduced = reducePage(URL, PAGE, [
      'words that are not there',
      'same section. Topical Lexicon A modern essay. Its',
    ]);
    expect(reduced.missing).toEqual(['words that are not there']);
    expect(reduced.unplaced).toEqual([]);
    const far = reducePage(URL, PAGE, ['verse text. Pulpit Commentary Verse 1. The first … the same section. Topical']);
    expect(far.text).toBe('');
    expect(reducePage(URL, 'a\nb\nc\nd\ne\nf', ['a b c d e f'])).toMatchObject({ unplaced: ['a b c d e f'], text: '' });
  });

  it('keeps pages of public-domain reference works whole', () => {
    const url = 'https://www.jewishencyclopedia.com/articles/1-example';
    expect(reducePage(url, PAGE, ['nowhere at all'])).toEqual({
      text: PAGE,
      missing: ['nowhere at all'],
      unplaced: [],
      sections: [],
    });
  });
});

describe('clausesHolding', () => {
  it('returns the whole text when no shorter run holds the excerpt', () => {
    expect(clausesHolding('one two, three four', 'two, three')).toBe('one two, three four');
    expect(clausesHolding('alpha beta gamma', 'beta')).toBe('alpha beta gamma');
  });
});

describe('fixtureName', () => {
  it('names a fixture after the host and path', () => {
    expect(fixtureName(URL)).toBe('biblehub.com_commentaries_example_1-1.txt');
    expect(fixtureName('https://www.newadvent.org/cathen/02767a.htm')).toBe('www.newadvent.org_cathen_02767a.txt');
    expect(fixtureName('https://example.org/a b/c?d=1')).toBe('example.org_a_20b_c.txt');
  });
});
