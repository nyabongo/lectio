import { describe, expect, it } from 'vitest';

import { isFilenameSafe } from './fixtures/arbitraries.ts';
import {
  BOOKS,
  bookAliases,
  buildAliasIndex,
  findBook,
  getBook,
  isBookCode,
  normalizeBookName,
  packageName,
} from './index.ts';
import type { Book, BookCode } from './index.ts';

describe('book table', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/refs');
  });

  it('lists the 73-book Catholic canon in order', () => {
    expect(BOOKS).toHaveLength(73);
    expect(BOOKS.filter((b) => b.testament === 'OT')).toHaveLength(46);
    expect(BOOKS.filter((b) => b.testament === 'NT')).toHaveLength(27);
    expect(BOOKS.map((b) => b.order)).toEqual(Array.from({ length: 73 }, (_, i) => i + 1));
    expect(BOOKS[0]?.code).toBe('GN');
    expect(BOOKS[45]?.code).toBe('MAL');
    expect(BOOKS[46]?.code).toBe('MT');
    expect(BOOKS[72]?.code).toBe('RV');
  });

  it('uses the upper-cased NABRE abbreviation as the code', () => {
    for (const book of BOOKS) expect(book.code).toBe(book.abbrev.replace(/\s/g, '').toUpperCase());
    expect(BOOKS.map((b) => b.code)).toEqual(
      expect.arrayContaining(['GN', 'EX', 'PS', 'PRV', 'ECCL', 'IS', 'MT', 'MK', 'LK', 'JN', 'ACTS', 'ROM', '1COR']),
    );
  });

  it('has unique codes, OSIS ids, USFM ids and Douay-Rheims numbers', () => {
    const unique = (values: readonly unknown[]): number => new Set(values).size;
    expect(unique(BOOKS.map((b) => b.code))).toBe(73);
    expect(unique(BOOKS.map((b) => b.code.toLowerCase()))).toBe(73);
    expect(unique(BOOKS.map((b) => b.osis))).toBe(73);
    expect(unique(BOOKS.map((b) => b.usfm))).toBe(73);
    expect(BOOKS.map((b) => b.douayRheims.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 73 }, (_, i) => i + 1),
    );
  });

  it('records Douay-Rheims numbering and names', () => {
    expect(getBook('1SM').douayRheims).toEqual({ number: 9, name: '1 Kings' });
    expect(getBook('1KGS').douayRheims).toEqual({ number: 11, name: '3 Kings' });
    expect(getBook('MAL').douayRheims).toEqual({ number: 44, name: 'Malachias' });
    expect(getBook('1MC').douayRheims).toEqual({ number: 45, name: '1 Machabees' });
    expect(getBook('MT').douayRheims.number).toBe(47);
    expect(getBook('RV').douayRheims).toEqual({ number: 73, name: 'Apocalypse' });
  });

  it('records ids, testament and original languages', () => {
    expect(getBook('PHIL')).toMatchObject({
      name: 'Philippians',
      abbrev: 'Phil',
      osis: 'Phil',
      usfm: 'PHP',
      testament: 'NT',
      languages: ['greek'],
      singleChapter: false,
    });
    expect(getBook('DN').languages).toEqual(['hebrew', 'aramaic', 'greek']);
    expect(getBook('WIS').languages).toEqual(['greek']);
    expect(getBook('PS').languages).toEqual(['hebrew']);
  });

  it('flags the five one-chapter books', () => {
    expect(BOOKS.filter((b) => b.singleChapter).map((b) => b.code)).toEqual(['OB', 'PHLM', '2JN', '3JN', 'JUDE']);
  });

  it('codes are safe file names', () => {
    for (const book of BOOKS) expect(isFilenameSafe(book.code)).toBe(true);
  });
});

describe('book lookup', () => {
  it.each([
    ['Mt', 'MT'],
    ['Matt', 'MT'],
    ['Matthew', 'MT'],
    ['Is', 'IS'],
    ['Isa', 'IS'],
    ['Ps', 'PS'],
    ['Pss', 'PS'],
    ['Psalm', 'PS'],
    ['Psalms', 'PS'],
    ['1 Cor', '1COR'],
    ['1Cor', '1COR'],
    ['I Corinthians', '1COR'],
    ['III John', '3JN'],
    ['Second Kings', '2KGS'],
    ['Song of Solomon', 'SG'],
    ['Qoheleth', 'ECCL'],
    ['Apocalypse', 'RV'],
    ['ECCL', 'ECCL'],
    ['1Thess', '1THES'],
    ['1st Cor', '1COR'],
    ['2nd Peter', '2PT'],
    ['3rd Jn', '3JN'],
  ])('finds %s as %s', (name, code) => {
    expect(findBook(name)?.code).toBe(code);
  });

  it('returns undefined for unknown names', () => {
    expect(findBook('Hezekiah')).toBeUndefined();
  });

  it('normalises names', () => {
    expect(normalizeBookName(' I  Cor. ')).toBe('1cor');
    expect(normalizeBookName('First John')).toBe('1john');
    expect(normalizeBookName('Is')).toBe('is');
  });

  it('checks codes', () => {
    expect(isBookCode('MT')).toBe(true);
    expect(isBookCode('mt')).toBe(false);
    expect(() => getBook('XX' as BookCode)).toThrow('Unknown book code "XX"');
  });

  it('exposes the alias index without collisions', () => {
    const aliases = bookAliases();
    expect(aliases.get('matt')).toBe('MT');
    expect(new Set(aliases.values()).size).toBe(73);
  });

  it('refuses an alias claimed by two books', () => {
    const clash: Book = { ...getBook('MK'), aliases: ['Mt'] };
    expect(() => buildAliasIndex([getBook('MT'), clash])).toThrow('Book alias "Mt" is claimed by both MT and MK');
  });
});
