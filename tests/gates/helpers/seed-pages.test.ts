import { describe, expect, it } from 'vitest';

import { fixtureName, reducePage, verseTextLines } from './seed-pages.ts';

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

  it('keeps only the excerpt itself when it is found outside a public-domain section', () => {
    const reduced = reducePage(URL, PAGE, ['holds the cited words', 'something worth citing', 'A third sentence']);
    expect(reduced.text).toBe(
      'Pulpit Commentary\nVerse 1. The first paragraph of the old commentary says something worth citing here.\nA second paragraph of the same section.\n\nholds the cited words\nA third sentence\n',
    );
    expect(reduced.sections).toEqual(['Pulpit Commentary']);
    expect(reducePage(URL, PAGE, ['the verse text. Pulpit Commentary Verse 1.']).text).toBe(
      'the verse text. Pulpit Commentary Verse 1.\n',
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

// A chapter page: each verse printed after a bare reference line, and a strophe of numbered verses.
const CHAPTER = [
  'Pulpit Commentary',
  'An introduction of the commentator, in his own words.',
  'Example 1:1',
  'And the verse text of the first verse stands here.',
  '1. The comment on the first verse.',
  'Example 1:2',
  '',
  '1 Numbered verse text of the strophe;',
  '',
  'Its second stich, short;',
  '2 And the next numbered verse.',
  'The comment after the strophe goes on for longer than any stich would, so it is kept.',
  '1 Kings 4:5',
  'Links',
].join('\n');

describe('verse text inside a kept section', () => {
  it('finds reference lines with their verse, and numbered verses with their stichs', () => {
    expect([...verseTextLines(CHAPTER.split('\n'))].sort((a, b) => a - b)).toEqual([2, 3, 5, 7, 9, 10, 12]);
  });

  it('is dropped, and an excerpt quoting it is kept on its own', () => {
    const reduced = reducePage(URL, CHAPTER, ['own words', 'second stich, short', 'The comment on the first']);
    expect(reduced.text).toBe(
      [
        'Pulpit Commentary',
        'An introduction of the commentator, in his own words.',
        '',
        '1. The comment on the first verse.',
        '',
        'second stich, short',
        '',
        'The comment after the strophe goes on for longer than any stich would, so it is kept.',
        '',
      ].join('\n'),
    );
    expect(reduced.unplaced).toEqual([]);
  });

  it('reports an excerpt that runs from kept text into dropped verse text', () => {
    const excerpt = 'own words. Example 1:1 And the verse text';
    expect(reducePage(URL, CHAPTER, [excerpt]).unplaced).toEqual([excerpt]);
  });
});

describe('fixtureName', () => {
  it('names a fixture after the host and path', () => {
    expect(fixtureName(URL)).toBe('biblehub.com_commentaries_example_1-1.txt');
    expect(fixtureName('https://www.newadvent.org/cathen/02767a.htm')).toBe('www.newadvent.org_cathen_02767a.txt');
    expect(fixtureName('https://example.org/a b/c?d=1')).toBe('example.org_a_20b_c.txt');
  });
});
