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

  it('drops inline tags without a space and turns block tags into spaces', () => {
    expect(stripTags('day<a href="/x">’s</a> <EM>wage</EM><span class="v">s</span><p>next</p>line<br>end')).toBe(
      'day’s wages next line end',
    );
    expect(stripTags('<blockquote>a</blockquote><article>b</article>')).toBe(' a  b ');
  });

  it('spaces inline tags instead when asked', () => {
    expect(stripTags('<sup>1</sup>The <i>kingdom</i>', false)).toBe(' 1 The  kingdom ');
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

  it('stays fast on many repeated pieces over long repetitive text (no exponential backtracking)', () => {
    const page = 'The owner of the house went out at the third hour and saw the others standing in the market. '.repeat(
      200,
    );
    const start = performance.now();
    expect(excerptOccurs(`${'the … '.repeat(12)}unicorn`, page)).toBe(false);
    expect(excerptOccurs(`${'the … '.repeat(12)}market`, page)).toBe(true);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('matches with inline tags glued or spaced, whichever the page needs', () => {
    for (const page of [
      '<p><sup>1</sup>The kingdom of heaven is like a householder.</p>',
      '<p><span class="reftext">1</span>The kingdom of heaven is like a householder.</p>',
      '<p><a href="/matthew/20-1.htm">Mt 20:1</a>The kingdom of heaven is like a householder.</p>',
    ]) {
      expect(excerptOccurs('The kingdom of heaven', page)).toBe(true);
    }
    expect(excerptOccurs('The word Ἑταῖρε is used', '<p>The word <a href="/g">Ἑ<i>ταῖρε</i></a> is used</p>')).toBe(
      true,
    );
    expect(excerptOccurs('1The kingdom of', '<p><sup>1</sup> The kingdom of</p>')).toBe(false);
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
