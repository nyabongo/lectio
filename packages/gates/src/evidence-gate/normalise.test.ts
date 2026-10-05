import { describe, expect, it } from 'vitest';

import {
  decodeEntities,
  excerptLongEnough,
  excerptOccurs,
  excerptPieces,
  normaliseText,
  stripTags,
  wordCount,
} from './normalise.ts';

describe('decodeEntities', () => {
  it('decodes numeric references and common named entities', () => {
    expect(decodeEntities('a&amp;b &lt;i&gt; &#8212; &#x2019; &rsquo;&nbsp;&hellip;')).toBe('a&b <i> — ’ ’ …');
  });

  it('leaves unknown names and out-of-range code points as written', () => {
    expect(decodeEntities('&bogus; &#99999999; &#x110000; & alone')).toBe('&bogus; &#99999999; &#x110000; & alone');
  });
});

describe('stripTags', () => {
  it('drops scripts, styles, comments and tags, keeping words apart', () => {
    expect(
      stripTags('<p>one<br/>two</p><script type="x">three</script><STYLE>p{}</STYLE><!-- four -->five').replace(
        / +/gu,
        ' ',
      ),
    ).toBe(' one two five');
  });

  it('keeps a lone less-than sign that is not a tag', () => {
    expect(stripTags('1 < 2')).toBe('1 < 2');
  });
});

describe('normaliseText', () => {
  it('folds quotes, dashes, ellipses, invisible characters, whitespace and case', () => {
    expect(normaliseText('  “It’s” — a­b…\n\tC ')).toBe('"it\'s" - ab... c');
  });
});

describe('excerptPieces / excerptOccurs', () => {
  it('splits at ellipses and drops empty pieces', () => {
    expect(excerptPieces('one … two ... three....')).toEqual(['one', 'two', 'three']);
    expect(excerptPieces('…')).toEqual([]);
  });

  it('matches across markup, entities and typography', () => {
    const page = '<p>The <em>day&#x2019;s</em>\n wage &ndash; a denarius</p>';
    expect(excerptOccurs('the day’s wage — a denarius', page)).toBe(true);
    expect(excerptOccurs("The day's wage - a DENARIUS", page)).toBe(true);
    expect(excerptOccurs('the day’s wage, a denarius', page)).toBe(false);
  });

  it('requires the pieces in order and some text', () => {
    expect(excerptOccurs('first … last', 'first, middle, last')).toBe(true);
    expect(excerptOccurs('last … first', 'first, middle, last')).toBe(false);
    expect(excerptOccurs('...', 'anything')).toBe(false);
  });
});

describe('whole-word, windowed matching', () => {
  const page = 'The labourers went into the vineyard and were paid at evening.';

  it('matches whole words only', () => {
    expect(excerptOccurs('he', page)).toBe(false);
    expect(excerptOccurs('vine', page)).toBe(false);
    expect(excerptOccurs('The ... vine ... paid ... a', page)).toBe(false);
    expect(excerptOccurs('vineyard', page)).toBe(true);
    expect(excerptOccurs('at evening.', page)).toBe(true);
    expect(excerptOccurs('"went into', 'they "went into the field')).toBe(true);
  });

  it('tries later occurrences of a piece when an earlier one leads nowhere', () => {
    expect(excerptOccurs('the … were paid', page)).toBe(true);
    const text = `the start ${'x '.repeat(300)} the end were paid`;
    expect(excerptOccurs('the … were paid', text)).toBe(true);
    expect(excerptOccurs('the start … were paid', text)).toBe(false);
    const three = `a b c d e f ${'x '.repeat(150)}d e f ${'y '.repeat(75)}g h i`;
    expect(excerptOccurs('a b c … d e f … g h i', three)).toBe(true);
  });

  it('drops pieces with no letter or digit', () => {
    expect(excerptPieces('— … ·')).toEqual([]);
    expect(excerptOccurs('—', 'a — b')).toBe(false);
  });

  it('counts words and requires three in every piece', () => {
    expect(wordCount('a comrade, mate - partner')).toBe(4);
    expect(excerptLongEnough('a comrade, mate')).toBe(true);
    expect(excerptLongEnough('a comrade … mate, partner, friend')).toBe(false);
    expect(excerptLongEnough('…')).toBe(false);
  });
});
