import { describe, expect, it } from 'vitest';

import { decodeEntities, excerptOccurs, excerptPieces, normaliseText, stripTags } from './normalise.ts';

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
