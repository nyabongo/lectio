import { describe, expect, it } from 'vitest';

import { absoluteAssetUrl, absoluteUrl, formatTitle, ogLocale, seoTags, stripBase } from './seo.ts';
import type { HeadTag, SeoInput } from './seo.ts';

describe('absoluteUrl', () => {
  it.each([
    ['https://nyabongo.github.io/lectio/', '/lectio/', 'calendar/', 'https://nyabongo.github.io/lectio/calendar/'],
    ['https://nyabongo.github.io/lectio/', '/lectio/', '', 'https://nyabongo.github.io/lectio/'],
    ['https://nyabongo.github.io/lectio/', '/lectio', '/2026-09-20/', 'https://nyabongo.github.io/lectio/2026-09-20/'],
    ['https://nyabongo.github.io/', '/lectio/', 'about/', 'https://nyabongo.github.io/lectio/about/'],
    ['https://lectio.example/', '/', 'calendar/', 'https://lectio.example/calendar/'],
    ['https://lectio.example/', '', '', 'https://lectio.example/'],
    ['https://lectio.example/', '/', '//evil.example/x', 'https://lectio.example/evil.example/x'],
    [
      'https://lectio.example/',
      '/deep/path/',
      'sitemap-index.xml',
      'https://lectio.example/deep/path/sitemap-index.xml',
    ],
  ])('site %s, base %s, path %s is %s', (site, base, path, expected) => {
    expect(absoluteUrl(site, base, path)).toBe(expected);
  });

  it('accepts a URL object and defaults to the home page', () => {
    expect(absoluteUrl(new URL('https://lectio.example/lectio/'), '/lectio/')).toBe('https://lectio.example/lectio/');
  });
});

describe('absoluteAssetUrl', () => {
  it('resolves a base-prefixed asset path against the site origin', () => {
    expect(absoluteAssetUrl('https://nyabongo.github.io/lectio/', '/lectio/_astro/card.abc.png')).toBe(
      'https://nyabongo.github.io/lectio/_astro/card.abc.png',
    );
  });

  it('leaves an absolute URL unchanged', () => {
    expect(absoluteAssetUrl('https://lectio.example/', 'https://cdn.example/og.png')).toBe(
      'https://cdn.example/og.png',
    );
  });
});

describe('stripBase', () => {
  it.each([
    ['/lectio/', '/lectio/calendar/', 'calendar/'],
    ['/lectio/', '/lectio/', ''],
    ['/lectio/', '/lectio', ''],
    ['/lectio', '/lectio/2026-09-20/', '2026-09-20/'],
    ['/', '/calendar/', 'calendar/'],
    ['/', '/', ''],
    ['/lectio/', '/other/page/', 'other/page/'],
    ['/lectio/', '/lectiones/', 'lectiones/'],
  ])('base %s, pathname %s is %s', (base, pathname, expected) => {
    expect(stripBase(base, pathname)).toBe(expected);
  });
});

describe('formatTitle', () => {
  const template = '{title} · Lectio';

  it('applies the template', () => {
    expect(formatTitle('Calendar', 'Lectio', template)).toBe('Calendar · Lectio');
    expect(formatTitle('  Calendar ', 'Lectio', template)).toBe('Calendar · Lectio');
  });

  it('gives the site name for a missing, empty or site-name title', () => {
    expect(formatTitle(undefined, 'Lectio', template)).toBe('Lectio');
    expect(formatTitle('', 'Lectio', template)).toBe('Lectio');
    expect(formatTitle('Lectio', 'Lectio', template)).toBe('Lectio');
  });

  it('replaces every token', () => {
    expect(formatTitle('A', 'S', '{title} | {title}')).toBe('A | A');
  });
});

describe('ogLocale', () => {
  it.each([
    ['en', 'en_GB'],
    ['sw', 'sw_KE'],
    ['EN', 'en_GB'],
    ['pt-BR', 'pt_BR'],
    ['en_us', 'en_US'],
    ['fr', 'fr'],
  ])('%s is %s', (locale, expected) => {
    expect(ogLocale(locale)).toBe(expected);
  });
});

describe('seoTags', () => {
  const input: SeoInput = {
    title: 'Calendar',
    description: 'Every day of the liturgical year.',
    path: 'calendar/',
    site: 'https://nyabongo.github.io/lectio/',
    base: '/lectio/',
    locale: 'en',
    siteName: 'Lectio',
    titleTemplate: '{title} · Lectio',
    image: { src: '/lectio/_astro/brand-card.abc.png', width: 1200, height: 630, alt: 'Lectio' },
  };

  /** The tags as `name=content` lines, for readable assertions. */
  function lines(tags: HeadTag[]): string[] {
    return tags.map(
      ({ tag, attrs }) =>
        `${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
    );
  }

  it('builds the canonical link, Open Graph and Twitter tags with absolute URLs under the base path', () => {
    expect(lines(seoTags(input))).toEqual([
      'link rel=canonical href=https://nyabongo.github.io/lectio/calendar/',
      'meta property=og:type content=website',
      'meta property=og:site_name content=Lectio',
      'meta property=og:locale content=en_GB',
      'meta property=og:title content=Calendar · Lectio',
      'meta property=og:description content=Every day of the liturgical year.',
      'meta property=og:url content=https://nyabongo.github.io/lectio/calendar/',
      'meta property=og:image content=https://nyabongo.github.io/lectio/_astro/brand-card.abc.png',
      'meta property=og:image:width content=1200',
      'meta property=og:image:height content=630',
      'meta property=og:image:alt content=Lectio',
      'meta name=twitter:card content=summary_large_image',
    ]);
  });

  it('works at a domain root', () => {
    const tags = lines(seoTags({ ...input, site: 'https://lectio.example/', base: '/', path: '' }));
    expect(tags).toContain('link rel=canonical href=https://lectio.example/');
    expect(tags).toContain('meta property=og:url content=https://lectio.example/');
  });

  it('uses the article type and omits unknown image dimensions', () => {
    const tags = lines(seoTags({ ...input, type: 'article', image: { src: 'https://cdn.example/x.png', alt: 'x' } }));
    expect(tags).toContain('meta property=og:type content=article');
    expect(tags).toContain('meta property=og:image content=https://cdn.example/x.png');
    expect(tags.some((line) => line.includes('og:image:width') || line.includes('og:image:height'))).toBe(false);
  });

  it('marks a noindex page and drops its canonical link', () => {
    const tags = lines(seoTags({ ...input, noindex: true }));
    expect(tags[0]).toBe('meta name=robots content=noindex');
    expect(tags.some((line) => line.includes('canonical'))).toBe(false);
  });

  it('renders hreflang alternates only when there are at least two', () => {
    const one = lines(seoTags({ ...input, alternates: [{ hreflang: 'en', path: 'calendar/' }] }));
    expect(one.some((line) => line.includes('hreflang'))).toBe(false);

    const many = lines(
      seoTags({
        ...input,
        alternates: [
          { hreflang: 'en', path: 'calendar/' },
          { hreflang: 'sw', path: 'sw/calendar/' },
          { hreflang: 'x-default', path: 'calendar/' },
        ],
      }),
    );
    expect(many.slice(1, 4)).toEqual([
      'link rel=alternate hreflang=en href=https://nyabongo.github.io/lectio/calendar/',
      'link rel=alternate hreflang=sw href=https://nyabongo.github.io/lectio/sw/calendar/',
      'link rel=alternate hreflang=x-default href=https://nyabongo.github.io/lectio/calendar/',
    ]);
  });
});
