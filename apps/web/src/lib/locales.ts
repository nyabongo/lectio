/**
 * Locale paths for the site (L-110): the hreflang alternates of a page and the language switcher's links.
 *
 * The default locale (`config.site.defaultLocale`) lives at the root (`/calendar/`); every other locale in
 * `config.site.locales` mirrors every page type under `/<locale>/` (`/sw/calendar/`); the routes are injected by
 * src/integrations/i18n.ts from src/lib/locale-routes.ts. Everything here is pure and browser-safe (the language
 * switcher's script imports it).
 *
 * Paths here are relative to the base path, like `withBase()` takes them (`calendar/`, `sw/calendar/`, `''`).
 */
import type { HreflangAlternate } from './seo.ts';

/**
 * Splits a base-relative path into its locale and the path of the same page in the default locale:
 * `sw/calendar/` is `{ locale: 'sw', path: 'calendar/' }`, `calendar/` is `{ locale: <default>, path: 'calendar/' }`.
 * Leading slashes are ignored, and a locale segment counts only when it is a whole segment (`sw`, `sw/…`).
 */
export function splitLocalePath(
  path: string,
  locales: readonly string[],
  defaultLocale: string,
): { locale: string; path: string } {
  const rest = path.replace(/^\/+/, '');
  const slash = rest.indexOf('/');
  const first = slash === -1 ? rest : rest.slice(0, slash);
  if (first !== defaultLocale && locales.includes(first))
    return { locale: first, path: slash === -1 ? '' : rest.slice(slash + 1) };
  return { locale: defaultLocale, path: rest };
}

/** `path` (a default-locale, base-relative path) in `locale`: the default locale at the root, others under it. */
export function pathInLocale(locale: string, path: string, defaultLocale: string): string {
  const rest = path.replace(/^\/+/, '');
  return locale === defaultLocale ? rest : `${locale}/${rest}`;
}

/**
 * The hreflang alternates of a page whose path (in any locale) is `path`: one per site locale, then `x-default`
 * for the default locale's page. Empty when the site has a single locale.
 */
export function localeAlternates(path: string, locales: readonly string[], defaultLocale: string): HreflangAlternate[] {
  if (locales.length < 2) return [];
  const neutral = splitLocalePath(path, locales, defaultLocale).path;
  return [
    ...locales.map((locale) => ({ hreflang: locale, path: pathInLocale(locale, neutral, defaultLocale) })),
    { hreflang: 'x-default', path: neutral },
  ];
}

/** One language switcher entry. */
export interface LocaleLink {
  readonly locale: string;
  /** Base-relative path of the current page in this locale. */
  readonly path: string;
  /** Whether this is the page's own locale. */
  readonly current: boolean;
}

/** The language switcher's entries for the page at `path`, in `config.site.locales` order. */
export function localeLinks(path: string, locales: readonly string[], defaultLocale: string): LocaleLink[] {
  const { locale: current, path: neutral } = splitLocalePath(path, locales, defaultLocale);
  return locales.map((locale) => ({
    locale,
    path: pathInLocale(locale, neutral, defaultLocale),
    current: locale === current,
  }));
}

/**
 * The `lang` attribute for a part of a page whose text is in `content` (WCAG 3.1.2): `content` when it differs from
 * the page locale, else `undefined` so the part inherits `<html lang>`. English notes on a Kiswahili page get `en`.
 */
export function partLang(content: string | null | undefined, page: string): string | undefined {
  return content === null || content === undefined || content === page ? undefined : content;
}
