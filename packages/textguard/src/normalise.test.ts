import { describe, expect, it } from 'vitest';

import { normaliseWord, tokenise } from './normalise.ts';
import type { Token } from './normalise.ts';

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

  describe('combining marks (Unicode category M) stay inside the word', () => {
    const words = (s: string) => tokenise(s).map((t) => t.word);
    // Psalm 1:1, first five words, from the committed OSHB corpus (corpus/hbo-oshb/PS/1.json), morpheme slashes removed.
    const PSALM_1_1 = 'אַ֥שְֽׁרֵי הָאִ֗ישׁ אֲשֶׁ֤ר לֹ֥א הָלַךְ֮';
    const JOHN_1_1 = 'Ἐν ἀρχῇ ἦν ὁ λόγος';

    it('keeps pointed Hebrew (niqqud and cantillation) as one word each, with offsets over the marks', () => {
      const tokens = tokenise(PSALM_1_1);
      expect(tokens.map((t) => t.word)).toEqual(['אשרי', 'האיש', 'אשר', 'לא', 'הלך']);
      expect(PSALM_1_1.slice((tokens[0] as Token).start, (tokens[0] as Token).end)).toBe('אַ֥שְֽׁרֵי');
      expect(PSALM_1_1.slice((tokens[4] as Token).start, (tokens[4] as Token).end)).toBe('הָלַךְ֮');
    });

    it('tokenises NFC and NFD polytonic Greek alike', () => {
      expect(words(JOHN_1_1)).toEqual(['εν', 'αρχη', 'ην', 'ο', 'λογος']);
      expect(words(JOHN_1_1.normalize('NFD'))).toEqual(words(JOHN_1_1));
    });

    it('tokenises NFD Latin like NFC Latin', () => {
      expect(words('naïve café'.normalize('NFD'))).toEqual(['naive', 'cafe']);
    });

    it('splits at maqaf, like a hyphen, and joins at geresh and gershayim, like an apostrophe', () => {
      expect(words('אֶת־הָרָקִיעַ')).toEqual(['את', 'הרקיע']);
      expect(words('צה״ל ג׳ורג׳')).toEqual(['צהל', 'גורג']);
    });

    it('ignores a stray mark with no letter before it', () => {
      expect(words('\u0301 a')).toEqual(['a']);
    });
  });
});
