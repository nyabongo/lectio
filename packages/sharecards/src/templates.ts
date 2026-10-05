/**
 * Card layouts as satori element trees (plain `{ type, props }` objects, no JSX/React).
 *
 * Every card is 1200×630: a liturgical-colour band on the left, a body, and a footer with the
 * wordmark and the permalink. Text goes through {@link truncate} with the per-field limits in
 * {@link LIMITS}, and each text box also clamps its lines, so no input can overflow the card.
 */
import type { LiturgicalColour } from '@lectio/schema/common';
import { assertNever } from '@lectio/shared';

import { cardDate, insightCaption } from './cards.ts';
import type { DayCard, InsightCard, OriginalPhrase, ReadingCard, ShareCard } from './cards.ts';
import { GREEK_STACK, HEBREW_STACK, SANS_STACK, SERIF_STACK } from './fonts.ts';
import { displayUrl, graphemes, hasHebrew, hebrewVisualWords, normalise, truncate } from './text.ts';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** Width of the liturgical-colour band on the left edge. */
const BAND_WIDTH = 24;

/** Maximum graphemes per field (the ellipsis included). */
export const LIMITS = {
  celebration: 64,
  subtitle: 60,
  gospelRef: 40,
  slotLabel: 24,
  ref: 30,
  summary: 180,
  quote: 110,
  original: 60,
  /** A Hebrew phrase longer than this is shown as its transliteration. */
  hebrew: 40,
  caption: 100,
  url: 56,
} as const;

/** How a Hebrew original phrase is drawn: right to left (default) or always as its transliteration. */
export type HebrewMode = 'visual' | 'transliteration';

export interface TemplateOptions {
  readonly hebrew?: HebrewMode;
  /**
   * Leave the original-language line off an insight card (the caption still names the language). The site build
   * uses it when the phrase cannot be drawn ({@link HebrewLayoutError}) rather than failing the build.
   */
  readonly omitOriginal?: boolean;
}

/** A Hebrew phrase that cannot be drawn right to left on a card and has no transliteration to fall back on. */
export class HebrewLayoutError extends Error {
  override readonly name = 'HebrewLayoutError';
  /** The phrase that could not be drawn. */
  readonly text: string;

  constructor(text: string) {
    super(`Hebrew phrase ${JSON.stringify(text)} cannot be drawn right to left here; give a transliteration`);
    this.text = text;
  }
}

type Style = Readonly<Record<string, string | number>>;
type Child = CardNode | string;

/** The element shape satori accepts in place of a React element. */
export interface CardNode {
  readonly type: string;
  readonly props: { readonly style: Style; readonly children?: Child | readonly Child[] };
}

/** A `div`; every container is flex, as satori requires for more than one child. */
export function el(style: Style, ...children: Child[]): CardNode {
  return {
    type: 'div',
    props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
  };
}

/** A block of text clamped to `lines` lines. */
function text(value: string, style: Style, lines = 1): CardNode {
  return { type: 'div', props: { style: { display: 'block', lineClamp: lines, ...style }, children: value } };
}

export const PALETTE = {
  paper: '#FBF8F1',
  ink: '#1E1A16',
  muted: '#6B6259',
  rule: '#E3DACB',
} as const;

/**
 * Band colour per liturgical colour. White is drawn as pale gold so it shows on the paper;
 * rose and gold are deepened enough to read as colours at band width.
 */
export const BAND_COLOURS: Readonly<Record<LiturgicalColour, string>> = {
  white: '#D9C68F',
  red: '#B3261E',
  green: '#2F6B3A',
  violet: '#5B3A7A',
  rose: '#D48AA3',
  black: '#26221F',
  gold: '#B8912F',
};

/** Deterministic font-size tiers: shorter text is set larger. */
function tier(value: string, steps: readonly (readonly [number, number])[], smallest: number): number {
  const length = graphemes(value).length;
  for (const [maxLength, size] of steps) if (length <= maxLength) return size;
  return smallest;
}

function eyebrow(value: string): CardNode {
  return text(value, { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 30, color: PALETTE.muted });
}

function frame(card: ShareCard, ...body: Child[]): CardNode {
  return el(
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: PALETTE.paper,
      color: PALETTE.ink,
      fontFamily: SANS_STACK,
    },
    el({ width: BAND_WIDTH, height: CARD_HEIGHT, backgroundColor: BAND_COLOURS[card.colour] }),
    el(
      {
        flexDirection: 'column',
        width: CARD_WIDTH - BAND_WIDTH,
        height: CARD_HEIGHT,
        padding: '60px 72px 44px 72px',
        overflow: 'hidden',
      },
      el({ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }, ...body),
      el(
        {
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `2px solid ${PALETTE.rule}`,
          paddingTop: 22,
        },
        text('Lectio', { fontFamily: SERIF_STACK, fontWeight: 600, fontSize: 38 }),
        text(truncate(displayUrl(card.url), LIMITS.url), { fontSize: 26, color: PALETTE.muted }),
      ),
    ),
  );
}

export function dayTemplate(card: DayCard): CardNode {
  const celebration = truncate(card.celebration, LIMITS.celebration);
  const body: Child[] = [
    eyebrow(cardDate(card)),
    text(
      celebration,
      {
        fontFamily: SERIF_STACK,
        fontWeight: 600,
        fontSize: tier(
          celebration,
          [
            [24, 92],
            [40, 76],
          ],
          64,
        ),
        lineHeight: 1.08,
        marginTop: 26,
      },
      2,
    ),
  ];
  if (card.subtitle !== undefined) {
    body.push(text(truncate(card.subtitle, LIMITS.subtitle), { fontSize: 32, color: PALETTE.muted, marginTop: 18 }));
  }
  if (card.gospelRef !== undefined) {
    body.push(
      el(
        { alignItems: 'center', marginTop: 'auto', paddingBottom: 28 },
        el({ width: 14, height: 14, borderRadius: 7, backgroundColor: BAND_COLOURS[card.colour], marginRight: 16 }),
        text(`${card.gospelLabel ?? 'Gospel'} · ${truncate(card.gospelRef, LIMITS.gospelRef)}`, {
          fontWeight: 600,
          fontSize: 36,
        }),
      ),
    );
  }
  return frame(card, ...body);
}

export function readingTemplate(card: ReadingCard): CardNode {
  return frame(
    card,
    eyebrow(`${truncate(card.slotLabel, LIMITS.slotLabel)} · ${cardDate(card)}`),
    text(truncate(card.ref, LIMITS.ref), {
      fontFamily: SERIF_STACK,
      fontWeight: 600,
      fontSize: 88,
      lineHeight: 1.1,
      marginTop: 22,
    }),
    text(truncate(card.summary, LIMITS.summary), { fontSize: 36, lineHeight: 1.32, marginTop: 22 }, 3),
  );
}

/** The original phrase: Greek/Latin as text, Hebrew right to left, or the transliteration as fallback. */
export function originalNode(original: OriginalPhrase, mode: HebrewMode = 'visual'): CardNode {
  const base: Style = { fontSize: 40, lineHeight: 1.3, marginTop: 26 };
  if (!hasHebrew(original.text)) {
    const family = original.language === 'grc' ? GREEK_STACK : SERIF_STACK;
    return text(truncate(original.text, LIMITS.original), { ...base, fontFamily: family, fontWeight: 500 });
  }
  const words = mode === 'visual' ? hebrewVisualWords(original.text) : null;
  if (words !== null && graphemes(normalise(original.text)).length <= LIMITS.hebrew) {
    // One flex item per word in visual order (see hebrewVisualWords).
    return el(
      { ...base, columnGap: 12, overflow: 'hidden', fontFamily: HEBREW_STACK, fontWeight: 500 },
      ...words.map((word) => el({}, word)),
    );
  }
  if (original.transliteration === undefined) {
    throw new HebrewLayoutError(original.text);
  }
  return text(truncate(original.transliteration, LIMITS.original), {
    ...base,
    fontFamily: SERIF_STACK,
    fontStyle: 'italic',
    fontWeight: 600,
  });
}

export function insightTemplate(card: InsightCard, options: TemplateOptions = {}): CardNode {
  // Leave room for the quotation marks inside the limit.
  const quote = `“${truncate(card.quote, LIMITS.quote - 2)}”`;
  return frame(
    card,
    eyebrow(cardDate(card)),
    text(
      quote,
      {
        fontFamily: SERIF_STACK,
        fontStyle: 'italic',
        fontWeight: 600,
        fontSize: tier(
          quote,
          [
            [36, 76],
            [70, 62],
          ],
          52,
        ),
        lineHeight: 1.12,
        marginTop: 20,
      },
      3,
    ),
    ...(options.omitOriginal === true ? [] : [originalNode(card.original, options.hebrew)]),
    text(
      truncate(card.caption ?? insightCaption(card), LIMITS.caption),
      { fontSize: 30, lineHeight: 1.3, color: PALETTE.muted, marginTop: 'auto', paddingBottom: 24 },
      2,
    ),
  );
}

/** The element tree for any card. */
export function cardTemplate(card: ShareCard, options: TemplateOptions = {}): CardNode {
  switch (card.kind) {
    case 'day':
      return dayTemplate(card);
    case 'reading':
      return readingTemplate(card);
    case 'insight':
      return insightTemplate(card, options);
    default:
      return assertNever(card);
  }
}
