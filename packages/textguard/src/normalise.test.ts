import { describe, expect, it } from 'vitest';

import { normaliseWord, tokenise } from './normalise.ts';

describe('normaliseWord', () => {
  it.each([
    ['Shepherd', 'shepherd'],
    ['Lord’s', 'lords'],
    ["Lord's", 'lords'],
    ['naïve', 'naive'],
    ['Æneas', 'aeneas'],
    ['Œuvre', 'oeuvre'],
    ['Straße', 'strasse'],
    ['Søren', 'soren'],
    ['ﬁrst', 'first'],
    ['½', '12'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseWord(raw)).toBe(expected);
  });
});

describe('tokenise', () => {
  it('returns normalised words with their offsets in the original text', () => {
    const text = '“Well,” she said—the river’s mouth.';
    expect(tokenise(text)).toEqual([
      { word: 'well', start: 1, end: 5 },
      { word: 'she', start: 8, end: 11 },
      { word: 'said', start: 12, end: 16 },
      { word: 'the', start: 17, end: 20 },
      { word: 'rivers', start: 21, end: 28 },
      { word: 'mouth', start: 29, end: 34 },
    ]);
    expect(text.slice(21, 28)).toBe('river’s');
  });

  it('ignores line breaks, case and punctuation', () => {
    const words = (s: string) => tokenise(s).map((t) => t.word);
    expect(words('Over the HILLS,\nand far-away!')).toEqual(words('over the hills and far away'));
  });

  it('drops number-only tokens (inline verse numbers) but keeps words containing digits', () => {
    const words = (s: string) => tokenise(s).map((t) => t.word);
    expect(words('the river. 17 And the hills ¹⁸ sang ½')).toEqual(['the', 'river', 'and', 'the', 'hills', 'sang']);
    expect(words('the 3rd day, v16')).toEqual(['the', '3rd', 'day', 'v16']);
    expect(tokenise(' — … ')).toEqual([]);
  });

  it('drops a match that normalises to nothing', () => {
    // U+037A GREEK YPOGEGRAMMENI is a letter whose NFKD form is a space and a combining mark.
    expect(tokenise('a ͺ b')).toEqual([
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 4, end: 5 },
    ]);
  });
});
