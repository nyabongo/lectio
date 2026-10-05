import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BOOKS, isBookCode } from '../books.ts';
import { chapterCount } from '../versification/index.ts';
import { DRBO_BASE, drboChapterUrl, drboUrl, firstChapter } from './drbo.ts';

interface CheckedBook {
  code: string;
  douayRheimsNumber: number;
  siteName: string;
  drboChapters: number;
  vulgateChapters: number;
  firstChapterUrl: string;
  lastChapterUrl: string;
  note?: string;
}

/** The one-off check of the drbo.org URL pattern for all 73 books (see the fixture's description). */
const checked = JSON.parse(readFileSync(new URL('./fixtures/drbo-books.json', import.meta.url), 'utf8')) as {
  checked: string;
  books: CheckedBook[];
};

describe('drboChapterUrl', () => {
  it('pads the Douay-Rheims book number to two digits and the chapter to three', () => {
    expect(drboChapterUrl('MT', 20)).toBe('https://www.drbo.org/chapter/47020.htm');
    expect(drboChapterUrl('GN', 1)).toBe('https://www.drbo.org/chapter/01001.htm');
    expect(drboChapterUrl('PS', 144)).toBe('https://www.drbo.org/chapter/21144.htm');
    expect(drboChapterUrl('1MC', 3)).toBe('https://www.drbo.org/chapter/45003.htm');
  });

  it('matches the recorded check for all 73 books', () => {
    expect(checked.books.map((b) => b.code)).toEqual(BOOKS.map((b) => b.code));
    for (const book of checked.books) {
      if (!isBookCode(book.code)) throw new Error(`fixture has unknown book ${book.code}`);
      expect(drboChapterUrl(book.code, 1)).toBe(book.firstChapterUrl);
      expect(drboChapterUrl(book.code, book.drboChapters)).toBe(book.lastChapterUrl);
      expect(book.firstChapterUrl.startsWith(DRBO_BASE)).toBe(true);
    }
  });

  it('only differs from the L-006 Vulgate chapter counts where the fixture explains why', () => {
    for (const book of checked.books) {
      if (!isBookCode(book.code)) throw new Error(`fixture has unknown book ${book.code}`);
      expect(book.vulgateChapters).toBe(chapterCount(book.code, 'vulgate'));
      if (book.vulgateChapters !== book.drboChapters) expect(book.note, book.code).toBeTypeOf('string');
    }
    expect(checked.books.filter((b) => b.note).map((b) => b.code)).toEqual(['EST', 'SIR']);
  });
});

describe('drboUrl', () => {
  it('links to the first chapter of a multi-chapter reference', () => {
    const ref = {
      book: 'IS',
      segments: [{ start: { c: 52, v: 13 }, end: { c: 53, v: 12 } }],
    } as const;
    expect(firstChapter(ref)).toBe(52);
    expect(drboUrl(ref)).toBe('https://www.drbo.org/chapter/27052.htm');
  });
});
