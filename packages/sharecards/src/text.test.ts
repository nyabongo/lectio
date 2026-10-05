import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { displayUrl, formatLongDate, graphemes, hasHebrew, hebrewVisualWords, normalise, truncate } from './text.ts';

describe('normalise', () => {
  it('composes to NFC and collapses whitespace', () => {
    expect(normalise('  ὀφθαλμός\n\t σου ')).toBe('ὀφθαλμός σου');
    expect(normalise(`e${String.fromCodePoint(0x301)}`)).toBe('é');
  });
});

describe('graphemes', () => {
  it('keeps a Hebrew letter and its points together', () => {
    expect(graphemes('רָעָה')).toHaveLength(3);
  });
});

describe('truncate', () => {
  it('returns short text unchanged (normalised)', () => {
    expect(truncate(' Matthew  20:1–16 ', 40)).toBe('Matthew 20:1–16');
  });

  it('cuts at a word boundary and appends an ellipsis', () => {
    expect(truncate('The parable turns on what good means', 20)).toBe('The parable turns…');
  });

  it('strips trailing punctuation before the ellipsis', () => {
    expect(truncate('Labourers hired, at dawn and noon', 18)).toBe('Labourers hired…');
  });

  it('hard-cuts when the last space would waste too much of the budget', () => {
    expect(truncate('A extraordinarilylongword', 10)).toBe('A extraor…');
  });

  it('counts graphemes, not code units', () => {
    expect(truncate('ὀφθαλμός σου πονηρός', 10)).toBe('ὀφθαλμός…');
  });

  it('rejects a budget below 2', () => {
    expect(() => truncate('abc', 1)).toThrow(RangeError);
    expect(() => truncate('abc', 2.5)).toThrow(RangeError);
  });

  it('never exceeds the budget', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.integer({ min: 2, max: 120 }), (value, max) => {
        expect(graphemes(truncate(value, max)).length).toBeLessThanOrEqual(max);
      }),
    );
  });
});

describe('formatLongDate', () => {
  it('formats as weekday, day, month, year', () => {
    expect(formatLongDate('2026-09-20')).toBe('Sunday 20 September 2026');
    expect(formatLongDate('2024-02-29')).toBe('Thursday 29 February 2024');
    expect(formatLongDate('2027-01-01')).toBe('Friday 1 January 2027');
  });

  it('rejects an impossible date', () => {
    expect(() => formatLongDate('2026-02-30')).toThrow(/Not an ISO date/);
  });
});

describe('displayUrl', () => {
  it('drops the scheme, query and trailing slash', () => {
    expect(displayUrl('https://lectio.example/2026-09-20/gospel/?utm=x#a')).toBe('lectio.example/2026-09-20/gospel');
    expect(displayUrl('https://lectio.example/')).toBe('lectio.example');
  });

  it('rejects a relative URL', () => {
    expect(() => displayUrl('/2026-09-20')).toThrow(/Not an absolute URL/);
  });
});

describe('Hebrew', () => {
  it('detects Hebrew letters', () => {
    expect(hasHebrew('רָעָה')).toBe(true);
    expect(hasHebrew('ὀφθαλμός')).toBe(false);
  });

  it('returns the words of a pure Hebrew phrase in visual order', () => {
    expect(hebrewVisualWords('וְרָעָה  עֵינְךָ')).toEqual(['עֵינְךָ', 'וְרָעָה']);
    expect(hebrewVisualWords('כָּל־הָאָרֶץ׃')).toEqual(['כָּל־הָאָרֶץ׃']);
  });

  it('returns null for mixed or non-Hebrew text', () => {
    expect(hebrewVisualWords('רָעָה (Deut 15:9)')).toBeNull();
    expect(hebrewVisualWords('רָעָה 9')).toBeNull();
    expect(hebrewVisualWords('evil eye')).toBeNull();
  });
});
