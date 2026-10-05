/**
 * WCAG 2.2 AA contrast audit of the colour CSS the site actually ships (L-064).
 *
 * `theme.ts` checks its palette objects. This module checks the other half of the promise: that the CSS
 * `themeCss()` renders resolves, through the cascade, to readable pairs in every situation a reader can be in:
 *
 * - the system scheme (light or dark) combined with the reader's theme choice (system, light or dark), and
 * - every liturgical colour on `<html data-colour>`, plus a page with no colour at all.
 *
 * For each situation `resolveTokens` evaluates the generated rules the way a browser would (media query, selector
 * match, specificity, then source order), and `auditContrast` measures each pair in `USAGE_PAIRS`, the token
 * combinations the stylesheets use: text needs 4.5:1, non-text UI (focus ring, accent rules and borders) 3:1.
 *
 * The parser handles the subset of CSS that `themeCss()` emits: flat `selector{prop:value;}` rules, optionally
 * inside `@media (prefers-color-scheme: …){…}`, with selectors made of `:root`, `[attr="value"]` and
 * `:not([attr="value"])`. Anything else is rejected rather than guessed at.
 */
import { LITURGICAL_COLOURS, MIN_TEXT_CONTRAST, MIN_UI_CONTRAST, SCHEMES, TOKEN, contrastRatio } from './theme.ts';
import type { LiturgicalColour, Scheme } from './theme.ts';

/** The reader's theme choice (`<html data-theme>`); `system` leaves the attribute off. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** One situation a page can render in. */
export interface Environment {
  /** What `prefers-color-scheme` reports. */
  readonly system: Scheme;
  /** The reader's theme choice. */
  readonly theme: ThemeChoice;
  /** `<html data-colour>`, or `null` for a page without one. */
  readonly colour: LiturgicalColour | null;
}

/** A condition on the root element's attributes: `[name="value"]`, or its negation `:not([name="value"])`. */
interface AttributeCondition {
  readonly name: string;
  readonly value: string;
  readonly negated: boolean;
}

/** A parsed `:root…` selector. */
interface RootSelector {
  readonly conditions: readonly AttributeCondition[];
  /** (pseudo-)class and attribute count; `:root` is one, each condition one more. */
  readonly specificity: number;
}

/** One parsed rule, in source order. */
export interface ThemeRule {
  /** `prefers-color-scheme` the rule needs, or `null` when it is not inside a media query. */
  readonly media: Scheme | null;
  readonly selectors: readonly RootSelector[];
  readonly declarations: Readonly<Record<string, string>>;
}

const MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/;
const CONDITION = /^(?::not\(\[([a-z-]+)="([^"]*)"\]\)|\[([a-z-]+)="([^"]*)"\])/;

function parseSelector(text: string): RootSelector {
  const selector = text.trim();
  if (!selector.startsWith(':root')) throw new SyntaxError(`Unsupported selector: ${JSON.stringify(selector)}`);
  const conditions: AttributeCondition[] = [];
  let rest = selector.slice(':root'.length);
  while (rest !== '') {
    const match = CONDITION.exec(rest);
    if (match === null) throw new SyntaxError(`Unsupported selector: ${JSON.stringify(selector)}`);
    const negated = match[1] !== undefined;
    conditions.push({
      name: (negated ? match[1] : match[3]) as string,
      value: (negated ? match[2] : match[4]) as string,
      negated,
    });
    rest = rest.slice(match[0].length);
  }
  return { conditions, specificity: 1 + conditions.length };
}

function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of body.split(';')) {
    if (part.trim() === '') continue;
    const colon = part.indexOf(':');
    if (colon < 1) throw new SyntaxError(`Malformed declaration: ${JSON.stringify(part.trim())}`);
    declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return declarations;
}

/** Parses the CSS `themeCss()` emits into rules, in source order. */
export function parseThemeCss(css: string): ThemeRule[] {
  const rules: ThemeRule[] = [];
  let media: Scheme | null = null;
  let position = 0;
  for (;;) {
    const open = css.indexOf('{', position);
    const close = css.indexOf('}', position);
    if (close !== -1 && (open === -1 || close < open)) {
      // The end of the media block we are in.
      if (media === null || css.slice(position, close).trim() !== '') {
        throw new SyntaxError(`Unexpected "}" at ${close}`);
      }
      media = null;
      position = close + 1;
      continue;
    }
    if (open === -1) {
      if (css.slice(position).trim() !== '' || media !== null) throw new SyntaxError('Unterminated CSS');
      return rules;
    }
    const prelude = css.slice(position, open).trim();
    if (prelude.startsWith('@')) {
      const match = MEDIA.exec(prelude);
      if (match === null || media !== null) throw new SyntaxError(`Unsupported at-rule: ${JSON.stringify(prelude)}`);
      media = match[1] as Scheme;
      position = open + 1;
      continue;
    }
    const end = css.indexOf('}', open);
    if (end === -1) throw new SyntaxError('Unterminated CSS');
    rules.push({
      media,
      selectors: prelude.split(',').map(parseSelector),
      declarations: parseDeclarations(css.slice(open + 1, end)),
    });
    position = end + 1;
  }
}

/** The attributes `<html>` carries in an environment. */
function rootAttributes(environment: Environment): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (environment.colour !== null) attributes['data-colour'] = environment.colour;
  if (environment.theme !== 'system') attributes['data-theme'] = environment.theme;
  return attributes;
}

function matches(selector: RootSelector, attributes: Readonly<Record<string, string>>): boolean {
  return selector.conditions.every(({ name, value, negated }) => (attributes[name] === value) !== negated);
}

/**
 * The value of every custom property and `color-scheme` on `<html>` in an environment: the declarations of the
 * matching rules applied by specificity, then source order, as the cascade does.
 */
export function resolveTokens(rules: readonly ThemeRule[], environment: Environment): Record<string, string> {
  const attributes = rootAttributes(environment);
  const winners = new Map<string, { specificity: number; order: number; value: string }>();
  rules.forEach((rule, order) => {
    if (rule.media !== null && rule.media !== environment.system) return;
    const specificity = Math.max(
      -1,
      ...rule.selectors.filter((selector) => matches(selector, attributes)).map((s) => s.specificity),
    );
    if (specificity < 0) return;
    for (const [property, value] of Object.entries(rule.declarations)) {
      const current = winners.get(property);
      if (current === undefined || specificity >= current.specificity) {
        winners.set(property, { specificity, order, value });
      }
    }
  });
  return Object.fromEntries([...winners].map(([property, { value }]) => [property, value]));
}

type TokenName = keyof typeof TOKEN;

/** A foreground token drawn on a background token, with the minimum contrast it needs and where it is used. */
export interface UsagePair {
  readonly fg: TokenName;
  readonly bg: TokenName;
  readonly min: number;
  readonly use: string;
}

const text = (fg: TokenName, bg: TokenName, use: string): UsagePair => ({ fg, bg, min: MIN_TEXT_CONTRAST, use });
const ui = (fg: TokenName, bg: TokenName, use: string): UsagePair => ({ fg, bg, min: MIN_UI_CONTRAST, use });

/**
 * Every token combination the stylesheets draw. Grounds: `bg` (page), `surface` (cards, header), `wash` (footer,
 * hovers, tab panels) and `accentWash` (tinted panels). `rule` is decorative and has no minimum.
 */
export const USAGE_PAIRS: readonly UsagePair[] = [
  ...(['bg', 'surface', 'wash', 'accentWash'] as const).flatMap((ground) => [
    text('ink', ground, 'body text'),
    text('muted', ground, 'dates, captions, metadata'),
    text('link', ground, 'links'),
    text('accentInk', ground, 'rank, eyebrows, accent labels'),
    ui('focus', ground, 'focus ring'),
  ]),
  ...(['bg', 'surface', 'wash'] as const).map((ground) =>
    ui('accent', ground, 'colour band, active tab and today markers, note highlight'),
  ),
  text('onAccent', 'accent', 'skip link, Listen button, filled controls'),
];

/** One measured pair in one environment. */
export interface ContrastResult {
  readonly environment: Environment;
  readonly pair: UsagePair;
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number;
  readonly ok: boolean;
}

/** Every environment: each system scheme × theme choice × colour (and no colour). */
export function environments(): Environment[] {
  const colours: (LiturgicalColour | null)[] = [null, ...LITURGICAL_COLOURS];
  return SCHEMES.flatMap((system) =>
    THEME_CHOICES.flatMap((theme) => colours.map((colour) => ({ system, theme, colour }))),
  );
}

/** The scheme an environment renders in: the reader's choice, or the system's when they chose `system`. */
export function effectiveScheme(environment: Environment): Scheme {
  return environment.theme === 'system' ? environment.system : environment.theme;
}

/**
 * Measures every pair of `USAGE_PAIRS` in every environment, resolving the tokens from `css` (the output of
 * `themeCss()`). A token that does not resolve is an error: the page would draw with an inherited colour.
 */
export function auditContrast(css: string, pairs: readonly UsagePair[] = USAGE_PAIRS): ContrastResult[] {
  const rules = parseThemeCss(css);
  return environments().flatMap((environment) => {
    const tokens = resolveTokens(rules, environment);
    const value = (name: TokenName): string => {
      const resolved = tokens[TOKEN[name]];
      if (resolved === undefined)
        throw new Error(`${TOKEN[name]} does not resolve in ${describeEnvironment(environment)}`);
      return resolved;
    };
    return pairs.map((pair) => {
      const fg = value(pair.fg);
      const bg = value(pair.bg);
      const ratio = contrastRatio(fg, bg);
      return { environment, pair, fg, bg, ratio, ok: ratio >= pair.min };
    });
  });
}

/** `system dark, theme light, colour red`: an environment for messages. */
export function describeEnvironment({ system, theme, colour }: Environment): string {
  return `system ${system}, theme ${theme}, colour ${colour ?? 'none'}`;
}

/** A one-line description of a result, for test failures and reports. */
export function describeResult(result: ContrastResult): string {
  const { pair, fg, bg, ratio } = result;
  return `${describeEnvironment(result.environment)}: ${pair.fg} ${fg} on ${pair.bg} ${bg} = ${ratio.toFixed(2)}:1 (needs ${pair.min}:1, ${pair.use})`;
}
