import { describe, expect, it } from 'vitest';

import { BOOKS } from '@lectio/refs';

import { SWAHILI_BOOKS, findSwahiliBook, swahiliBookEntries, swahiliBookNames } from './books.ts';

describe('Kiswahili book names', () => {
  it('covers every book of the canon', () => {
    expect(Object.keys(SWAHILI_BOOKS).sort()).toEqual(BOOKS.map((book) => book.code).sort());
  });

  it('never gives one written form to two books', () => {
    const owners = new Map<string, Set<string>>();
    for (const [name, code] of swahiliBookEntries()) {
      const key = name.toLowerCase().replace(/^([1-3]) /, '$1');
      owners.set(key, (owners.get(key) ?? new Set()).add(code));
    }
    expect([...owners].filter(([, codes]) => codes.size > 1)).toEqual([]);
  });

  it.each([
    ['Mathayo', 'MT'],
    ['Kumbukumbu la Torati', 'DT'],
    ['Kum.', 'DT'],
    ['mit', 'PRV'],
    ['1 Kor', '1COR'],
    ['1Kor', '1COR'],
    ['1  Wakorintho', '1COR'],
    ['Wakorintho wa Kwanza', '1COR'],
    ['Yud', 'JUDE'],
    ['Ydt', 'JDT'],
    ['Mdo', 'ACTS'],
  ])('finds %s', (name, code) => {
    expect(findSwahiliBook(name)).toBe(code);
  });

  it('knows nothing of English names or other words', () => {
    expect(findSwahiliBook('Deuteronomy')).toBeUndefined();
    expect(findSwahiliBook('Mara')).toBeUndefined();
  });

  it('lists every written form once, longest first', () => {
    const names = swahiliBookNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]?.length).toBeGreaterThanOrEqual(names.at(-1)?.length ?? 0);
    expect(names.indexOf('Mambo ya Nyakati ya Kwanza')).toBeLessThan(names.indexOf('Mambo ya Walawi'));
    expect(names).toContain('Kum');
  });
});
