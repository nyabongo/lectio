import { describe, expect, it } from 'vitest';

import type { Ref } from '@lectio/refs';

import {
  asSentence,
  englishSpokenRef,
  speakOriginals,
  speakReferences,
  speakable,
  stripClaimMarkers,
  stripUrls,
  tidy,
} from './text.ts';

const EVIL_EYE = { original: 'ὀφθαλμός σου πονηρός', translit: 'ophthalmos sou ponēros' };

describe('stripClaimMarkers', () => {
  it('removes single and stacked markers with the space before them', () => {
    expect(stripClaimMarkers('One. [c1] Two. [c2][c13]')).toBe('One. Two.');
  });

  it('leaves other brackets alone', () => {
    expect(stripClaimMarkers('a [note] b')).toBe('a [note] b');
  });
});

describe('stripUrls', () => {
  it('removes http(s) and www URLs but keeps trailing punctuation', () => {
    expect(stripUrls('See https://example.org/a?b=1. Or (www.example.com).')).toBe('See . Or ().');
    expect(stripUrls('HTTP://EXAMPLE.ORG/x, then')).toBe(', then');
  });

  it('removes URLs with balanced parentheses whole', () => {
    expect(stripUrls('See https://en.wikipedia.org/wiki/Evil_eye_(folklore) for more.')).toBe('See  for more.');
    expect(stripUrls('(see https://en.wikipedia.org/wiki/Evil_eye_(folklore))')).toBe('(see )');
    expect(stripUrls('(https://example.org/a)')).toBe('()');
    expect(speakable('Compare (Deut 15:9, https://en.wikipedia.org/wiki/Evil_eye_(folklore)).', [])).toBe(
      'Compare (Deuteronomy chapter 15, verse 9).',
    );
  });

  it('leaves text without URLs unchanged', () => {
    expect(stripUrls('No links here.')).toBe('No links here.');
  });
});

describe('speakOriginals', () => {
  it('replaces a whole original phrase with its transliteration', () => {
    expect(speakOriginals('Greek ὀφθαλμός σου πονηρός here', [EVIL_EYE])).toBe('Greek ophthalmos sou ponēros here');
  });

  it('replaces single words of a phrase when word counts match', () => {
    expect(speakOriginals('the word πονηρός', [EVIL_EYE])).toBe('the word ponēros');
  });

  it('matches decomposed (NFD) text', () => {
    expect(speakOriginals('ἀγαθός'.normalize('NFD'), [{ original: 'ἀγαθός', translit: 'agathos' }])).toBe('agathos');
  });

  it('does not split phrases whose word counts differ', () => {
    const entries = [{ original: 'ὁ ἀγαθός', translit: 'ho-agathos' }];
    expect(speakOriginals('ὁ ἀγαθός and ἀγαθός', entries)).toBe('ho-agathos and ');
  });

  it('keeps the first transliteration for a repeated original or word', () => {
    const entries = [
      { original: 'σου', translit: 'sou' },
      EVIL_EYE,
      { original: 'ὀφθαλμός σου πονηρός', translit: 'other' },
    ];
    expect(speakOriginals('σου · ὀφθαλμός σου πονηρός', entries)).toBe('sou · ophthalmos sou ponēros');
  });

  it('ignores empty entries', () => {
    expect(
      speakOriginals('plain', [
        { original: ' ', translit: 'x' },
        { original: 'α', translit: ' ' },
      ]),
    ).toBe('plain');
  });

  it('drops Greek and Hebrew script it has no transliteration for', () => {
    expect(speakOriginals('God, אֱלֹהִים, and λόγος ἐστίν.', [])).toBe('God, , and .');
  });

  it('matches whole words only', () => {
    expect(speakOriginals('Compare ἐντολή with ἐν, and ἐν.', [{ original: 'ἐν', translit: 'en' }])).toBe(
      'Compare  with en, and en.',
    );
    expect(speakOriginals('אֱלֹהִים', [{ original: 'אֱלֹה', translit: 'eloh' }])).toBe('');
  });

  it('treats regex characters in originals literally', () => {
    expect(speakOriginals('a (b)', [{ original: '(b)', translit: 'bee' }])).toBe('a bee');
  });
});

describe('custom spokenRef', () => {
  it('is used for every reference in prose, including after `of`', () => {
    const stub = (ref: Ref): string => `<${ref.book} ${String(ref.segments[0]?.start.c)}>`;
    expect(speakReferences('(Deut 15:9; Prov 28:22) and the Gospel of Matthew 5:3', stub)).toBe(
      '(<DT 15>; <PRV 28>) and the Gospel of <MT 5>',
    );
    expect(speakable('See Mt 6:22. [c1]', [], stub)).toBe('See <MT 6>.');
  });

  it('defaults to English and receives sub-verse letters', () => {
    const seen: Ref[] = [];
    speakReferences('Mt 20:1-16a', (ref) => {
      seen.push(ref);
      return '';
    });
    expect(seen[0]?.segments[0]?.end).toEqual({ c: 20, v: 16, part: 'a' });
    expect(englishSpokenRef(seen[0] as Ref)).toBe('Matthew chapter 20, verses 1 to 16');
  });
});

describe('speakReferences', () => {
  it.each([
    ['(Deut 15:9; Prov 28:22)', '(Deuteronomy chapter 15, verse 9; Proverbs chapter 28, verse 22)'],
    ['the echo of Mt 6:22-23.', 'the echo of Matthew chapter 6, verses 22 to 23.'],
    ['Phil 1:20c-24, 27a; 2:1.', 'Philippians chapter 1, verses 20 to 24 and 27; chapter 2, verse 1.'],
    ['in 1 Cor 13:4-7', 'in 1 Corinthians chapter 13, verses 4 to 7'],
    ['Song of Songs 2:8', 'Song of Songs chapter 2, verse 8'],
    ['the Gospel of Matthew 5:3.', 'the Gospel of Matthew chapter 5, verse 3.'],
    ['Ps 23 and Jude 3', 'Psalm 23 and Jude, verse 3'],
    ['Rom 5.12', 'Romans chapter 5, verse 12'],
    ['Mt 6:22; 300 people', 'Matthew chapter 6, verse 22; 300 people'],
    ['Mt 5:3, 1000 more', 'Matthew chapter 5, verse 3, 1000 more'],
  ])('speaks %j', (input, expected) => {
    expect(speakReferences(input)).toBe(expected);
  });

  it('drops trailing parts that do not parse', () => {
    expect(speakReferences('Mt 5:3, 9-2 then')).toBe('Matthew chapter 5, verse 3, 9-2 then');
  });

  it.each([
    'Numbers 3 people',
    'Mark 2 people',
    'Foo 2:3',
    'the Love of God 2:3',
    'Mt 5:9-2 x',
    'Mt 29:1000',
    'no reference',
  ])('leaves %j as written', (input) => {
    expect(speakReferences(input)).toBe(input);
  });
});

describe('tidy', () => {
  it('repairs the gaps removals leave', () => {
    expect(tidy('  See .  Or (  ) and “” and ( x ) ,.  ')).toBe('See. Or and and (x).');
    expect(tidy('God, , and .')).toBe('God, and.');
    expect(tidy('a (; ) b')).toBe('a b');
  });
});

describe('asSentence', () => {
  it.each([
    ['A title', 'A title.'],
    ['Done.', 'Done.'],
    ['Why?', 'Why?'],
    ['He said “stop.”', 'He said “stop.”'],
    ['  ', ''],
  ])('%j → %j', (input, expected) => {
    expect(asSentence(input)).toBe(expected);
  });
});

describe('speakable', () => {
  it('chains every step', () => {
    expect(speakable('The ὀφθαλμός σου πονηρός (Deut 15:9, https://x.org/y) idiom. [c3][c4]', [EVIL_EYE])).toBe(
      'The ophthalmos sou ponēros (Deuteronomy chapter 15, verse 9) idiom.',
    );
  });
});
