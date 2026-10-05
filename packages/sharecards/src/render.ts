/**
 * Card element → SVG (satori, text embedded as paths) → PNG (resvg, no system fonts).
 * Same input and fonts give byte-identical output.
 */
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { Font } from 'satori';

import type { ShareCard } from './cards.ts';
import { loadFonts } from './fonts.ts';
import { CARD_HEIGHT, CARD_WIDTH, cardTemplate } from './templates.ts';
import type { CardNode, TemplateOptions } from './templates.ts';

/** Size budget for a card PNG (WhatsApp and most crawlers stop at 300 KB). */
export const MAX_PNG_BYTES = 300 * 1024;

export interface RenderOptions extends TemplateOptions {
  /** Fonts to use instead of the bundled set (e.g. `loadFonts(dir)` when the package is bundled). */
  readonly fonts?: readonly Font[];
  /** Size budget in bytes; defaults to {@link MAX_PNG_BYTES}. */
  readonly maxBytes?: number;
}

/** Any element tree to SVG at the given size; exported for tests and one-off layouts. */
export async function renderNodeSvg(
  node: CardNode,
  width: number,
  height: number,
  fonts?: readonly Font[],
): Promise<string> {
  return satori(node, { width, height, fonts: [...(fonts ?? (await loadFonts()))] });
}

/** SVG to PNG at its intrinsic size, ignoring system fonts. */
export function svgToPng(svg: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng();
}

/** The card as an SVG string (1200×630). */
export function renderCardSvg(card: ShareCard, options: RenderOptions = {}): Promise<string> {
  return renderNodeSvg(cardTemplate(card, options), CARD_WIDTH, CARD_HEIGHT, options.fonts);
}

/** The card as a 1200×630 PNG; throws if it exceeds the size budget (default {@link MAX_PNG_BYTES}). */
export async function renderCard(card: ShareCard, options: RenderOptions = {}): Promise<Buffer> {
  const png = svgToPng(await renderCardSvg(card, options));
  const budget = options.maxBytes ?? MAX_PNG_BYTES;
  if (png.length > budget) {
    throw new Error(
      `${card.kind} card for ${card.url} is ${String(png.length)} bytes, over the ${String(budget)}-byte budget`,
    );
  }
  return png;
}
