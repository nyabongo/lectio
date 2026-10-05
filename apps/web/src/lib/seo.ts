/**
 * Search and social metadata for a page: absolute URLs under the base path, Open Graph and
 * Twitter tags, the canonical link and hreflang alternates. `src/components/seo/Seo.astro` renders the tags
 * `seoTags()` returns, so everything a crawler or a link preview sees is decided (and tested) here.
 *
 * Paths follow `withBase()`: a page path such as `calendar/` is relative to the site's base path, so the same page
 * code works at a domain root (`/`) and under a project path (`/lectio/`).
 */
import { normaliseBase, withBase } from './site.ts';

/**
 * The absolute URL of a site page: `absoluteUrl('https://example.org/lectio/', '/lectio/', 'calendar/')` is
 * `https://example.org/lectio/calendar/`. Only the origin of `site` is used, so it does not matter whether `site`
 * carries the base path too (`config.site.baseUrl` does).
 */
export function absoluteUrl(site: string | URL, base: string, path = ''): string {
  return new URL(withBase(base, path), site).href;
}

/**
 * The absolute URL of an asset whose `src` is already a URL path (an imported image's `src` includes the base path)
 * or a full URL (returned unchanged).
 */
export function absoluteAssetUrl(site: string | URL, src: string): string {
  return new URL(src, site).href;
}

/**
 * `pathname` (for example `Astro.url.pathname`, which includes the base path) as a path relative to `base`:
 * `stripBase('/lectio/', '/lectio/calendar/')` is `calendar/`. A pathname outside the base is returned without its
 * leading slashes, so `withBase()` puts it back under the base.
 */
export function stripBase(base: string, pathname: string): string {
  const prefix = normaliseBase(base);
  if (pathname === prefix.slice(0, -1)) return '';
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  return pathname.replace(/^\/+/, '');
}

/** Territories used for `og:locale` when a site locale is a bare language (British English, Kenyan Kiswahili). */
const OG_TERRITORIES: Readonly<Record<string, string>> = { en: 'GB', sw: 'KE' };

/**
 * A site locale as Open Graph wants it (`language_TERRITORY`): `en` is `en_GB`, `sw` is `sw_KE`, `pt-BR` is
 * `pt_BR`. Other bare languages are returned as they are.
 */
export function ogLocale(locale: string): string {
  const [language = '', territory] = locale.split(/[-_]/);
  const region = territory ?? OG_TERRITORIES[language.toLowerCase()];
  return region === undefined ? language.toLowerCase() : `${language.toLowerCase()}_${region.toUpperCase()}`;
}

/** The share image: a static brand card until L-088 renders one per page. */
export interface SeoImage {
  /** URL path (as an imported image's `src`) or absolute URL. */
  readonly src: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
}

/** One hreflang alternate: a locale and the path of the same page in it (relative to the base, like `path`). */
export interface HreflangAlternate {
  /** A site locale (`en`, `sw`) or `x-default`. */
  readonly hreflang: string;
  readonly path: string;
}

export interface SeoInput {
  /** The full document title (`Calendar · Lectio`), as the base layout's `<title>` has it. */
  readonly title: string;
  readonly description: string;
  /** The page path relative to the base path (`''` for the home page, `calendar/`). */
  readonly path: string;
  /** Absolute site URL (Astro's `site`, i.e. `config.site.baseUrl`). */
  readonly site: string | URL;
  /** Astro's `base` (`import.meta.env.BASE_URL`). */
  readonly base: string;
  /** The page's site locale (`en`). */
  readonly locale: string;
  readonly siteName: string;
  readonly image: SeoImage;
  /** `website` for the home page and listings, `article` for a reading or a note. */
  readonly type?: 'website' | 'article';
  /** The same page in other locales. Rendered only when there are at least two (L-110 supplies them). */
  readonly alternates?: readonly HreflangAlternate[];
  /** Keep the page out of search results (the 404 page): adds `robots: noindex` and drops the canonical link. */
  readonly noindex?: boolean;
}

/** A `<meta>` or `<link>` element for the document head. */
export interface HeadTag {
  readonly tag: 'meta' | 'link';
  readonly attrs: Readonly<Record<string, string>>;
}

const meta = (attrs: Record<string, string>): HeadTag => ({ tag: 'meta', attrs });
const link = (attrs: Record<string, string>): HeadTag => ({ tag: 'link', attrs });

/** The head tags for one page, in a stable order. */
export function seoTags(input: SeoInput): HeadTag[] {
  const { site, base, image, title } = input;
  const url = absoluteUrl(site, base, input.path);
  const tags: HeadTag[] = [];

  if (input.noindex === true) tags.push(meta({ name: 'robots', content: 'noindex' }));
  else tags.push(link({ rel: 'canonical', href: url }));

  const alternates = input.alternates ?? [];
  if (alternates.length > 1) {
    for (const alternate of alternates) {
      tags.push(
        link({ rel: 'alternate', hreflang: alternate.hreflang, href: absoluteUrl(site, base, alternate.path) }),
      );
    }
  }

  tags.push(
    meta({ property: 'og:type', content: input.type ?? 'website' }),
    meta({ property: 'og:site_name', content: input.siteName }),
    meta({ property: 'og:locale', content: ogLocale(input.locale) }),
    meta({ property: 'og:title', content: title }),
    meta({ property: 'og:description', content: input.description }),
    meta({ property: 'og:url', content: url }),
    meta({ property: 'og:image', content: absoluteAssetUrl(site, image.src) }),
  );
  if (image.width !== undefined) tags.push(meta({ property: 'og:image:width', content: String(image.width) }));
  if (image.height !== undefined) tags.push(meta({ property: 'og:image:height', content: String(image.height) }));
  tags.push(
    meta({ property: 'og:image:alt', content: image.alt }),
    meta({ name: 'twitter:card', content: 'summary_large_image' }),
  );
  return tags;
}
