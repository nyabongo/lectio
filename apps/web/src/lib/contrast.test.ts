import { describe, expect, it } from 'vitest';

import {
  THEME_CHOICES,
  USAGE_PAIRS,
  auditContrast,
  describeEnvironment,
  describeResult,
  effectiveScheme,
  environments,
  parseThemeCss,
  resolveTokens,
} from './contrast.ts';
import type { Environment } from './contrast.ts';
import {
  ACCENTS,
  BASE_PALETTE,
  DEFAULT_COLOUR,
  LITURGICAL_COLOURS,
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  TOKEN,
  themeCss,
} from './theme.ts';

const css = themeCss();
const rules = parseThemeCss(css);

describe('the shipped theme CSS', () => {
  it('reaches 4.5:1 for every text pair and 3:1 for every UI pair, for every accent token in light and dark', () => {
    const results = auditContrast(css);
    expect(results.filter((result) => !result.ok).map(describeResult)).toEqual([]);
    // Every pair, in every environment: 2 system schemes × 3 theme choices × (7 colours + none).
    expect(results).toHaveLength(USAGE_PAIRS.length * 2 * 3 * (LITURGICAL_COLOURS.length + 1));
  });

  it('covers every accent token as text and as UI on every ground', () => {
    const covered = new Set(USAGE_PAIRS.map((pair) => `${pair.fg}/${pair.bg}/${pair.min}`));
    for (const ground of ['bg', 'surface', 'wash', 'accentWash']) {
      expect(covered).toContain(`accentInk/${ground}/${MIN_TEXT_CONTRAST}`);
      expect(covered).toContain(`focus/${ground}/${MIN_UI_CONTRAST}`);
    }
    for (const ground of ['bg', 'surface', 'wash']) expect(covered).toContain(`accent/${ground}/${MIN_UI_CONTRAST}`);
    expect(covered).toContain(`onAccent/accent/${MIN_TEXT_CONTRAST}`);
  });

  it('resolves, through the cascade, to the palette of the scheme the reader sees and the colour of the day', () => {
    for (const environment of environments()) {
      const tokens = resolveTokens(rules, environment);
      const scheme = effectiveScheme(environment);
      const accent = ACCENTS[scheme][environment.colour ?? DEFAULT_COLOUR];
      const expected = { ...BASE_PALETTE[scheme], ...accent };
      const label = describeEnvironment(environment);
      expect(tokens['color-scheme'], label).toBe(scheme);
      for (const [name, property] of Object.entries(TOKEN)) {
        expect(tokens[property], `${label}: ${property}`).toBe(expected[name as keyof typeof expected]);
      }
    }
  });

  it('lists every environment once', () => {
    const all = environments();
    expect(all).toHaveLength(2 * THEME_CHOICES.length * (LITURGICAL_COLOURS.length + 1));
    expect(new Set(all.map(describeEnvironment)).size).toBe(all.length);
    expect(all).toContainEqual({ system: 'dark', theme: 'light', colour: null });
  });
});

describe('effectiveScheme', () => {
  it('follows the system unless the reader chose a theme', () => {
    expect(effectiveScheme({ system: 'dark', theme: 'system', colour: null })).toBe('dark');
    expect(effectiveScheme({ system: 'dark', theme: 'light', colour: null })).toBe('light');
    expect(effectiveScheme({ system: 'light', theme: 'dark', colour: 'red' })).toBe('dark');
  });
});

describe('resolveTokens', () => {
  const light: Environment = { system: 'light', theme: 'system', colour: null };

  it('applies the more specific rule, and the later one on a tie', () => {
    const parsed = parseThemeCss(
      ':root[data-colour="red"]{--a:#111111;}\n:root{--a:#222222;--b:#333333;}\n:root{--b:#444444;}',
    );
    expect(resolveTokens(parsed, { ...light, colour: 'red' })).toEqual({ '--a': '#111111', '--b': '#444444' });
    expect(resolveTokens(parsed, light)).toEqual({ '--a': '#222222', '--b': '#444444' });
  });

  it('honours media queries, negations and selector lists', () => {
    const parsed = parseThemeCss(
      '@media (prefers-color-scheme: dark){\n:root:not([data-theme="light"]){--a:#000000;}\n}\n' +
        ':root[data-theme="x"], :root[data-theme="dark"]{--b:#ffffff;}',
    );
    expect(resolveTokens(parsed, { system: 'dark', theme: 'system', colour: null })).toEqual({ '--a': '#000000' });
    expect(resolveTokens(parsed, { system: 'dark', theme: 'light', colour: null })).toEqual({});
    expect(resolveTokens(parsed, { system: 'light', theme: 'dark', colour: null })).toEqual({ '--b': '#ffffff' });
    expect(resolveTokens(parsed, light)).toEqual({});
  });
});

describe('parseThemeCss', () => {
  it('parses rules, declarations and media blocks in source order', () => {
    expect(
      parseThemeCss(' :root{ --a : #fff ; ; }@media (prefers-color-scheme: light){:root[data-x="y"]{b:c}} '),
    ).toEqual([
      { media: null, selectors: [{ conditions: [], specificity: 1 }], declarations: { '--a': '#fff' } },
      {
        media: 'light',
        selectors: [{ conditions: [{ name: 'data-x', value: 'y', negated: false }], specificity: 2 }],
        declarations: { b: 'c' },
      },
    ]);
    expect(parseThemeCss('')).toEqual([]);
  });

  it('rejects CSS outside the subset themeCss() emits', () => {
    expect(() => parseThemeCss('html{--a:#fff;}')).toThrow(/Unsupported selector: "html"/);
    expect(() => parseThemeCss(':root.dark{--a:#fff;}')).toThrow(/Unsupported selector/);
    expect(() => parseThemeCss(':root{--a #fff;}')).toThrow(/Malformed declaration: "--a #fff"/);
    expect(() => parseThemeCss('@media print{:root{--a:#fff;}}')).toThrow(/Unsupported at-rule/);
    expect(() =>
      parseThemeCss('@media (prefers-color-scheme: dark){@media (prefers-color-scheme: dark){:root{a:b}}}'),
    ).toThrow(/Unsupported at-rule/);
    expect(() => parseThemeCss(':root{--a:#fff;}}')).toThrow(/Unexpected "}"/);
    expect(() => parseThemeCss('@media (prefers-color-scheme: dark){:root{a:b} x }')).toThrow(/Unexpected "}"/);
    expect(() => parseThemeCss(':root{--a:#fff;')).toThrow(/Unterminated CSS/);
    expect(() => parseThemeCss('@media (prefers-color-scheme: dark){:root{a:b}')).toThrow(/Unterminated CSS/);
    expect(() => parseThemeCss(':root{a:b} :root')).toThrow(/Unterminated CSS/);
  });
});

describe('auditContrast', () => {
  it('reports pairs that fall short', () => {
    const weak = themeCss().replace('--colour-muted:#5e5368', '--colour-muted:#b0a8b8');
    const failures = auditContrast(weak).filter((result) => !result.ok);
    expect(failures.length).toBeGreaterThan(0);
    expect(
      failures.every((result) => result.pair.fg === 'muted' && effectiveScheme(result.environment) === 'light'),
    ).toBe(true);
    expect(describeResult(failures[0] as (typeof failures)[number])).toMatch(
      /^system light, theme system, colour none: muted #b0a8b8 on bg #f7f2e8 = \d\.\d\d:1 \(needs 4\.5:1, dates, captions, metadata\)$/,
    );
  });

  it('checks only the pairs it is given', () => {
    const results = auditContrast(css, [{ fg: 'ink', bg: 'bg', min: 7, use: 'AAA body text' }]);
    expect(results).toHaveLength(environments().length);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('fails loudly when a token does not resolve', () => {
    expect(() => auditContrast(':root{--colour-ink:#000000;}')).toThrow(
      /--colour-bg does not resolve in system light, theme system, colour none/,
    );
  });
});
