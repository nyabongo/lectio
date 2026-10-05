import { describe, expect, it } from 'vitest';

import type { VerseId } from '../enumerate.ts';
import { formatRef } from '../format.ts';
import { GREEK_ESTHER_LETTERS, letteredChapter } from '../greek-esther.ts';
import * as refs from '../index.ts';
import { parseRef } from '../parse.ts';
import { VRS_DATA } from './__generated__/vrs-data.ts';
import {
  chapterCount,
  chapterLength,
  createGreekEstherLxx,
  firstVerse,
  fromSourceVerse,
  greekEstherLxx,
  isRealVerse,
  mapRef,
  mapVerse,
  notInOriginal,
  readRahlfsEsther,
  toSourceVerse,
  verseCounts,
  versification,
} from './index.ts';
import type { LxxVerse, Scheme, VersificationError } from './index.ts';

const est = (c: number, v: number): VerseId => ({ book: 'EST', c, v });
const lettered = (letter: (typeof GREEK_ESTHER_LETTERS)[number], v: number): VerseId => est(letteredChapter(letter), v);
const mapText = (text: string, from: Scheme, to: Scheme): string => formatRef(mapRef(parseRef(text), from, to));
const rahlfs = (verse: LxxVerse): string => `${verse.c}:${verse.v}${verse.part ?? ''}`;
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as VersificationError).code;
  }
  return undefined;
};

/** NABRE verse counts of the lettered chapters. */
const LENGTHS = { A: 17, B: 7, C: 30, D: 16, E: 24, F: 11 } as const;

describe('Greek Esther in the original scheme (L-049)', () => {
  it('has the NABRE lettered chapters next to the ten Hebrew chapters', () => {
    expect(chapterCount('EST')).toBe(10);
    for (const letter of GREEK_ESTHER_LETTERS) {
      expect(chapterLength('EST', letteredChapter(letter)), letter).toBe(LENGTHS[letter]);
      expect(firstVerse('EST', letteredChapter(letter)), letter).toBe(1);
    }
    expect(chapterLength('EST', 107)).toBeUndefined();
    expect(isRealVerse('EST.C.30')).toBe(true);
    expect(isRealVerse('EST.C.31')).toBe(false);
    expect(isRealVerse('EST.A_F')).toBe(true);
    expect(isRealVerse(lettered('F', 11))).toBe(true);
    expect(verseCounts()('EST', letteredChapter('E'))).toBe(24);
  });

  it('lays the lettered chapters on org.vrs ESG', () => {
    expect(toSourceVerse(lettered('A', 1))).toEqual({ book: 'ESG', c: 1, v: 1 });
    expect(toSourceVerse(lettered('C', 12))).toEqual({ book: 'ESG', c: 4, v: 29 });
    expect(toSourceVerse(lettered('F', 11))).toEqual({ book: 'ESG', c: 10, v: 14 });
    expect(fromSourceVerse({ book: 'ESG', c: 8, v: 13 })).toEqual(lettered('E', 1));
    expect(fromSourceVerse({ book: 'ESG', c: 1, v: 18 })).toBeUndefined();
    expect(toSourceVerse(est(4, 17))).toEqual({ book: 'EST', c: 4, v: 17 });
  });

  it('marks the additions as having no Hebrew original', () => {
    expect(notInOriginal(lettered('C', 12))).toBe(true);
    expect(notInOriginal(est(14, 1), 'vulgate')).toBe(true);
    expect(notInOriginal(est(4, 17))).toBe(false);
  });
});

describe('Greek Esther in the vulgate scheme', () => {
  it('has the Clementine / Douay-Rheims chapters 1-16', () => {
    expect(chapterCount('EST', 'vulgate')).toBe(16);
    expect([10, 11, 12, 13, 14, 15, 16].map((c) => chapterLength('EST', c, 'vulgate'))).toEqual([
      13, 12, 6, 18, 19, 19, 24,
    ]);
    expect(chapterLength('EST', 1, 'vulgate')).toBe(22);
    expect(chapterLength('EST', 4, 'vulgate')).toBe(17);
  });

  it('maps the lettered chapters onto 10:4-16:24 (STEPBible TVTMS)', () => {
    expect(mapText('Est A:1-11', 'original', 'vulgate')).toBe('Est 11:2–12');
    expect(mapText('Est A:12-17', 'original', 'vulgate')).toBe('Est 12:1–6');
    expect(mapText('Est A', 'original', 'vulgate')).toBe('Est 11:2–12:6');
    expect(mapText('Est B', 'original', 'vulgate')).toBe('Est 13:1–7');
    expect(mapText('Est C:1-11', 'original', 'vulgate')).toBe('Est 13:8–18');
    expect(mapText('Est C:12-30', 'original', 'vulgate')).toBe('Est 14:1–19');
    expect(mapText('Est D', 'original', 'vulgate')).toBe('Est 15:4–19');
    expect(mapText('Est E', 'original', 'vulgate')).toBe('Est 16');
    expect(mapText('Est F:1-10', 'original', 'vulgate')).toBe('Est 10:4–13');
    expect(mapText('Est F:11', 'original', 'vulgate')).toBe('Est 11:1');
  });

  it('maps every Vulgate verse of 10:4-16:24 back to a lettered verse', () => {
    expect(mapText('Est 15:1-4', 'vulgate', 'original')).toBe('Est D:1');
    expect(mapText('Est 10:4-11:12', 'vulgate', 'original')).toBe('Est F:1–11; A:1–11');
    expect(mapText('Est 12:1-16:24', 'vulgate', 'original')).toBe('Est A:12–E:24');
    for (let c = 11; c <= 16; c++) {
      for (let v = 1; v <= (chapterLength('EST', c, 'vulgate') ?? 0); v++) {
        const canonical = mapVerse(est(c, v), 'vulgate', 'original');
        expect(canonical.c, `${c}:${v}`).toBeGreaterThan(100);
      }
    }
  });

  it('round-trips every lettered verse except through the many-to-one D:1', () => {
    for (const letter of GREEK_ESTHER_LETTERS) {
      for (let v = 1; v <= LENGTHS[letter]; v++) {
        const verse = lettered(letter, v);
        expect(mapVerse(mapVerse(verse, 'original', 'vulgate'), 'vulgate', 'original'), `${letter}:${v}`).toEqual(
          verse,
        );
      }
    }
    expect(mapVerse(est(15, 2), 'vulgate', 'original')).toEqual(lettered('D', 1));
    expect(mapVerse(lettered('D', 1), 'original', 'vulgate')).toEqual(est(15, 4));
  });

  it('passes Hebrew Esther through by number', () => {
    expect(mapVerse(est(4, 17), 'original', 'vulgate')).toEqual(est(4, 17));
    expect(mapVerse(est(10, 3), 'vulgate', 'original')).toEqual(est(10, 3));
    expect(mapText('Est 10:1-4', 'vulgate', 'original')).toBe('Est 10:1–3; F:1');
  });
});

describe('Greek Esther in the lxx and english schemes', () => {
  it('has no verse numbers for the additions', () => {
    expect(code(() => mapRef(parseRef('Est C:12, 14-16'), 'original', 'lxx'))).toBe('UNSUPPORTED_GREEK_ESTHER');
    expect(code(() => mapRef(parseRef('Est F'), 'original', 'english'))).toBe('UNSUPPORTED_GREEK_ESTHER');
    expect(code(() => mapRef(parseRef('Ps 3:1'), 'original', 'english'))).toBe('NO_COUNTERPART');
    expect(() => mapRef(parseRef('Ps 3:1'), 'original', 'english')).toThrow(
      'PS: the reference (original) has no counterpart in the english scheme',
    );
    // The Hebrew verses around them still map.
    expect(mapText('Est 4:17; C:1', 'original', 'lxx')).toBe('Est 4:17');
  });
});

describe('greekEstherLxx', () => {
  it('gives the Rahlfs verse with its sub-verse letter', () => {
    expect(rahlfs(greekEstherLxx(lettered('A', 1)))).toBe('1:1a');
    expect(rahlfs(greekEstherLxx(lettered('A', 17)))).toBe('1:1r');
    expect(rahlfs(greekEstherLxx(lettered('B', 7)))).toBe('3:13g');
    expect(rahlfs(greekEstherLxx(lettered('C', 1)))).toBe('4:17a');
    expect(
      ['C:12', 'C:14', 'C:16', 'C:23', 'C:25'].map((ref) => {
        const [letter, v] = ref.split(':') as ['C', string];
        return rahlfs(greekEstherLxx(lettered(letter, Number(v))));
      }),
    ).toEqual(['4:17k', '4:17k', '4:17m', '4:17r', '4:17t']);
    expect(rahlfs(greekEstherLxx(lettered('D', 1)))).toBe('5:1');
    expect(rahlfs(greekEstherLxx(lettered('D', 11)))).toBe('5:2');
    expect(rahlfs(greekEstherLxx(lettered('E', 24)))).toBe('8:12y');
    expect(rahlfs(greekEstherLxx(lettered('F', 11)))).toBe('10:3l');
    expect(greekEstherLxx(lettered('C', 12))).toEqual({ book: 'EST', c: 4, v: 17, part: 'k' });
  });

  it('covers every lettered verse, in Rahlfs order', () => {
    const order = (verse: LxxVerse): number => verse.c * 10_000 + verse.v * 100 + (verse.part ?? ' ').charCodeAt(0);
    for (const letter of GREEK_ESTHER_LETTERS) {
      let previous = 0;
      for (let v = 1; v <= LENGTHS[letter]; v++) {
        const position = order(greekEstherLxx(lettered(letter, v)));
        expect(position, `${letter}:${v}`).toBeGreaterThanOrEqual(previous);
        previous = position;
      }
    }
  });

  it('refuses verses outside the lettered chapters', () => {
    expect(code(() => greekEstherLxx(est(4, 17)))).toBe('UNKNOWN_VERSE');
    expect(code(() => greekEstherLxx(lettered('C', 31)))).toBe('UNKNOWN_VERSE');
    expect(code(() => greekEstherLxx({ book: 'PS', c: 103, v: 1 }))).toBe('UNKNOWN_VERSE');
    expect(() => greekEstherLxx(est(4, 17))).toThrow("EST 4:17 is not a verse of Esther's lettered chapters (A–F)");
  });

  it('reads only the single-verse ESG lines of eng.vrs', () => {
    const table = readRahlfsEsther(
      'ESG 4:29 = ESG 4:17k\nESG 5:11 = ESG 5:2\nESG 1:19-39 = ESG 1:2-22\nPSA 3:1 = PSA 3:2',
    );
    expect([...table]).toEqual([
      ['4:29', { book: 'EST', c: 4, v: 17, part: 'k' }],
      ['5:11', { book: 'EST', c: 5, v: 2 }],
    ]);
    expect(readRahlfsEsther(VRS_DATA.eng).size).toBeGreaterThan(100);
  });

  it('can be built over other tables, which it reads once', () => {
    const lxx = createGreekEstherLxx(versification, '');
    expect(lxx(lettered('C', 12))).toEqual({ book: 'EST', c: 4, v: 29 });
    expect(lxx(lettered('C', 13))).toEqual({ book: 'EST', c: 4, v: 30 });
  });

  it('is exported from the package entry point', () => {
    expect(refs.greekEstherLxx).toBe(greekEstherLxx);
    expect(refs.readRahlfsEsther).toBe(readRahlfsEsther);
    expect(refs.createGreekEstherLxx).toBe(createGreekEstherLxx);
  });
});

describe('acceptance criteria (L-049)', () => {
  it('parses, keys and maps Est C:12, 14-16, 23-25 to the Vulgate', () => {
    const ref = parseRef('Est C:12, 14-16, 23-25');
    expect(refs.toKey(ref)).toBe('EST.C.12_C.14-16_C.23-25');
    expect(isRealVerse(ref)).toBe(true);
    expect(formatRef(mapRef(ref, 'original', 'vulgate'))).toBe('Est 14:1, 3–5, 12–14');
  });
});
