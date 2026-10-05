import { describe, expect, it } from 'vitest';

import { RefError, checkRef } from './index.ts';
import type { BookCode, Ref, RefErrorCode } from './index.ts';

const at = (start: Ref['segments'][number]['start'], end = start): Ref => ({
  book: 'MT',
  segments: [{ start, end }],
});

describe('checkRef', () => {
  it.each<[string, Ref, RefErrorCode]>([
    ['an unknown book', { book: 'XX' as BookCode, segments: [{ start: { c: 1 }, end: { c: 1 } }] }, 'INVALID_REF'],
    ['no segments', { book: 'MT', segments: [] }, 'INVALID_REF'],
    ['a fractional chapter', at({ c: 1.5 }), 'INVALID_REF'],
    ['a negative verse', at({ c: 1, v: -2 }), 'INVALID_REF'],
    ['a zero chapter', at({ c: 0 }), 'ZERO'],
    ['an upper-case part', at({ c: 1, v: 1, part: 'A' }), 'INVALID_REF'],
    ['a part on a chapter', at({ c: 1, part: 'a' }), 'PART_ON_CHAPTER'],
    ['a mixed range', at({ c: 1, v: 1 }, { c: 2 }), 'MIXED_RANGE'],
    ['a descending chapter range', at({ c: 2 }, { c: 1 }), 'DESCENDING'],
    [
      'a whole chapter in a one-chapter book',
      { book: 'JUDE', segments: [{ start: { c: 1 }, end: { c: 1 } }] },
      'SINGLE_CHAPTER',
    ],
  ])('rejects %s', (_label, ref, code) => {
    try {
      checkRef(ref);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RefError);
      expect((error as RefError).code).toBe(code);
      expect((error as RefError).name).toBe('RefError');
      expect((error as RefError).input).toBeUndefined();
    }
  });

  it('returns the book of a well-formed ref', () => {
    expect(checkRef(at({ c: 5, v: 3, part: 'ab' }, { c: 5, v: 9 })).code).toBe('MT');
  });
});
