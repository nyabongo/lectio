import { describe, expect, it } from 'vitest';

import { cardAltText } from './alt.ts';
import type { ShareCard } from './cards.ts';
import { dayFixture, hebrewInsightFixture, insightFixture, readingFixture } from './fixtures/cards.ts';
import * as api from './index.ts';
import { LIMITS } from './templates.ts';

describe('cardAltText', () => {
  it('day: date, celebration, subtitle and Gospel', () => {
    expect(cardAltText(dayFixture)).toBe(
      'Lectio card for Sunday 20 September 2026: Twenty-fifth Sunday in Ordinary Time. ' +
        'Year A, Ordinary Time, week 25. Gospel: Matthew 20:1–16.',
    );
    const { subtitle: _s, gospelRef: _g, ...bare } = dayFixture;
    expect(cardAltText(bare)).toBe('Lectio card for Sunday 20 September 2026: Twenty-fifth Sunday in Ordinary Time.');
  });

  it('reading: slot, reference and summary', () => {
    expect(cardAltText(readingFixture)).toBe(
      `Lectio card for Sunday 20 September 2026: Gospel, Matthew 20:1–16. ${readingFixture.summary}`,
    );
  });

  it('insight: quote, original phrase (transliterated when it can be) and caption', () => {
    expect(cardAltText(insightFixture)).toBe(
      'Lectio card for Sunday 20 September 2026: “Is your eye evil?”. Greek: ὁ ὀφθαλμός σου πονηρός ἐστιν. ' +
        'What the Greek of today’s Gospel really says — Matthew 20:15',
    );
    expect(cardAltText(hebrewInsightFixture)).toBe(
      `Lectio card for Sunday 20 September 2026: “An evil eye”. Hebrew: wə-rā‘â ‘ênəkā. ${hebrewInsightFixture.caption}`,
    );
  });

  it('insight: leaves the phrase out when the card does', () => {
    expect(cardAltText(insightFixture, { omitOriginal: true })).toBe(
      'Lectio card for Sunday 20 September 2026: “Is your eye evil?”. ' +
        'What the Greek of today’s Gospel really says — Matthew 20:15',
    );
  });

  it('truncates fields as the card does', () => {
    const long = 'word '.repeat(100);
    const alt = cardAltText({ ...readingFixture, summary: long });
    expect(alt.endsWith('…')).toBe(true);
    expect(alt.length).toBeLessThan(LIMITS.summary + 80);
  });

  it('rejects an unknown card kind', () => {
    expect(() => cardAltText({ kind: 'poster', date: '2026-09-20' } as unknown as ShareCard)).toThrow(
      /Unexpected value/,
    );
  });

  it('is exported from the package entry point', () => {
    expect(api.cardAltText).toBe(cardAltText);
  });
});
