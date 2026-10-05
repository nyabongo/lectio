import { describe, expect, it } from 'vitest';

import { chunkText, codePointLength } from './chunk.ts';

describe('codePointLength', () => {
  it('counts astral characters once', () => {
    expect(codePointLength('a𝔸é')).toBe(3);
  });
});

describe('chunkText', () => {
  it('keeps short text in one trimmed chunk', () => {
    expect(chunkText('  One sentence. Two sentences.  ', 100)).toEqual(['One sentence. Two sentences.']);
  });

  it('yields no chunks for whitespace-only text', () => {
    expect(chunkText(' \n\t ', 10)).toEqual([]);
    expect(chunkText('', 10)).toEqual([]);
  });

  it('breaks at sentence boundaries when sentences fit', () => {
    const text = 'First sentence here. Second one now. Third.';
    expect(chunkText(text, 25)).toEqual(['First sentence here.', 'Second one now. Third.']);
  });

  it('breaks a long sentence at word boundaries', () => {
    const chunks = chunkText('alpha beta gamma delta epsilon', 12);
    expect(chunks).toEqual(['alpha beta', 'gamma delta', 'epsilon']);
    for (const chunk of chunks) expect(codePointLength(chunk)).toBeLessThanOrEqual(12);
  });

  it('hard-splits a word longer than the limit, by code point', () => {
    expect(chunkText('ab𝔸defgh ij', 3)).toEqual(['ab𝔸', 'def', 'gh', 'ij']);
  });

  it('never exceeds the limit and loses no non-space characters', () => {
    const text = 'In the beginning was the Word. '.repeat(40) + 'Supercalifragilistic'.repeat(5) + '! End.';
    const chunks = chunkText(text, 50);
    for (const chunk of chunks) expect(codePointLength(chunk)).toBeLessThanOrEqual(50);
    expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('rejects a non-positive or fractional limit', () => {
    expect(() => chunkText('x', 0)).toThrow(RangeError);
    expect(() => chunkText('x', 1.5)).toThrow('maxChars must be a positive integer, got 1.5');
  });
});
