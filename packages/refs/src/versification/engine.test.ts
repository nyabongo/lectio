import { describe, expect, it } from 'vitest';

import type { VerseId } from '../enumerate.ts';
import { coalesce, createVersification } from './engine.ts';
import { VersificationError } from './errors.ts';
import { chapters } from './schemes.ts';
import type { SchemeDefinition } from './schemes.ts';

/** A tiny made-up versification: Joel shaped two ways, and a layout pointing at missing data. */
const texts = {
  org: 'JOL 1:20 2:27 3:5 4:21\nAMO 1:15',
  eng: 'JOL 1:20 2:32 3:21\nAMO 1:15\nJOL 2:28-32 = JOL 3:1-5\nJOL 3:1-21 = JOL 4:1-21',
  engSupplement: 'AMO 1:1 = JOL 1:1',
};

const schemes: Record<'original' | 'vulgate' | 'lxx' | 'english', SchemeDefinition> = {
  original: { file: 'org', layouts: {} },
  // No text at all.
  vulgate: { file: 'missing', layouts: {} },
  // A layout whose source book is absent, and a span with an explicit count; no supplement.
  lxx: {
    file: 'org',
    layouts: { JL: [...chapters('XXX', 1, 2), { c: 3, book: 'JOL', sc: 3, count: 2 }] },
  },
  english: { file: 'eng', supplement: 'engSupplement', layouts: {} },
};

const versification = createVersification({ texts, schemes });
const v = (c: number, verse: number, book: VerseId['book'] = 'JL'): VerseId => ({ book, c, v: verse });

describe('createVersification over injected tables', () => {
  it('maps with the file and the supplement', () => {
    expect(versification.mapVerse(v(3, 1), 'original', 'english')).toEqual(v(2, 28));
    expect(versification.mapVerse(v(4, 21), 'original', 'english')).toEqual(v(3, 21));
    expect(versification.mapVerse(v(1, 1), 'original', 'english')).toEqual(v(1, 1, 'AM'));
  });

  it('lets a mapping move a verse into another book, which mapRef refuses', () => {
    expect(versification.mapVerse(v(1, 1, 'AM'), 'english', 'original')).toEqual(v(1, 1));
    expect(() =>
      versification.mapRef({ book: 'AM', segments: [{ start: v(1, 1), end: v(1, 2) }] }, 'english', 'original'),
    ).toThrow(VersificationError);
  });

  it('treats a missing text or source book as an empty table', () => {
    expect(versification.chapterCount('JL', 'vulgate')).toBe(0);
    expect(versification.isRealVerse(v(1, 1), 'vulgate')).toBe(false);
    expect(versification.chapterLength('JL', 1, 'lxx')).toBeUndefined();
    expect(versification.chapterCount('JL', 'lxx')).toBe(3);
    expect(versification.chapterLength('JL', 3, 'lxx')).toBe(2);
    expect(versification.mapVerse(v(3, 2), 'lxx', 'original')).toEqual(v(3, 2));
    expect(() => versification.mapVerse(v(3, 3), 'original', 'lxx')).toThrow(/no counterpart in the lxx scheme/);
  });
});

describe('coalesce', () => {
  const length = (_book: string, c: number): number | undefined => [20, 27, 5, 21][c - 1];

  it('joins consecutive verses, across chapters too, and skips repeats', () => {
    expect(coalesce('JL', [v(2, 26), v(2, 27), v(3, 1), v(3, 1), v(3, 2), v(1, 5)], false, length)).toEqual([
      { start: { c: 2, v: 26 }, end: { c: 3, v: 2 } },
      { start: { c: 1, v: 5 }, end: { c: 1, v: 5 } },
    ]);
  });

  it('writes whole chapters as chapter segments when asked', () => {
    const all = (c: number): VerseId[] => Array.from({ length: length('JL', c) ?? 0 }, (_, i) => v(c, i + 1));
    expect(coalesce('JL', [...all(3), ...all(4)], true, length)).toEqual([{ start: { c: 3 }, end: { c: 4 } }]);
    expect(coalesce('JL', [...all(3), ...all(4)], false, length)).toEqual([
      { start: { c: 3, v: 1 }, end: { c: 4, v: 21 } },
    ]);
    expect(coalesce('JL', all(3).slice(1), true, length)).toEqual([{ start: { c: 3, v: 2 }, end: { c: 3, v: 5 } }]);
    expect(coalesce('JL', [], true, length)).toEqual([]);
  });

  it('treats a chapter that starts after verse 1 as whole from its first verse', () => {
    const first = (_book: string, c: number): number | undefined => (c === 4 ? 10 : undefined);
    const run = (c: number, from: number): VerseId[] =>
      Array.from({ length: (length('JL', c) ?? 0) - from + 1 }, (_, i) => v(c, from + i));
    expect(coalesce('JL', [...run(3, 1), ...run(4, 10)], true, length, first)).toEqual([
      { start: { c: 3 }, end: { c: 4 } },
    ]);
    expect(coalesce('JL', run(4, 10), false, length, first)).toEqual([
      { start: { c: 4, v: 10 }, end: { c: 4, v: 21 } },
    ]);
    expect(coalesce('JL', [...run(3, 1), ...run(4, 10)], true, length)).toEqual([
      { start: { c: 3 }, end: { c: 3 } },
      { start: { c: 4, v: 10 }, end: { c: 4, v: 21 } },
    ]);
  });

  it('refuses verses from another book', () => {
    expect(() => coalesce('JL', [v(1, 1), v(1, 2, 'AM')], false, length)).toThrow(/falls in another book/);
  });
});
