import { describe, expect, it } from 'vitest';

import { isFilenameSafe } from './fixtures/arbitraries.ts';
import { RefError, parseRef, toKey, tryParseRef } from './index.ts';
import type { RefErrorCode } from './index.ts';

/** Input → canonical key. Covers every format named in L-005 and the lectionary's usual variants. */
const VALID: readonly (readonly [string, string])[] = [
  ['Mt 20:1-16a', 'MT.20.1-16'],
  ['Matthew 20:1–16', 'MT.20.1-16'],
  ['Phil 1:20c-24, 27a', 'PHIL.1.20-24_1.27'],
  ['Ps 145:2-3, 8-9, 17-18', 'PS.145.2-3_145.8-9_145.17-18'],
  ['Eccl 11:9—12:8', 'ECCL.11.9-12.8'],
  ['Lk 9:43b-45', 'LK.9.43-45'],
  ['1 Cor 15:35-37, 42-49', '1COR.15.35-37_15.42-49'],
  ['Mt 20:1—16', 'MT.20.1-16'],
  ['Mt 20:1 - 16', 'MT.20.1-16'],
  ['Mt 20:1 – 16', 'MT.20.1-16'],
  ['Jb 19:23‑27a', 'JB.19.23-27'],
  ['Mt 20:1−16', 'MT.20.1-16'],
  ['Jn 3:16', 'JN.3.16'],
  ['Lk 2:41b', 'LK.2.41'],
  ['Ps 23', 'PS.23'],
  ['Is 40-41', 'IS.40-41'],
  ['Ps 23, 24', 'PS.23_24'],
  ['Gn 2:7-9; 3:1-7', 'GN.2.7-9_3.1-7'],
  ['Lk 2:16-21; 3', 'LK.2.16-21_3'],
  ['Mk 1:1-2:3', 'MK.1.1-2.3'],
  ['Phil 1:27-2:3, 5', 'PHIL.1.27-2.3_2.5'],
  ['Phil 1:20, 27-2:3', 'PHIL.1.20_1.27-2.3'],
  ['Is 52:13–53:12', 'IS.52.13-53.12'],
  ['Jude 17, 20b-25', 'JUDE.1.17_1.20-25'],
  ['Phlm 9-10, 12-17', 'PHLM.1.9-10_1.12-17'],
  ['2 Jn 4-9', '2JN.1.4-9'],
  ['3 Jn 5-8', '3JN.1.5-8'],
  ['Ob 1:15', 'OB.1.15'],
  ['Ps 89:4-5, 16-17, 27 and 29', 'PS.89.4-5_89.16-17_89.27_89.29'],
  ['Ps 96:1-2, 2-3, 11-12, 13', 'PS.96.1-2_96.2-3_96.11-12_96.13'],
  ['Psalm 23:1-3a, 3b-4, 5, 6', 'PS.23.1-3_23.3-4_23.5_23.6'],
  ['Pss 1:1', 'PS.1.1'],
  ['1Cor 1:3', '1COR.1.3'],
  ['I Cor 1:3', '1COR.1.3'],
  ['II Cor 5:17', '2COR.5.17'],
  ['First Corinthians 1:3', '1COR.1.3'],
  ['1 Corinthians 13:4-13', '1COR.13.4-13'],
  ['Matt. 5:1-12a', 'MT.5.1-12'],
  ['mt 5:1', 'MT.5.1'],
  ['Mt 5.1-12', 'MT.5.1-12'],
  ['Mt 20:1A-16', 'MT.20.1-16'],
  ['Acts 2:14a, 36-41', 'ACTS.2.14_2.36-41'],
  ['Acts of the Apostles 2:1-11', 'ACTS.2.1-11'],
  ['Rv 21:1-5a', 'RV.21.1-5'],
  ['Revelation 7:2-4, 9-14', 'RV.7.2-4_7.9-14'],
  ['Song of Songs 2:8-14', 'SG.2.8-14'],
  ['Sir 3:2-6, 12-14', 'SIR.3.2-6_3.12-14'],
  ['Dn 3:52, 53, 54', 'DN.3.52_3.53_3.54'],
  ['Ez 37:12-14', 'EZ.37.12-14'],
  ['Tb 8:4b-8', 'TB.8.4-8'],
  ['Prv 31:10-13, 19-20, 30-31', 'PRV.31.10-13_31.19-20_31.30-31'],
  ['Wis 1:13-15; 2:23-24', 'WIS.1.13-15_2.23-24'],
  ['1 Thes 4:13-18', '1THES.4.13-18'],
  ['  Lk 1:39-56  ', 'LK.1.39-56'],
  ['Ps 144:1b and 2abc, 3-4', 'PS.144.1_144.2_144.3-4'],
  ['Is 12:2-3, 4bcd, 5-6', 'IS.12.2-3_12.4_12.5-6'],
  ['1 Sm 2:1, 4-5, 6-7, 8abcd', '1SM.2.1_2.4-5_2.6-7_2.8'],
  ['Mt 5:3a-3b', 'MT.5.3'],
  ['Mt 20 : 1 - 16 , 18', 'MT.20.1-16_20.18'],
  ['1st Cor 1:1', '1COR.1.1'],
  ['2nd Kings 5:14', '2KGS.5.14'],
  ['3rd John 5', '3JN.1.5'],
  ['Est C:12, 14-16, 23-25', 'EST.C.12_C.14-16_C.23-25'],
  ['Esther F:1', 'EST.F.1'],
  ['Est. c:1-11', 'EST.C.1-11'],
  ['Est C', 'EST.C'],
  ['Est A-B', 'EST.A-B'],
  ['Est C:30–D:2', 'EST.C.30-D.2'],
  ['Est 4:17; C:1-2, 5', 'EST.4.17_C.1-2_C.5'],
  ['Est B:1; 3:14', 'EST.B.1_3.14'],
  ['Est 4:17c', 'EST.4.17'],
  ['Est 10:4', 'EST.10.4'],
];

const INVALID: readonly (readonly [string, RefErrorCode])[] = [
  ['', 'EMPTY'],
  ['   ', 'EMPTY'],
  ['20:1-16', 'UNKNOWN_BOOK'],
  ['Hezekiah 1:1', 'UNKNOWN_BOOK'],
  ['Mt abc', 'UNKNOWN_BOOK'],
  ['Mt', 'MISSING_PASSAGE'],
  ['Mt 20:', 'MALFORMED'],
  ['Mt 20:1-', 'MALFORMED'],
  ['Mt 20:1,,3', 'MALFORMED'],
  ['Mt 20:1,', 'MALFORMED'],
  ['Mt 20:1 (NABRE)', 'MALFORMED'],
  ['Mt 1000:1', 'MALFORMED'],
  ['Mt 5:1h', 'MALFORMED'],
  ['Mt 5:1abcdefga', 'MALFORMED'],
  ['Ps 2 3', 'MALFORMED'],
  ['Is 40 41', 'MALFORMED'],
  ['Mt 20:1 16', 'MALFORMED'],
  ['Mt 5:3b-3a', 'DESCENDING'],
  ['Mt C:12', 'UNKNOWN_BOOK'],
  ['Est G:1', 'UNKNOWN_BOOK'],
  ['Mt 1; C:12', 'MALFORMED'],
  ['Jude 3, a', 'MALFORMED'],
  ['Est 103:12', 'MALFORMED'],
  ['Est 4:17-C:2', 'MIXED_RANGE'],
  ['Est C:2-5:1', 'MIXED_RANGE'],
  ['Est C:1-B', 'MIXED_RANGE'],
  ['Est 1:16a-b', 'MIXED_RANGE'],
  ['Est D:1-C:30', 'DESCENDING'],
  ['Mt 0:1', 'ZERO'],
  ['Mt 20:0', 'ZERO'],
  ['Mt 20:16-1', 'DESCENDING'],
  ['Eccl 12:8-11:9', 'DESCENDING'],
  ['Is 41-40', 'DESCENDING'],
  ['Mt 5:1, 3-2:4', 'DESCENDING'],
  ['Jude 2:1', 'SINGLE_CHAPTER'],
  ['Jude 1:3-2:1', 'SINGLE_CHAPTER'],
  ['Ps 23a', 'PART_ON_CHAPTER'],
  ['Is 40-41:5', 'MIXED_RANGE'],
  ['Lk 4:16-30 or 4:16-21', 'ALTERNATIVES'],
];

describe('parseRef', () => {
  it('has at least 40 table-driven cases', () => {
    expect(VALID.length + INVALID.length).toBeGreaterThanOrEqual(40);
  });

  it.each(VALID)('parses %j to %s', (input, key) => {
    expect(toKey(parseRef(input))).toBe(key);
    expect(isFilenameSafe(key)).toBe(true);
  });

  it.each(INVALID)('rejects %j with %s', (input, code) => {
    const result = tryParseRef(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RefError);
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(10);
  });

  it('keeps runs of sub-verse letters', () => {
    expect(parseRef('Ps 144:1b and 2abc, 3-4').segments).toEqual([
      { start: { c: 144, v: 1, part: 'b' }, end: { c: 144, v: 1, part: 'b' } },
      { start: { c: 144, v: 2, part: 'abc' }, end: { c: 144, v: 2, part: 'abc' } },
      { start: { c: 144, v: 3 }, end: { c: 144, v: 4 } },
    ]);
  });

  it('keeps sub-verse letters and the chapter of every segment', () => {
    expect(parseRef('Phil 1:20c-24, 27a')).toEqual({
      book: 'PHIL',
      segments: [
        { start: { c: 1, v: 20, part: 'c' }, end: { c: 1, v: 24 } },
        { start: { c: 1, v: 27, part: 'a' }, end: { c: 1, v: 27, part: 'a' } },
      ],
    });
  });

  it('represents whole chapters without a verse', () => {
    expect(parseRef('Is 40-41')).toEqual({ book: 'IS', segments: [{ start: { c: 40 }, end: { c: 41 } }] });
  });

  it('reads cross-chapter ranges', () => {
    expect(parseRef('Eccl 11:9—12:8').segments).toEqual([{ start: { c: 11, v: 9 }, end: { c: 12, v: 8 } }]);
  });

  it('names the input and the problem in its messages', () => {
    expect(() => parseRef('Hezekiah 1:1')).toThrow('Unknown book "Hezekiah" (in "Hezekiah 1:1")');
    expect(() => parseRef('Mt 20:16-1')).toThrow('The range ends at 20:1, before its start at 20:16');
    expect(() => parseRef('')).toThrow('The reference is empty');
    expect(() => parseRef('Mt 5:3b-3a')).toThrow('The range ends at 5:3a, before its start at 5:3b');
    expect(() => parseRef('Ps 2 3')).toThrow('Unexpected space in "2 3"');
    expect(() => parseRef('Mt 1; c:12')).toThrow('"C" is not a chapter of Matthew; only Esther has lettered chapters');
    expect(() => parseRef('Est 103:12')).toThrow('Esther has no chapter 103; cite the Greek additions by letter');
    expect(() => parseRef('Est 4:17-C:2')).toThrow('A range cannot run from 4:17 to C:2');
    expect(() => parseRef('Est D:1-C:30')).toThrow('The range ends at C:30, before its start at D:1');
  });

  it('reads Greek Esther lettered chapters as chapters 101-106 (L-049)', () => {
    expect(parseRef('Est C:12, 14-16, 23-25')).toEqual({
      book: 'EST',
      segments: [
        { start: { c: 103, v: 12 }, end: { c: 103, v: 12 } },
        { start: { c: 103, v: 14 }, end: { c: 103, v: 16 } },
        { start: { c: 103, v: 23 }, end: { c: 103, v: 25 } },
      ],
    });
    expect(parseRef('Esther F').segments).toEqual([{ start: { c: 106 }, end: { c: 106 } }]);
    expect(parseRef('Est A:1b').segments).toEqual([
      { start: { c: 101, v: 1, part: 'b' }, end: { c: 101, v: 1, part: 'b' } },
    ]);
  });

  it('returns ok from tryParseRef on success', () => {
    expect(tryParseRef('Jn 3:16')).toEqual({ ok: true, value: parseRef('Jn 3:16') });
  });
});
