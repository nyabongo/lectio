/**
 * Cache keys for rendered cards. A build that keeps card PNGs between runs (the site's `.cache/og`, L-088) looks
 * them up by {@link cardCacheKey}: the card's input, the template options, {@link TEMPLATE_VERSION} and a
 * fingerprint of the font bytes. Change a template or the renderer and bump `TEMPLATE_VERSION` (cache.test.ts fails
 * until you do); change a font file and the fingerprint changes on its own.
 */
import { createHash } from 'node:crypto';

import type { Font } from 'satori';

import type { ShareCard } from './cards.ts';
import { loadFonts } from './fonts.ts';
import type { TemplateOptions } from './templates.ts';

/**
 * Version of the card templates and renderer. Bump it whenever a change to `templates.ts`, `render.ts`, `text.ts`
 * or `fonts.ts` can change a card's pixels, so cached cards are rendered again.
 */
export const TEMPLATE_VERSION = 1;

/** JSON with object keys sorted at every level, so equal inputs hash equally whatever their key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)); // object keys are unique
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const fingerprints = new WeakMap<readonly Font[], string>();

/** SHA-256 over every font's name, weight, style and bytes, in order. Memoised per font array. */
export function fontsFingerprint(fonts: readonly Font[]): string {
  let fingerprint = fingerprints.get(fonts);
  if (fingerprint === undefined) {
    const hash = createHash('sha256');
    for (const font of fonts) {
      hash.update(`${font.name}\u0000${String(font.weight)}\u0000${String(font.style)}\u0000`);
      hash.update(new Uint8Array(font.data));
    }
    fingerprint = hash.digest('hex');
    fingerprints.set(fonts, fingerprint);
  }
  return fingerprint;
}

export interface CacheKeyOptions extends TemplateOptions {
  /** The fonts the card will be rendered with; defaults to the bundled set. */
  readonly fonts?: readonly Font[];
}

/**
 * A hex SHA-256 that changes whenever the rendered card could: a different card input or template option, a new
 * {@link TEMPLATE_VERSION}, or different font bytes.
 */
export async function cardCacheKey(card: ShareCard, options: CacheKeyOptions = {}): Promise<string> {
  const { fonts, ...template } = options;
  const input = canonicalJson({
    version: TEMPLATE_VERSION,
    fonts: fontsFingerprint(fonts ?? (await loadFonts())),
    template,
    card,
  });
  return createHash('sha256').update(input).digest('hex');
}
