import { describe, expect, it } from 'vitest';

import { RefError, formatRef, parseRef } from './index.ts';
import type { RefStyle } from './index.ts';

const cases: readonly (readonly [string, RefStyle, string])[] = [
  ['Mt 20:1-16', 'short', 'Mt 20:1–16'],
  ['Mt 20:1-16', 'long', 'Matthew 20:1–16'],
  ['Mt 20:1-16', 'spoken', 'Matthew chapter 20, verses 1 to 16'],
  ['Mt 20:1-16a', 'short', 'Mt 20:1–16a'],
  ['Phil 1:20c-24, 27a', 'short', 'Phil 1:20c–24, 27a'],
  ['Phil 1:20c-24, 27a', 'spoken', 'Philippians chapter 1, verses 20 to 24 and 27'],
  ['Ps 145:2-3, 8-9, 17-18', 'long', 'Psalm 145:2–3, 8–9, 17–18'],
  ['Ps 145:2-3, 8-9, 17-18', 'spoken', 'Psalm 145, verses 2 to 3, 8 to 9 and 17 to 18'],
  ['Eccl 11:9—12:8', 'short', 'Eccl 11:9–12:8'],
  ['Eccl 11:9—12:8', 'spoken', 'Ecclesiastes chapter 11, verse 9 to chapter 12, verse 8'],
  ['Gn 2:7-9; 3:1-7', 'short', 'Gn 2:7–9; 3:1–7'],
  ['Gn 2:7-9; 3:1-7', 'spoken', 'Genesis chapter 2, verses 7 to 9; chapter 3, verses 1 to 7'],
  ['Phil 1:27-2:3, 5', 'short', 'Phil 1:27–2:3, 5'],
  ['Jn 3:16', 'short', 'Jn 3:16'],
  ['Jn 3:16', 'spoken', 'John chapter 3, verse 16'],
  ['Ps 23', 'short', 'Ps 23'],
  ['Ps 23', 'spoken', 'Psalm 23'],
  ['Is 40-41', 'short', 'Is 40–41'],
  ['Is 40-41', 'spoken', 'Isaiah chapters 40 to 41'],
  ['Ps 23-24', 'spoken', 'Psalms 23 to 24'],
  ['Ps 23; 23:1', 'short', 'Ps 23; 23:1'],
  ['Ps 23; 23:1', 'spoken', 'Psalm 23; Psalm 23, verse 1'],
  ['Jude 17, 20b-25', 'short', 'Jude 17, 20b–25'],
  ['Jude 17, 20b-25', 'long', 'Jude 17, 20b–25'],
  ['Jude 17, 20b-25', 'spoken', 'Jude, verses 17 and 20 to 25'],
  ['Dn 3:52, 53, 54', 'spoken', 'Daniel chapter 3, verses 52, 53 and 54'],
  ['1 Cor 15:35-37', 'long', '1 Corinthians 15:35–37'],
  ['Ps 144:1b and 2abc, 3-4', 'short', 'Ps 144:1b, 2abc, 3–4'],
  ['Is 12:2-3, 4bcd, 5-6', 'spoken', 'Isaiah chapter 12, verses 2 to 3, 4 and 5 to 6'],
];

describe('formatRef', () => {
  it.each(cases)('formats %s in %s style as %s', (input, style, expected) => {
    expect(formatRef(parseRef(input), { style })).toBe(expected);
  });

  it('defaults to the short style', () => {
    expect(formatRef(parseRef('Matthew 20:1-16'))).toBe('Mt 20:1–16');
  });

  it('rejects malformed refs', () => {
    expect(() => formatRef({ book: 'MT', segments: [{ start: { c: 2, v: 1 }, end: { c: 1, v: 1 } }] })).toThrow(
      RefError,
    );
  });
});
