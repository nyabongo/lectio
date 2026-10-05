import { describe, expect, it } from 'vitest';

import { BOOKS } from '../books.ts';
import type { BookCode } from '../books.ts';
import { enumerateVerses } from '../enumerate.ts';
import type { VerseId } from '../enumerate.ts';
import { formatRef } from '../format.ts';
import * as refs from '../index.ts';
import { parseRef } from '../parse.ts';
import {
  SCHEMES,
  chapterCount,
  chapterLength,
  fromSourceVerse,
  isRealVerse,
  mapRef,
  mapVerse,
  notInOriginal,
  toSourceVerse,
  verseCounts,
} from './index.ts';
import type { Scheme, VersificationError } from './index.ts';
import { SCHEME_DEFINITIONS, parseVrs, sourceKey } from './index.ts';
import { VRS_DATA } from './__generated__/vrs-data.ts';
import type { VrsName } from './embed.ts';

const v = (book: BookCode, c: number, verse: number): VerseId => ({ book, c, v: verse });
const at = (verse: VerseId): string => `${verse.book} ${verse.c}:${verse.v}`;
const map = (book: BookCode, c: number, verse: number, from: Scheme, to: Scheme): string =>
  at(mapVerse(v(book, c, verse), from, to));
const mapText = (text: string, from: Scheme, to: Scheme): string => formatRef(mapRef(parseRef(text), from, to));
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as VersificationError).code;
  }
  return undefined;
};

describe('acceptance criteria (L-006)', () => {
  it('knows which verses are real', () => {
    expect(isRealVerse('MT.20.16')).toBe(true);
    expect(isRealVerse('MT.20.35')).toBe(false);
  });

  it('maps Ps 145:2 to Vulgate Ps 144:2 and Mal 3:19 to 4:1', () => {
    expect(map('PS', 145, 2, 'original', 'vulgate')).toBe('PS 144:2');
    expect(map('PS', 144, 2, 'vulgate', 'original')).toBe('PS 145:2');
    expect(map('MAL', 3, 19, 'original', 'english')).toBe('MAL 4:1');
    expect(map('MAL', 4, 1, 'english', 'original')).toBe('MAL 3:19');
    expect(map('MAL', 4, 1, 'vulgate', 'original')).toBe('MAL 3:19');
  });

  it.each(SCHEMES)('has 73 books and 260 New Testament chapters in %s', (scheme) => {
    expect(BOOKS.filter((book) => chapterCount(book.code, scheme) > 0)).toHaveLength(73);
    const nt = BOOKS.filter((book) => book.testament === 'NT');
    expect(nt.reduce((sum, book) => sum + chapterCount(book.code, scheme), 0)).toBe(260);
  });

  it('is exported from the package entry point', () => {
    expect(refs.isRealVerse).toBe(isRealVerse);
    expect(refs.mapRef).toBe(mapRef);
    expect(refs.versification.chapterLength('PS', 119)).toBe(176);
  });
});

describe('verse counts', () => {
  it('follows NABRE ≈ original in the canonical scheme', () => {
    expect(chapterCount('PS')).toBe(150);
    expect(chapterLength('PS', 51)).toBe(21); // title counted as verses 1-2
    expect(chapterLength('JL', 3)).toBe(5);
    expect(chapterCount('JL')).toBe(4);
    expect(chapterCount('MAL')).toBe(3);
    expect(chapterLength('MAL', 3)).toBe(24);
    expect(chapterLength('1KGS', 5)).toBe(32);
    expect(chapterLength('HOS', 14)).toBe(10);
    expect(chapterLength('JON', 2)).toBe(11);
    expect(chapterCount('DN')).toBe(14);
    expect(chapterLength('DN', 3)).toBe(100);
    expect(chapterLength('DN', 13)).toBe(64);
    expect(chapterLength('DN', 14)).toBe(42);
    expect(chapterCount('BAR')).toBe(6);
    expect(chapterLength('BAR', 6)).toBe(72);
    expect(chapterCount('EST')).toBe(10);
    expect(chapterLength('ROM', 16)).toBe(27);
    expect(chapterLength('3JN', 1)).toBe(15);
    expect(chapterLength('MT', 20)).toBe(34);
    expect(chapterLength('MT', 29)).toBeUndefined();
  });

  it('differs per scheme', () => {
    expect(chapterLength('PS', 9, 'vulgate')).toBe(39);
    expect(chapterCount('JL', 'english')).toBe(3);
    expect(chapterLength('JL', 2, 'english')).toBe(32);
    expect(chapterCount('MAL', 'vulgate')).toBe(4);
    expect(chapterLength('PS', 51, 'english')).toBe(19);
    expect(chapterLength('DN', 3, 'lxx')).toBe(97);
    expect(chapterLength('DN', 13, 'vulgate')).toBe(65);
    expect(chapterCount('NEH', 'lxx')).toBe(13);
    expect(chapterLength('NEH', 7, 'lxx')).toBe(73);
    expect(chapterCount('EZR', 'lxx')).toBe(10);
    expect(chapterLength('BAR', 6, 'english')).toBe(73);
  });

  it('plugs into enumerateVerses', () => {
    const verses = enumerateVerses(parseRef('Ps 117'), verseCounts());
    expect(verses.map(at)).toEqual(['PS 117:1', 'PS 117:2']);
    expect(verseCounts('vulgate')('PS', 116)).toBe(2);
  });

  it('answers 0 chapters / undefined for unknown books', () => {
    expect(chapterCount('XX' as BookCode)).toBe(0);
    expect(chapterLength('XX' as BookCode, 1)).toBeUndefined();
  });
});

describe('isRealVerse', () => {
  it('accepts keys, refs and single verses', () => {
    expect(isRealVerse('PS.145.2-3_145.8-9_145.17-18')).toBe(true);
    expect(isRealVerse('PS.23')).toBe(true);
    expect(isRealVerse('PS.151')).toBe(false);
    expect(isRealVerse('PS.151', 'lxx')).toBe(true);
    expect(isRealVerse(parseRef('Phil 1:20c-24, 27a'))).toBe(true);
    expect(isRealVerse(parseRef('Mt 20:1-40'))).toBe(false);
    expect(isRealVerse(v('DN', 3, 52))).toBe(true);
    expect(isRealVerse(v('DN', 3, 52), 'english')).toBe(true);
    expect(isRealVerse(v('JL', 4, 1), 'english')).toBe(false);
    expect(isRealVerse(v('MAL', 4, 6), 'vulgate')).toBe(true);
  });

  it('treats malformed input as not real', () => {
    expect(isRealVerse('not a key')).toBe(false);
    expect(isRealVerse('MT.20.016')).toBe(false);
    expect(isRealVerse({ book: 'MT', segments: [] })).toBe(false);
    expect(isRealVerse(v('XX' as BookCode, 1, 1))).toBe(false);
    expect(isRealVerse(v('MT', 1.5, 1))).toBe(false);
    expect(isRealVerse(v('MT', 1, Number.NaN))).toBe(false);
    expect(isRealVerse(v('MT', 1, 0))).toBe(false);
  });

  it('honours verses a scheme skips', () => {
    expect(isRealVerse(v('GN', 31, 51), 'lxx')).toBe(false);
    expect(isRealVerse(v('GN', 31, 51))).toBe(true);
  });

  it('rejects an unknown scheme', () => {
    expect(code(() => isRealVerse('MT.1.1', 'nabre' as Scheme))).toBe('UNKNOWN_SCHEME');
    expect(code(() => verseCounts('nabre' as Scheme))).toBe('UNKNOWN_SCHEME');
    expect(code(() => mapVerse(v('MT', 1, 1), 'original', 'nabre' as Scheme))).toBe('UNKNOWN_SCHEME');
  });
});

describe('mapVerse', () => {
  it('shifts psalms 9-147 between Hebrew and Vulgate/LXX numbering', () => {
    expect(map('PS', 10, 1, 'original', 'vulgate')).toBe('PS 9:22');
    expect(map('PS', 23, 1, 'original', 'vulgate')).toBe('PS 22:1');
    expect(map('PS', 116, 10, 'original', 'vulgate')).toBe('PS 115:10');
    expect(map('PS', 147, 12, 'original', 'vulgate')).toBe('PS 147:12');
    expect(map('PS', 145, 2, 'original', 'lxx')).toBe('PS 144:2');
    expect(map('PS', 147, 12, 'original', 'lxx')).toBe('PS 147:1');
    expect(map('PS', 9, 22, 'vulgate', 'original')).toBe('PS 10:1');
    expect(map('PS', 1, 1, 'original', 'vulgate')).toBe('PS 1:1');
  });

  it('applies the psalm superscription offset of English Bibles', () => {
    expect(map('PS', 51, 3, 'original', 'english')).toBe('PS 51:1');
    expect(map('PS', 51, 1, 'english', 'original')).toBe('PS 51:3');
    expect(code(() => mapVerse(v('PS', 51, 1), 'original', 'english'))).toBe('NO_COUNTERPART');
    expect(code(() => mapVerse(v('PS', 3, 1), 'original', 'english'))).toBe('NO_COUNTERPART');
  });

  it('maps Joel 3-4, Malachi 3-4, Hosea, Jonah and 1 Kings', () => {
    expect(map('JL', 3, 1, 'original', 'english')).toBe('JL 2:28');
    expect(map('JL', 4, 21, 'original', 'vulgate')).toBe('JL 3:21');
    expect(map('JL', 2, 32, 'english', 'original')).toBe('JL 3:5');
    expect(map('MAL', 3, 24, 'original', 'vulgate')).toBe('MAL 4:6');
    expect(map('HOS', 14, 2, 'original', 'english')).toBe('HOS 14:1');
    expect(map('JON', 2, 1, 'original', 'english')).toBe('JON 1:17');
    expect(map('JON', 2, 1, 'original', 'vulgate')).toBe('JON 2:1');
    expect(map('1KGS', 5, 1, 'original', 'english')).toBe('1KGS 4:21');
    expect(map('1KGS', 5, 15, 'original', 'vulgate')).toBe('1KGS 5:1');
  });

  it('places the Daniel additions and flags them as not in the original', () => {
    expect(map('DN', 3, 52, 'original', 'vulgate')).toBe('DN 3:52');
    expect(map('DN', 3, 52, 'original', 'lxx')).toBe('DN 3:52');
    expect(map('DN', 3, 91, 'original', 'english')).toBe('DN 3:91');
    expect(map('DN', 3, 98, 'original', 'english')).toBe('DN 4:1');
    expect(map('DN', 4, 1, 'original', 'lxx')).toBe('DN 4:4');
    expect(map('DN', 4, 1, 'original', 'vulgate')).toBe('DN 4:1');
    expect(map('DN', 6, 1, 'original', 'english')).toBe('DN 5:31');
    expect(map('DN', 13, 1, 'original', 'english')).toBe('DN 13:1');
    expect(map('DN', 14, 1, 'original', 'vulgate')).toBe('DN 13:65');
    expect(map('DN', 14, 1, 'original', 'lxx')).toBe('DN 14:1');
    expect(notInOriginal(v('DN', 3, 24))).toBe(true);
    expect(notInOriginal(v('DN', 3, 90))).toBe(true);
    expect(notInOriginal(v('DN', 3, 91))).toBe(false);
    expect(notInOriginal(v('DN', 13, 1))).toBe(true);
    expect(notInOriginal(v('DN', 14, 42))).toBe(true);
    expect(notInOriginal(v('DN', 3, 52), 'lxx')).toBe(true);
    expect(notInOriginal(v('PS', 23, 1))).toBe(false);
  });

  it('keeps Romans 16:25-27 and 3 John 14-15 in every scheme', () => {
    for (const scheme of SCHEMES) {
      for (const verse of [v('ROM', 16, 25), v('ROM', 16, 27), v('3JN', 1, 14), v('3JN', 1, 15)]) {
        expect(at(mapVerse(verse, 'original', scheme))).toBe(at(verse));
        expect(at(mapVerse(verse, scheme, 'original'))).toBe(at(verse));
      }
    }
  });

  it('maps Baruch 6 and Nehemiah through the LXX book forms', () => {
    expect(map('BAR', 6, 1, 'original', 'lxx')).toBe('BAR 6:1');
    expect(map('BAR', 6, 72, 'english', 'vulgate')).toBe('BAR 6:72');
    expect(code(() => mapVerse(v('BAR', 6, 73), 'english', 'original'))).toBe('NO_COUNTERPART');
    expect(map('NEH', 3, 33, 'original', 'lxx')).toBe('NEH 3:33');
    expect(map('NEH', 4, 1, 'vulgate', 'lxx')).toBe('NEH 3:33');
  });

  it('returns a copy for the same scheme and goes between non-canonical schemes', () => {
    const verse = v('PS', 23, 1);
    expect(mapVerse(verse, 'vulgate', 'vulgate')).toEqual(verse);
    expect(map('PS', 51, 1, 'english', 'vulgate')).toBe('PS 50:3');
  });

  it('refuses verses that do not exist and Greek Esther', () => {
    expect(code(() => mapVerse(v('MT', 20, 35), 'original', 'vulgate'))).toBe('UNKNOWN_VERSE');
    expect(code(() => mapVerse(v('GN', 31, 51), 'original', 'lxx'))).toBe('NO_COUNTERPART');
    expect(code(() => mapVerse(v('EST', 4, 20), 'vulgate', 'original'))).toBe('UNSUPPORTED_GREEK_ESTHER');
    expect(code(() => mapVerse(v('EST', 14, 1), 'english', 'original'))).toBe('UNSUPPORTED_GREEK_ESTHER');
    expect(map('EST', 4, 17, 'original', 'lxx')).toBe('EST 4:17');
    expect(() => mapVerse(v('EST', 11, 2), 'original', 'vulgate')).toThrow(/Greek additions to Esther/);
  });
});

describe('mapRef', () => {
  it('maps lectionary psalm references segment by segment', () => {
    expect(mapText('Ps 145:2-3, 8-9, 17-18', 'original', 'vulgate')).toBe('Ps 144:2–3, 8–9, 17–18');
    expect(mapText('Ps 96:1-2, 2-3', 'original', 'vulgate')).toBe('Ps 95:1–2, 2–3');
    expect(mapText('Ps 51:3-6', 'original', 'english')).toBe('Ps 51:1–4');
    expect(mapText('Ps 51:1-6', 'original', 'english')).toBe('Ps 51:1–4');
  });

  it('keeps whole chapters whole and splits ranges that come apart', () => {
    expect(mapText('Ps 23', 'original', 'vulgate')).toBe('Ps 22');
    expect(mapText('Ps 9-10', 'original', 'vulgate')).toBe('Ps 9');
    expect(mapText('Ps 9', 'vulgate', 'original')).toBe('Ps 9–10');
    expect(mapText('Ps 114-115', 'original', 'vulgate')).toBe('Ps 113');
    expect(mapText('Ps 116', 'original', 'vulgate')).toBe('Ps 114; 115:10–19');
    expect(mapText('Ps 3', 'original', 'english')).toBe('Ps 3');
  });

  it('crosses chapter breaks', () => {
    expect(mapText('Jl 2:28-3:2', 'english', 'original')).toBe('Jl 3:1–4:2');
    expect(mapText('Mal 3:19-24', 'original', 'english')).toBe('Mal 4:1–6');
    expect(mapText('Dn 3:98-4:2', 'original', 'english')).toBe('Dn 4:1–5');
    // The LXX has no Jer 25:14 (its 25:14-19 is Hebrew 49:34-39) and puts 25:13 and 25:15 in chapter 32.
    expect(mapText('Jer 25:13-15', 'original', 'lxx')).toBe('Jer 32:13, 15');
    expect(mapText('Jer 49:34-35', 'original', 'lxx')).toBe('Jer 25:14–15');
  });

  it('drops verses with no counterpart and fails when none is left', () => {
    expect(mapText('Gn 31:50-52', 'original', 'lxx')).toBe('Gn 31:50, 52');
    expect(mapText('Gn 31:50-52', 'lxx', 'original')).toBe('Gn 31:50, 52');
    expect(code(() => mapRef(parseRef('Ps 3:1'), 'original', 'english'))).toBe('NO_COUNTERPART');
  });

  it('refuses references that do not exist in the source scheme', () => {
    expect(code(() => mapRef(parseRef('Mt 20:30-40'), 'original', 'vulgate'))).toBe('UNKNOWN_VERSE');
    expect(code(() => mapRef(parseRef('Ps 151'), 'original', 'vulgate'))).toBe('UNKNOWN_VERSE');
    expect(code(() => mapRef(parseRef('Est 4:30'), 'original', 'vulgate'))).toBe('UNSUPPORTED_GREEK_ESTHER');
    expect(() => mapRef(parseRef('Ps 151'), 'original', 'vulgate')).toThrow('PS 151 does not exist');
    expect(code(() => mapRef(parseRef('Ps 23'), 'original', 'nabre' as Scheme))).toBe('UNKNOWN_SCHEME');
  });
});

describe('source verses', () => {
  it('names the underlying .vrs verse', () => {
    expect(toSourceVerse(v('DN', 3, 91))).toEqual({ book: 'DAN', c: 3, v: 24 });
    expect(toSourceVerse(v('DN', 3, 52))).toEqual({ book: 'S3Y', c: 1, v: 29 });
    expect(toSourceVerse(v('BAR', 6, 1))).toEqual({ book: 'LJE', c: 1, v: 1 });
    expect(toSourceVerse(v('NEH', 1, 1), 'lxx')).toEqual({ book: 'EZR', c: 11, v: 1 });
    expect(toSourceVerse(v('PS', 23, 1))).toEqual({ book: 'PSA', c: 23, v: 1 });
    expect(code(() => toSourceVerse(v('PS', 151, 1)))).toBe('UNKNOWN_VERSE');
  });

  it('turns a .vrs verse back into a Lectio verse', () => {
    expect(fromSourceVerse({ book: 'SUS', c: 1, v: 5 })).toEqual(v('DN', 13, 5));
    expect(fromSourceVerse({ book: 'EZR', c: 11, v: 1 }, 'lxx')).toEqual(v('NEH', 1, 1));
    expect(fromSourceVerse({ book: 'DAG', c: 3, v: 1 })).toBeUndefined();
    expect(fromSourceVerse({ book: 'PSA', c: 3, v: 10 })).toBeUndefined();
  });
});

/** Scheme verses that a mapping line names explicitly (as opposed to passing through by number). */
const listed = (scheme: Exclude<Scheme, 'original'>): Set<string> => {
  const { file, supplement } = SCHEME_DEFINITIONS[scheme];
  const texts = [VRS_DATA[file as VrsName], supplement === undefined ? '' : VRS_DATA[supplement as VrsName]];
  return new Set(texts.flatMap((text) => parseVrs(text).mappings.map(({ from }) => sourceKey(from))));
};

/** Every verse of `scheme`, in order. */
function* verses(scheme: Scheme): Generator<VerseId> {
  for (const book of BOOKS) {
    for (let c = 1; c <= chapterCount(book.code, scheme); c++) {
      for (let n = 1; n <= (chapterLength(book.code, c, scheme) ?? 0); n++) {
        const verse = v(book.code, c, n);
        if (isRealVerse(verse, scheme)) yield verse;
      }
    }
  }
}

/**
 * A round trip may come back to a different verse only through a many-to-one
 * mapping line that names the scheme verse; a verse that passes through by
 * number must come back unchanged. This catches phantom verses such as
 * Vulgate Ps 115:1-9 (the Stuttgart numbering starts that psalm at verse 10).
 */
describe.each(['vulgate', 'lxx', 'english'] as const)('round trips through %s', (scheme) => {
  const names = listed(scheme);

  it('original → scheme → original', () => {
    let exact = 0;
    for (const verse of verses('original')) {
      let there: VerseId;
      try {
        there = mapVerse(verse, 'original', scheme);
      } catch (error) {
        expect((error as VersificationError).code).toMatch(/NO_COUNTERPART|UNSUPPORTED_GREEK_ESTHER/);
        continue;
      }
      expect(isRealVerse(there, scheme)).toBe(true);
      const back = mapVerse(there, scheme, 'original');
      if (at(back) === at(verse)) exact++;
      else expect(names.has(sourceKey(toSourceVerse(there, scheme))), `${at(verse)} → ${at(there)}`).toBe(true);
    }
    expect(exact).toBeGreaterThan(35_000);
  });

  it('scheme → original → scheme', () => {
    let exact = 0;
    for (const verse of verses(scheme)) {
      let canonical: VerseId;
      try {
        canonical = mapVerse(verse, scheme, 'original');
      } catch (error) {
        expect((error as VersificationError).code).toMatch(/NO_COUNTERPART|UNSUPPORTED_GREEK_ESTHER/);
        continue;
      }
      const back = mapVerse(canonical, 'original', scheme);
      if (at(back) === at(verse)) exact++;
      else expect(names.has(sourceKey(toSourceVerse(verse, scheme))), `${at(verse)} → ${at(canonical)}`).toBe(true);
    }
    expect(exact).toBeGreaterThan(35_000);
  });
});

describe('known losses', () => {
  it('rejects the Vulgate psalm verses that the Stuttgart numbering skips', () => {
    for (const verse of [v('PS', 115, 1), v('PS', 115, 9), v('PS', 147, 1), v('PS', 147, 11)]) {
      expect(isRealVerse(verse, 'vulgate')).toBe(false);
      expect(code(() => mapVerse(verse, 'vulgate', 'original'))).toBe('UNKNOWN_VERSE');
    }
    expect(chapterLength('PS', 115, 'vulgate')).toBe(19);
    expect(map('PS', 115, 10, 'vulgate', 'original')).toBe('PS 116:10');
    expect(map('PS', 147, 12, 'vulgate', 'original')).toBe('PS 147:12');
    expect(map('PS', 147, 1, 'original', 'vulgate')).toBe('PS 146:1');
    expect(map('PS', 115, 1, 'original', 'vulgate')).toBe('PS 113:9');
    expect(mapText('Ps 115-116', 'vulgate', 'original')).toBe('Ps 116:10–117:2');
    expect(mapText('Ps 115:10-19', 'vulgate', 'original')).toBe('Ps 116:10–19');
  });

  it('loses 70 Hebrew Exodus verses in the LXX, whose chapters 35-40 are shorter and reordered', () => {
    const lost = [...verses('original')].filter(
      (verse) => verse.book === 'EX' && code(() => mapVerse(verse, 'original', 'lxx')) === 'NO_COUNTERPART',
    );
    expect(lost).toHaveLength(70);
    expect(lost.map(at)).toContain('EX 25:6');
  });

  it('keeps the verse when converting within one scheme, even where a mapping merges verses', () => {
    expect(map('NM', 20, 29, 'vulgate', 'vulgate')).toBe('NM 20:29');
    expect(map('NM', 20, 29, 'vulgate', 'original')).toBe('NM 20:28');
    expect(mapText('Nm 20:28-29', 'vulgate', 'vulgate')).toBe('Nm 20:28–29');
  });
});
