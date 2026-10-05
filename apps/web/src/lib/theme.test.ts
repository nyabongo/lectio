import { LITURGICAL_COLOURS as SCHEMA_COLOURS } from '@lectio/schema/common';
import { describe, expect, it } from 'vitest';

import {
  ACCENTS,
  BASE_PALETTE,
  DEFAULT_COLOUR,
  LITURGICAL_COLOURS,
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  SCHEMES,
  TOKEN,
  colourAttribute,
  contrastFailures,
  contrastPairs,
  contrastRatio,
  dayColour,
  isLiturgicalColour,
  parseHex,
  relativeLuminance,
  themeCss,
} from './theme.ts';
import type { ContrastPair } from './theme.ts';

describe('colour maths', () => {
  it('parses #rrggbb colours', () => {
    expect(parseHex('#231b2e')).toEqual([0x23, 0x1b, 0x2e]);
    expect(parseHex('#FFFDF8')).toEqual([255, 253, 248]);
  });

  it('rejects anything but #rrggbb', () => {
    for (const bad of ['#fff', '231b2e', '#12345g', 'red', '']) {
      expect(() => parseHex(bad)).toThrow(RangeError);
    }
  });

  it('computes WCAG relative luminance', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    // Low channel values use the linear segment of the sRGB curve.
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 10);
  });

  it('computes contrast ratios symmetrically, from 1 to 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#2f6b4f', '#2f6b4f')).toBe(1);
    // A published reference value: #767676 on white is the classic 4.54:1.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('palette', () => {
  it('covers every liturgical colour of the schema in both schemes', () => {
    expect(LITURGICAL_COLOURS).toEqual(SCHEMA_COLOURS);
    for (const scheme of SCHEMES) {
      expect(Object.keys(ACCENTS[scheme]).sort()).toEqual([...SCHEMA_COLOURS].sort());
    }
  });

  it('keeps the brand palette from the deck in light mode', () => {
    expect(BASE_PALETTE.light).toMatchObject({
      bg: '#f7f2e8',
      surface: '#fffdf8',
      wash: '#efe6d6',
      rule: '#ddd0b8',
      ink: '#231b2e',
    });
    expect(ACCENTS.light.green.accent).toBe('#2f6b4f');
    expect(BASE_PALETTE.dark.surface).toBe('#231b2e');
    expect(BASE_PALETTE.dark.ink).toBe('#f7f2e8');
  });

  it('is contrast-safe: every text pair reaches 4.5:1 and every UI pair 3:1, in light and dark', () => {
    const pairs = contrastPairs();
    const describePair = (p: ContrastPair) =>
      `${p.scheme}/${p.colour}: ${p.name} ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)} (< ${String(p.min)})`;
    expect(contrastFailures(pairs).map(describePair)).toEqual([]);
    // 2 schemes × (3 grounds × 4 base pairs + 7 colours × (5 on accentWash + 1 on accent + 3 grounds × 2)).
    expect(pairs).toHaveLength(2 * (3 * 4 + 7 * (6 + 3 * 2)));
    expect(pairs.some((p) => p.min === MIN_TEXT_CONTRAST)).toBe(true);
    expect(pairs.some((p) => p.min === MIN_UI_CONTRAST)).toBe(true);
  });

  it('reports pairs that fall short', () => {
    const weak: ContrastPair = {
      scheme: 'light',
      colour: 'white',
      name: 'test',
      fg: '#ffffff',
      bg: '#fffdf8',
      min: MIN_TEXT_CONTRAST,
      ratio: contrastRatio('#ffffff', '#fffdf8'),
    };
    expect(contrastFailures([weak])).toEqual([weak]);
  });
});

describe('day colour', () => {
  it('recognises liturgical colours', () => {
    expect(isLiturgicalColour('rose')).toBe(true);
    expect(isLiturgicalColour('teal')).toBe(false);
    expect(isLiturgicalColour(undefined)).toBe(false);
    expect(isLiturgicalColour(3)).toBe(false);
  });

  it('takes the principal celebration colour, with a default', () => {
    const celebration = (colour: (typeof SCHEMA_COLOURS)[number]) => ({
      id: 'x',
      name: 'X',
      rank: 'feast' as const,
      colour,
    });
    expect(dayColour({ celebrations: [celebration('red'), celebration('white')] })).toBe('red');
    expect(dayColour({ celebrations: [] })).toBe(DEFAULT_COLOUR);
    expect(dayColour(null)).toBe(DEFAULT_COLOUR);
    expect(dayColour(undefined)).toBe(DEFAULT_COLOUR);
  });

  it('turns any value into a safe data-colour attribute', () => {
    expect(colourAttribute('violet')).toBe('violet');
    expect(colourAttribute('purple')).toBe(DEFAULT_COLOUR);
    expect(colourAttribute(null)).toBe(DEFAULT_COLOUR);
    expect(colourAttribute(undefined)).toBe(DEFAULT_COLOUR);
  });
});

describe('themeCss', () => {
  const css = themeCss();

  it('declares every token for light mode on :root, defaulting the accent to green', () => {
    const rootRule = /^:root\{color-scheme:light;([^}]*)\}/m.exec(css);
    expect(rootRule).not.toBeNull();
    for (const [key, value] of Object.entries(BASE_PALETTE.light)) {
      expect(rootRule?.[1]).toContain(`${TOKEN[key as keyof typeof BASE_PALETTE.light]}:${value};`);
    }
    expect(css).toContain(`:root{${TOKEN.accent}:${ACCENTS.light[DEFAULT_COLOUR].accent};`);
  });

  it('swaps the accent for each data-colour in light and dark', () => {
    for (const colour of LITURGICAL_COLOURS) {
      expect(css).toContain(`:root[data-colour="${colour}"]{${TOKEN.accent}:${ACCENTS.light[colour].accent};`);
      expect(css).toContain(
        `:root[data-colour="${colour}"]:not([data-theme="light"]){${TOKEN.accent}:${ACCENTS.dark[colour].accent};`,
      );
      expect(css).toContain(
        `:root[data-colour="${colour}"][data-theme="dark"]{${TOKEN.accent}:${ACCENTS.dark[colour].accent};`,
      );
    }
  });

  it('follows the system dark scheme unless the page forces light, and honours a forced dark theme', () => {
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\{\n:root:not\(\[data-theme="light"\]\)\{color-scheme:dark;/,
    );
    expect(css).toContain(`:root[data-theme="dark"]{color-scheme:dark;${TOKEN.bg}:${BASE_PALETTE.dark.bg};`);
    expect(css.indexOf('@media')).toBeLessThan(css.indexOf(':root[data-theme="dark"]{'));
  });

  it('uses only declared token names and hex colours', () => {
    const declared = new Set<string>(Object.values(TOKEN));
    for (const [, name, value] of css.matchAll(/(--[a-z-]+):([^;]+);/g)) {
      expect(declared.has(name as string)).toBe(true);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
