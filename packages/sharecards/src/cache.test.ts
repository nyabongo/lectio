import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TEMPLATE_VERSION, canonicalJson, cardCacheKey, fontsFingerprint, rendererVersions } from './cache.ts';
import { dayFixture, hebrewInsightFixture, insightFixture } from './fixtures/cards.ts';
import recorded from './fixtures/template-source.json' with { type: 'json' };
import { loadFonts } from './fonts.ts';
import * as api from './index.ts';

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined, x: null }], c: 'é' } })).toBe(
      '{"a":{"c":"é","d":[2,{"x":null,"z":1}]},"b":1}',
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('writes a bare undefined as null', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('fontsFingerprint', () => {
  it('is memoised per font array and changes with the font bytes', async () => {
    const fonts = await loadFonts();
    const first = fontsFingerprint(fonts);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fontsFingerprint(fonts)).toBe(first);
    expect(fontsFingerprint([...fonts])).toBe(first);
    const [head, ...rest] = fonts;
    if (head === undefined) throw new Error('no fonts');
    const changed = { ...head, data: Buffer.concat([Buffer.from(head.data as Buffer), Buffer.from([0])]) };
    expect(fontsFingerprint([changed, ...rest])).not.toBe(first);
  });
});

describe('cardCacheKey', () => {
  it('is stable for the same card, whatever the key order', async () => {
    const reordered = Object.fromEntries(Object.entries(dayFixture).reverse()) as typeof dayFixture;
    expect(await cardCacheKey(dayFixture)).toBe(await cardCacheKey(reordered));
    expect(await cardCacheKey(dayFixture)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the card, the template options and the fonts', async () => {
    const base = await cardCacheKey(hebrewInsightFixture);
    expect(await cardCacheKey({ ...hebrewInsightFixture, quote: 'Another' })).not.toBe(base);
    expect(await cardCacheKey(hebrewInsightFixture, { hebrew: 'transliteration' })).not.toBe(base);
    expect(await cardCacheKey(hebrewInsightFixture, { omitOriginal: true })).not.toBe(base);
    const fonts = await loadFonts();
    expect(await cardCacheKey(hebrewInsightFixture, { fonts })).toBe(base);
    expect(await cardCacheKey(hebrewInsightFixture, { fonts: fonts.slice(1) })).not.toBe(base);
    expect(await cardCacheKey(insightFixture)).not.toBe(base);
  });

  it('changes with the satori and resvg versions', async () => {
    const installed = rendererVersions();
    expect(installed.satori).toMatch(/^\d+\.\d+\.\d+/);
    expect(installed.resvg).toMatch(/^\d+\.\d+\.\d+/);
    const base = await cardCacheKey(dayFixture);
    expect(await cardCacheKey(dayFixture, { renderer: installed })).toBe(base);
    expect(await cardCacheKey(dayFixture, { renderer: { ...installed, satori: '99.0.0' } })).not.toBe(base);
    expect(await cardCacheKey(dayFixture, { renderer: { ...installed, resvg: '99.0.0' } })).not.toBe(base);
  });

  it('is exported from the package entry point', () => {
    expect(api.TEMPLATE_VERSION).toBe(TEMPLATE_VERSION);
    expect(api.cardCacheKey).toBe(cardCacheKey);
  });
});

describe('TEMPLATE_VERSION', () => {
  /** The sources that decide a card's pixels; editing any of them may need a new TEMPLATE_VERSION. */
  const SOURCES = ['templates.ts', 'render.ts', 'text.ts', 'fonts.ts', 'cards.ts'];

  it('is bumped whenever the template sources change', () => {
    const hash = createHash('sha256');
    for (const file of SOURCES) {
      hash.update(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
    }
    const current = { version: TEMPLATE_VERSION, sources: hash.digest('hex') };
    expect(
      current,
      'A card source changed: if the change can alter a rendered card, bump TEMPLATE_VERSION in cache.ts so cached ' +
        `cards are rendered again; then record ${JSON.stringify(current)} in src/fixtures/template-source.json.`,
    ).toEqual(recorded);
  });
});
