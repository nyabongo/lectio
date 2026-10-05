import { describe, expect, it } from 'vitest';

import { seededRandom } from './hash.ts';
import { PatternError, generateFromPattern } from './pattern.ts';

const generate = (pattern: string, seed = 's'): string => generateFromPattern(pattern, seededRandom(seed));

describe('generateFromPattern', () => {
  it.each([
    '^[a-z0-9]+(-[a-z0-9]+)*$',
    '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$',
    '^\\S(.*\\S)?$',
    '^([^\\[\\]]+(\\[c[1-9][0-9]*\\])+)+$',
    '^\\S+( \\S+){0,5}$',
    '^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$',
    '^(/([^~/]|~[01])*)*$',
    '^[^/\\\\].*$',
    '^https?://',
    '^c[1-9][0-9]*$',
    '^[1-3]?[A-Z]{2,5}\\.[1-9][0-9]{0,2}(-[1-9][0-9]{0,2}|\\.[1-9][0-9]{0,2}(-([1-9][0-9]{0,2}\\.)?[1-9][0-9]{0,2})?)?$',
    '^\\d{4}-\\d\\d-\\d{2,}$',
    '^\\w\\W\\D\\s\\t\\n$',
    '^(?:ab|cd)x{2}y*?z+$',
    '^[\\d\\-x-z.]$',
    'unanchored',
  ])('produces a match for /%s/', (pattern) => {
    for (const seed of ['a', 'b', 'c']) expect(generate(pattern, seed)).toMatch(new RegExp(pattern, 'u'));
  });

  it('is deterministic per seed', () => {
    expect(generate('^[a-z]{8}$', 'x')).toBe(generate('^[a-z]{8}$', 'x'));
    expect(generate('^[a-z]{8}$', 'x')).not.toBe(generate('^[a-z]{8}$', 'y'));
  });

  it.each([
    ['(?=a)b', /lookarounds/],
    ['(ab', /unexpected end/],
    ['a)', /unexpected "\)"/],
    ['*a', /nothing to repeat/],
    ['a{x}', /invalid "\{" quantifier/],
    ['\\p{L}', /escape "\\p" is not supported/],
    ['[z-a]', /invalid range/],
    ['[a-\\d]', /invalid range/],
    ['[^\\s\\S]', /matches no printable ASCII/],
    ['\\', /unexpected end/],
  ])('rejects /%s/', (pattern, message) => {
    expect(() => generate(pattern)).toThrow(PatternError);
    expect(() => generate(pattern)).toThrow(message);
  });
});
