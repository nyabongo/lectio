/**
 * Colour theming for the site: the base palette (light and dark), the liturgical accent for each colour of the
 * Roman Rite, the WCAG contrast maths that proves every pair is readable, and the CSS that ships them.
 *
 * The palette is the single source of truth: `themeCss()` renders it as CSS custom properties, and the unit tests
 * check every text/background pair it renders against WCAG AA. Type scale and spacing live in
 * `src/styles/tokens.css`; this module only owns colour.
 *
 * Pages set the day's colour with `data-colour="<colour>"` on `<html>` (see `colourAttribute`). The scheme follows
 * `prefers-color-scheme` unless `data-theme="light" | "dark"` overrides it (the settings page, L-054, sets it).
 */
import { LITURGICAL_COLOURS } from '@lectio/schema/common';
import type { LiturgicalColour } from '@lectio/schema/common';
import type { CalendarDay } from '@lectio/schema/calendar';

export { LITURGICAL_COLOURS };
export type { LiturgicalColour };

export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

/** The colour used when a page has no liturgical day (or before the calendar knows it). */
export const DEFAULT_COLOUR: LiturgicalColour = 'green';

/** WCAG 2.2 AA minimum contrast for body text. */
export const MIN_TEXT_CONTRAST = 4.5;
/** WCAG 2.2 AA minimum contrast for large text and non-text UI (borders, focus rings, icons). */
export const MIN_UI_CONTRAST = 3;

/** The neutral palette every page uses, whatever the day's colour. */
export interface BasePalette {
  /** Page background. */
  readonly bg: string;
  /** Raised surfaces: cards, the header. */
  readonly surface: string;
  /** Tinted panels and hover states. */
  readonly wash: string;
  /** Hairlines and dividers (decorative: no contrast requirement). */
  readonly rule: string;
  /** Body text. */
  readonly ink: string;
  /** Secondary text: dates, captions, metadata. */
  readonly muted: string;
  /** Links and controls that are not tinted by the day. */
  readonly link: string;
  /** Focus ring. */
  readonly focus: string;
}

/** The accent a liturgical colour gives the page. */
export interface Accent {
  /** Fills: buttons, the colour band, the active tab. */
  readonly accent: string;
  /** Text and icons drawn on an `accent` fill. */
  readonly onAccent: string;
  /** Accent-coloured text on `bg`, `surface` and `wash` (headings, links, labels). */
  readonly accentInk: string;
  /** A soft accent tint for backgrounds behind `ink`. */
  readonly accentWash: string;
}

/**
 * The brand palette from the product deck: aubergine ink, parchment page, warm surface, sand rules and wash, with
 * the deck's green and gold. Dark mode inverts it onto aubergine.
 */
export const BASE_PALETTE: Readonly<Record<Scheme, BasePalette>> = {
  light: {
    bg: '#f7f2e8',
    surface: '#fffdf8',
    wash: '#efe6d6',
    rule: '#ddd0b8',
    ink: '#231b2e',
    muted: '#5e5368',
    link: '#2f6b4f',
    focus: '#8a6421',
  },
  dark: {
    bg: '#1b1524',
    surface: '#231b2e',
    wash: '#2f253b',
    rule: '#463a52',
    ink: '#f7f2e8',
    muted: '#c7bcad',
    link: '#86c2a2',
    focus: '#d9ab55',
  },
};

/**
 * One accent per liturgical colour and scheme. White and gold share the deck's gold (white cannot tint a parchment
 * page); black keeps its solemn tone in light mode and becomes silver on the dark page.
 */
export const ACCENTS: Readonly<Record<Scheme, Readonly<Record<LiturgicalColour, Accent>>>> = {
  light: {
    green: { accent: '#2f6b4f', onAccent: '#fffdf8', accentInk: '#2f6b4f', accentWash: '#e3ede4' },
    violet: { accent: '#5c3a7e', onAccent: '#fffdf8', accentInk: '#5c3a7e', accentWash: '#ebe3f0' },
    white: { accent: '#94681c', onAccent: '#fffdf8', accentInk: '#7f5b1c', accentWash: '#f4ead2' },
    gold: { accent: '#94681c', onAccent: '#fffdf8', accentInk: '#7f5b1c', accentWash: '#f4ead2' },
    red: { accent: '#9c2a2a', onAccent: '#fffdf8', accentInk: '#9c2a2a', accentWash: '#f3e1dc' },
    rose: { accent: '#b0476e', onAccent: '#fffdf8', accentInk: '#9e3a60', accentWash: '#f6e2e8' },
    black: { accent: '#2b2730', onAccent: '#fffdf8', accentInk: '#2b2730', accentWash: '#e6e1e3' },
  },
  dark: {
    green: { accent: '#6fae8c', onAccent: '#1b1524', accentInk: '#86c2a2', accentWash: '#24352f' },
    violet: { accent: '#a888cc', onAccent: '#1b1524', accentInk: '#c2a8e0', accentWash: '#33284a' },
    white: { accent: '#d9ab55', onAccent: '#1b1524', accentInk: '#e3bd73', accentWash: '#3a3022' },
    gold: { accent: '#d9ab55', onAccent: '#1b1524', accentInk: '#e3bd73', accentWash: '#3a3022' },
    red: { accent: '#e07b70', onAccent: '#1b1524', accentInk: '#ec9a90', accentWash: '#43262b' },
    rose: { accent: '#e595b4', onAccent: '#1b1524', accentInk: '#eeafc7', accentWash: '#43283a' },
    black: { accent: '#b7afc2', onAccent: '#1b1524', accentInk: '#c9c2d3', accentWash: '#2f2a37' },
  },
};

const HEX = /^#([0-9a-f]{6})$/i;

/** `[r, g, b]` in 0–255 for a `#rrggbb` colour. */
export function parseHex(hex: string): readonly [number, number, number] {
  const match = HEX.exec(hex);
  if (match === null) throw new RangeError(`Not a #rrggbb colour: ${JSON.stringify(hex)}`);
  const value = Number.parseInt(match[1] as string, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour (0 for black, 1 for white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21 (order does not matter). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A text (or UI) colour drawn on a background, with the minimum contrast it must reach. */
export interface ContrastPair {
  readonly scheme: Scheme;
  /** `base` for the neutral palette, otherwise the liturgical colour. */
  readonly colour: LiturgicalColour | 'base';
  /** What the pair is, e.g. `accentInk on surface`. */
  readonly name: string;
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
  readonly ratio: number;
}

function pair(
  scheme: Scheme,
  colour: LiturgicalColour | 'base',
  name: string,
  fg: string,
  bg: string,
  min: number,
): ContrastPair {
  return { scheme, colour, name, fg, bg, min, ratio: contrastRatio(fg, bg) };
}

/** Every foreground/background pair the theme promises to keep readable. */
export function contrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (const scheme of SCHEMES) {
    const base = BASE_PALETTE[scheme];
    const grounds = { bg: base.bg, surface: base.surface, wash: base.wash } as const;
    for (const [groundName, ground] of Object.entries(grounds)) {
      pairs.push(pair(scheme, 'base', `ink on ${groundName}`, base.ink, ground, MIN_TEXT_CONTRAST));
      pairs.push(pair(scheme, 'base', `muted on ${groundName}`, base.muted, ground, MIN_TEXT_CONTRAST));
      pairs.push(pair(scheme, 'base', `link on ${groundName}`, base.link, ground, MIN_TEXT_CONTRAST));
      pairs.push(pair(scheme, 'base', `focus on ${groundName}`, base.focus, ground, MIN_UI_CONTRAST));
    }
    for (const colour of LITURGICAL_COLOURS) {
      const accent = ACCENTS[scheme][colour];
      pairs.push(pair(scheme, colour, 'onAccent on accent', accent.onAccent, accent.accent, MIN_TEXT_CONTRAST));
      pairs.push(pair(scheme, colour, 'ink on accentWash', base.ink, accent.accentWash, MIN_TEXT_CONTRAST));
      pairs.push(
        pair(scheme, colour, 'accentInk on accentWash', accent.accentInk, accent.accentWash, MIN_TEXT_CONTRAST),
      );
      for (const [groundName, ground] of Object.entries(grounds)) {
        pairs.push(pair(scheme, colour, `accentInk on ${groundName}`, accent.accentInk, ground, MIN_TEXT_CONTRAST));
        pairs.push(pair(scheme, colour, `accent on ${groundName}`, accent.accent, ground, MIN_UI_CONTRAST));
      }
    }
  }
  return pairs;
}

/** Pairs that fall short of their minimum; empty when the theme is contrast-safe. */
export function contrastFailures(pairs: readonly ContrastPair[] = contrastPairs()): ContrastPair[] {
  return pairs.filter((p) => p.ratio < p.min);
}

/** `true` when `value` is one of the liturgical colours. */
export function isLiturgicalColour(value: unknown): value is LiturgicalColour {
  return typeof value === 'string' && (LITURGICAL_COLOURS as readonly string[]).includes(value);
}

/**
 * The colour a calendar day is celebrated in: its first (principal) celebration's colour, or `DEFAULT_COLOUR`
 * when there is no day or it lists no celebration.
 */
export function dayColour(day: Pick<CalendarDay, 'celebrations'> | null | undefined): LiturgicalColour {
  return day?.celebrations[0]?.colour ?? DEFAULT_COLOUR;
}

/** The value for `<html data-colour>`: a known colour, or `DEFAULT_COLOUR` for anything else. */
export function colourAttribute(colour: string | null | undefined): LiturgicalColour {
  return isLiturgicalColour(colour) ? colour : DEFAULT_COLOUR;
}

/** CSS custom property names, so components never spell them by hand. */
export const TOKEN = {
  bg: '--colour-bg',
  surface: '--colour-surface',
  wash: '--colour-wash',
  rule: '--colour-rule',
  ink: '--colour-ink',
  muted: '--colour-muted',
  link: '--colour-link',
  focus: '--colour-focus',
  accent: '--colour-accent',
  onAccent: '--colour-on-accent',
  accentInk: '--colour-accent-ink',
  accentWash: '--colour-accent-wash',
} as const satisfies Record<keyof BasePalette | keyof Accent, `--${string}`>;

function declarations(values: Partial<Record<keyof typeof TOKEN, string>>): string {
  return Object.entries(values)
    .map(([key, value]) => `${TOKEN[key as keyof typeof TOKEN]}:${value as string};`)
    .join('');
}

function schemeRules(scheme: Scheme, scope: string): string {
  const rules = [`${scope}{color-scheme:${scheme};${declarations(BASE_PALETTE[scheme])}}`];
  rules.push(`${scope}{${declarations(ACCENTS[scheme][DEFAULT_COLOUR])}}`);
  for (const colour of LITURGICAL_COLOURS) {
    rules.push(`${scope.replace(':root', `:root[data-colour="${colour}"]`)}{${declarations(ACCENTS[scheme][colour])}}`);
  }
  return rules.join('\n');
}

/**
 * The colour tokens as CSS: light by default, dark under `prefers-color-scheme: dark` unless the page says
 * `data-theme="light"`, and dark whenever it says `data-theme="dark"`. Each `data-colour` swaps the accent tokens.
 */
export function themeCss(): string {
  return [
    schemeRules('light', ':root'),
    `@media (prefers-color-scheme: dark){\n${schemeRules('dark', ':root:not([data-theme="light"])')}\n}`,
    schemeRules('dark', ':root[data-theme="dark"]'),
  ].join('\n');
}
