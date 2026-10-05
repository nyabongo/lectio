/**
 * @lectio/sharecards: build-time share cards (1200×630 PNG, ≤ 300 KB) for a day, a reading
 * and an insight, rendered with satori and resvg from bundled OFL fonts.
 *
 * ```ts
 * const png = await renderCard({ kind: 'day', date: '2026-09-20', colour: 'green', url, celebration });
 * ```
 */
export const packageName = '@lectio/sharecards';

export { cardAltText } from './alt.ts';
export type { AltTextLabels, AltTextOptions } from './alt.ts';
export { TEMPLATE_VERSION, canonicalJson, cardCacheKey, fontsFingerprint, rendererVersions } from './cache.ts';
export type { CacheKeyOptions, RendererVersions } from './cache.ts';
export { LANGUAGE_NAMES, cardDate, insightCaption } from './cards.ts';
export type {
  CardKind,
  DayCard,
  InsightCard,
  OriginalLanguage,
  OriginalPhrase,
  ReadingCard,
  ShareCard,
} from './cards.ts';
export { DEFAULT_FONTS_DIR, FONT_FILES, loadFonts } from './fonts.ts';
export type { FontFile } from './fonts.ts';
export { MAX_PNG_BYTES, renderCard, renderCardSvg } from './render.ts';
export type { RenderOptions } from './render.ts';
export { BAND_COLOURS, CARD_HEIGHT, CARD_WIDTH, HebrewLayoutError, LIMITS, cardTemplate } from './templates.ts';
export type { CardNode, HebrewMode, TemplateOptions } from './templates.ts';
export { displayUrl, formatLongDate, truncate } from './text.ts';
