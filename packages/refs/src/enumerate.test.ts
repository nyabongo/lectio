import { describe, expect, it } from 'vitest';

import { enumerateVerses, parseRef } from './index.ts';
import type { VerseCountLookup } from './index.ts';

/** A fake lookup: every chapter has 5 verses except chapter 99, which does not exist. */
const fiveVerses: VerseCountLookup = (_book, chapter) => (chapter === 99 ? undefined : 5);

const ids = (input: string): string[] =>
  enumerateVerses(parseRef(input), fiveVerses).map(({ book, c, v }) => `${book}.${c}.${v}`);

describe('enumerateVerses', () => {
  it('lists a verse range', () => {
    expect(ids('Mt 20:1-3')).toEqual(['MT.20.1', 'MT.20.2', 'MT.20.3']);
  });

  it('lists several segments in reading order, sub-verse letters ignored', () => {
    expect(ids('Phil 1:2c-3, 5a')).toEqual(['PHIL.1.2', 'PHIL.1.3', 'PHIL.1.5']);
  });

  it('lists a whole chapter and a chapter range using the lookup', () => {
    expect(ids('Ps 23')).toHaveLength(5);
    expect(ids('Is 40-41')).toEqual([
      ...[1, 2, 3, 4, 5].map((v) => `IS.40.${v}`),
      ...[1, 2, 3, 4, 5].map((v) => `IS.41.${v}`),
    ]);
  });

  it('crosses chapters using the lookup', () => {
    expect(ids('Eccl 11:4-13:2')).toEqual([
      'ECCL.11.4',
      'ECCL.11.5',
      ...[1, 2, 3, 4, 5].map((v) => `ECCL.12.${v}`),
      'ECCL.13.1',
      'ECCL.13.2',
    ]);
  });

  it('lists repeated verses once', () => {
    expect(ids('Ps 96:1-2, 2-3')).toEqual(['PS.96.1', 'PS.96.2', 'PS.96.3']);
  });

  it('does not consult the lookup for plain verse ranges', () => {
    const never: VerseCountLookup = () => {
      throw new Error('not needed');
    };
    expect(enumerateVerses(parseRef('Jude 3-4'), never)).toEqual([
      { book: 'JUDE', c: 1, v: 3 },
      { book: 'JUDE', c: 1, v: 4 },
    ]);
  });

  it('throws when the lookup does not know a chapter', () => {
    expect(() => ids('Ps 99')).toThrow('No verse count for PS 99');
  });

  it('rejects malformed refs', () => {
    expect(() => enumerateVerses({ book: 'MT', segments: [] }, fiveVerses)).toThrow('at least one segment');
  });
});
