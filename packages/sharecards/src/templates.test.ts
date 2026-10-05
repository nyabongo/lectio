import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LANGUAGE_NAMES, insightCaption } from './cards.ts';
import type { ShareCard } from './cards.ts';
import { dayFixture, hebrewInsightFixture, insightFixture, readingFixture } from './fixtures/cards.ts';
import { DEFAULT_FONTS_DIR, FONT_FILES, GREEK_STACK, HEBREW_STACK, SERIF_STACK, loadFonts } from './fonts.ts';
import * as api from './index.ts';
import { BAND_COLOURS, HebrewLayoutError, LIMITS, cardTemplate, originalNode } from './templates.ts';
import type { CardNode } from './templates.ts';

/** Every string drawn by a node, depth first. */
function texts(node: CardNode | string): string[] {
  if (typeof node === 'string') return [node];
  const { children } = node.props;
  if (children === undefined) return [];
  return (Array.isArray(children) ? children : [children]).flatMap((child: CardNode | string) => texts(child));
}

describe('cardTemplate', () => {
  it('day: date, celebration, subtitle, Gospel and URL', () => {
    expect(texts(cardTemplate(dayFixture))).toEqual([
      'Sunday 20 September 2026',
      'Twenty-fifth Sunday in Ordinary Time',
      'Year A · Ordinary Time, week 25',
      'Gospel · Matthew 20:1–16',
      'Lectio',
      'lectio.example/2026-09-20',
    ]);
  });

  it('day: subtitle and Gospel are optional', () => {
    const { subtitle: _s, gospelRef: _g, ...bare } = dayFixture;
    expect(texts(cardTemplate(bare))).toEqual([
      'Sunday 20 September 2026',
      'Twenty-fifth Sunday in Ordinary Time',
      'Lectio',
      'lectio.example/2026-09-20',
    ]);
  });

  it('day: shorter celebrations are set larger', () => {
    const size = (celebration: string) =>
      JSON.stringify(cardTemplate({ ...dayFixture, celebration })).match(/"fontSize":(9\d|7\d|6\d)/)?.[1];
    expect(size('Christmas Day')).toBe('92');
    expect(size('Twenty-fifth Sunday in Ordinary Time')).toBe('76');
    expect(size('Saints Andrew Kim Tae-gon, Paul Chong Ha-sang and Companions')).toBe('64');
  });

  it('reading: eyebrow, reference and summary', () => {
    expect(texts(cardTemplate(readingFixture)).slice(0, 3)).toEqual([
      'Gospel · Sunday 20 September 2026',
      'Matthew 20:1–16',
      readingFixture.summary,
    ]);
  });

  it('insight: quote in quotation marks, original phrase and default caption', () => {
    expect(texts(cardTemplate(insightFixture)).slice(0, 4)).toEqual([
      'Sunday 20 September 2026',
      '“Is your eye evil?”',
      'ὁ ὀφθαλμός σου πονηρός ἐστιν',
      'What the Greek of today’s Gospel really says — Matthew 20:15',
    ]);
  });

  it('insight: the original-language line can be left off', () => {
    expect(texts(cardTemplate(insightFixture, { omitOriginal: true })).slice(0, 3)).toEqual([
      'Sunday 20 September 2026',
      '“Is your eye evil?”',
      'What the Greek of today’s Gospel really says — Matthew 20:15',
    ]);
  });

  it('insight: a caption override wins', () => {
    expect(texts(cardTemplate(hebrewInsightFixture))).toContain(hebrewInsightFixture.caption);
  });

  it('truncates every field to its limit', () => {
    const long = 'word '.repeat(100);
    const card: ShareCard = { ...readingFixture, ref: long, summary: long, slotLabel: long };
    const [eyebrow = '', ref = '', summary = ''] = texts(cardTemplate(card));
    expect(eyebrow.split(' · ')[0]?.length).toBeLessThanOrEqual(LIMITS.slotLabel);
    expect(ref.length).toBeLessThanOrEqual(LIMITS.ref);
    expect(summary.length).toBeLessThanOrEqual(LIMITS.summary);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('bands every liturgical colour', () => {
    for (const colour of Object.keys(BAND_COLOURS) as (keyof typeof BAND_COLOURS)[]) {
      expect(JSON.stringify(cardTemplate({ ...dayFixture, colour }))).toContain(BAND_COLOURS[colour]);
    }
  });

  it('rejects an unknown card kind', () => {
    expect(() => cardTemplate({ kind: 'poster' } as unknown as ShareCard)).toThrow(/Unexpected value/);
  });
});

describe('originalNode', () => {
  const family = (node: CardNode) => node.props.style['fontFamily'];

  it('sets Greek in the Greek face and Latin in the display serif', () => {
    expect(family(originalNode({ text: 'πονηρός', language: 'grc' }))).toBe(GREEK_STACK);
    expect(family(originalNode({ text: 'oculus tuus nequam', language: 'la' }))).toBe(SERIF_STACK);
  });

  it('lays a pure Hebrew phrase out word by word in visual order', () => {
    const node = originalNode(hebrewInsightFixture.original);
    expect(family(node)).toBe(HEBREW_STACK);
    expect(texts(node)).toEqual(['עֵינְךָ', 'וְרָעָה']);
  });

  it('falls back to the transliteration when asked, for mixed text, or when too long', () => {
    const transliteration = 'wə-rā‘â ‘ênəkā';
    const forced = originalNode({ ...hebrewInsightFixture.original }, 'transliteration');
    expect(texts(forced)).toEqual([transliteration]);
    expect(texts(originalNode({ text: 'רָעָה 15:9', language: 'hbo', transliteration }))).toEqual([transliteration]);
    const long = 'וְרָעָה עֵינְךָ '.repeat(5);
    expect(texts(originalNode({ text: long, language: 'hbo', transliteration }))).toEqual([transliteration]);
  });

  it('throws when a Hebrew phrase needs a transliteration it does not have', () => {
    expect(() => originalNode({ text: 'רָעָה 15:9', language: 'hbo' })).toThrow(/give a transliteration/);
    try {
      originalNode({ text: 'רָעָה 15:9', language: 'hbo' });
    } catch (error) {
      expect(error).toBeInstanceOf(HebrewLayoutError);
      expect(error).toMatchObject({ name: 'HebrewLayoutError', text: 'רָעָה 15:9' });
    }
    expect.assertions(3);
  });
});

describe('insightCaption', () => {
  it('names the language, slot and reference', () => {
    expect(
      insightCaption({ original: { text: 'רָעָה', language: 'hbo' }, slotLabel: 'First reading', ref: 'Deut 15:9' }),
    ).toBe('What the Hebrew of today’s First reading really says — Deut 15:9');
    expect(Object.keys(LANGUAGE_NAMES)).toEqual(['grc', 'hbo', 'arc', 'la']);
  });
});

describe('fonts', () => {
  it('bundles every listed file with an OFL licence for each family', () => {
    for (const { file } of FONT_FILES) expect(existsSync(join(DEFAULT_FONTS_DIR, file)), file).toBe(true);
    for (const licence of ['CormorantGaramond', 'SourceSans3', 'NotoSerif', 'NotoSerifHebrew']) {
      expect(readFileSync(join(DEFAULT_FONTS_DIR, `OFL-${licence}.txt`), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    }
  });

  it('loads each font once per directory', async () => {
    const fonts = await loadFonts();
    expect(fonts).toHaveLength(FONT_FILES.length);
    expect(loadFonts()).toBe(loadFonts(DEFAULT_FONTS_DIR));
  });

  it('does not cache a failed load', async () => {
    const missing = join(DEFAULT_FONTS_DIR, 'missing');
    const first = loadFonts(missing);
    await expect(first).rejects.toThrow(/ENOENT/);
    expect(loadFonts(missing)).not.toBe(first);
    await expect(loadFonts(missing)).rejects.toThrow(/ENOENT/);
  });
});

describe('package entry point', () => {
  it('exports the renderer API', () => {
    expect(api.packageName).toBe('@lectio/sharecards');
    expect([api.CARD_WIDTH, api.CARD_HEIGHT, api.MAX_PNG_BYTES]).toEqual([1200, 630, 307_200]);
    for (const fn of [api.renderCard, api.renderCardSvg, api.cardTemplate, api.loadFonts, api.truncate]) {
      expect(typeof fn).toBe('function');
    }
  });
});
