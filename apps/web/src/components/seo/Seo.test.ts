import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import BaseLayout from '../../layouts/BaseLayout.astro';
import strings from '../../i18n/en/seo.json' with { type: 'json' };
import Seo from './Seo.astro';

let container: AstroContainer;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

beforeAll(async () => {
  container = await AstroContainer.create();
});

function render(props: Record<string, unknown>, request?: Request): Promise<string> {
  return container.renderToString(Seo, { props, ...(request === undefined ? {} : { request }) });
}

describe('Seo', () => {
  it('renders the canonical link and Open Graph tags for a page path under the base', async () => {
    const html = await render({ title: 'Calendar', description: 'Every day.', path: 'calendar/' });
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"]+${base}calendar/">`));
    expect(html).toContain('<meta property="og:title" content="Calendar · Lectio">');
    expect(html).toContain('<meta property="og:description" content="Every day.">');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:site_name" content="Lectio">');
    expect(html).toContain('<meta property="og:locale" content="en_GB">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('defaults to the brand card, the site description and the site name', async () => {
    const html = await render({ path: '' });
    expect(html).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+brand-card[^"]*\.png[^"]*">/);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain(`<meta property="og:image:alt" content="${strings.imageAlt}">`);
    expect(html).toContain(`<meta property="og:description" content="${strings.defaultDescription}">`);
    expect(html).toContain('<meta property="og:title" content="Lectio">');
  });

  it('takes the path from the request URL when none is given', async () => {
    const html = await render({ title: 'About' }, new Request(`https://lectio.example${base}about/`));
    expect(html).toMatch(new RegExp(`<meta property="og:url" content="https?://[^"]+${base}about/">`));
  });

  it('passes a page image, type, language, alternates and noindex through', async () => {
    const html = await render({
      title: 'Siku',
      path: 'sw/',
      lang: 'sw',
      type: 'article',
      image: { src: 'https://cdn.example/og.png', alt: 'Kadi' },
      alternates: [
        { hreflang: 'en', path: '' },
        { hreflang: 'sw', path: 'sw/' },
      ],
      noindex: true,
    });
    expect(html).toContain('<meta property="og:locale" content="sw_KE">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/og.png">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toMatch(new RegExp(`<link rel="alternate" hreflang="sw" href="https?://[^"]+${base}sw/">`));
  });
});

describe('page share images', () => {
  const dayImage = new RegExp(`<meta property="og:image" content="https?://[^"]+${base}og/2026-09-20\\.png">`);

  it('gives a day page its own card with size and alt text', async () => {
    const html = await render({ title: 'Sunday', path: '2026-09-20/' });
    expect(html).toMatch(dayImage);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toMatch(/<meta property="og:image:alt" content="Lectio card for Sunday 20 September 2026: [^"]+">/);
  });

  it('gives a reading page without approved notes its day card', async () => {
    expect(await render({ path: '2026-09-20/first-reading/' })).toMatch(dayImage);
  });

  it('keeps the brand card for a date without a calendar day, and an explicit image wins', async () => {
    expect(await render({ path: '1999-01-01/' })).toMatch(/og:image" content="[^"]+brand-card/);
    const html = await render({ path: '2026-09-20/', image: { src: 'https://cdn.example/x.png', alt: 'X' } });
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/x.png">');
  });
});

describe('locales (L-110)', () => {
  const href = (path: string) => `https?://[^"]+${base}${path}`;

  it('links every locale and x-default by default', async () => {
    const html = await render({ title: 'Calendar', path: 'calendar/' });
    expect(html).toMatch(new RegExp(`<link rel="alternate" hreflang="en" href="${href('calendar/')}">`));
    expect(html).toMatch(new RegExp(`<link rel="alternate" hreflang="sw" href="${href('sw/calendar/')}">`));
    expect(html).toMatch(new RegExp(`<link rel="alternate" hreflang="x-default" href="${href('calendar/')}">`));
  });

  it('puts the canonical URL in the page locale, whichever path the page passes', async () => {
    for (const path of ['settings/', 'sw/settings/']) {
      const html = await render({ title: 'Mipangilio', path, lang: 'sw' });
      expect(html).toMatch(new RegExp(`<link rel="canonical" href="${href('sw/settings/')}">`));
      expect(html).toMatch(new RegExp(`<meta property="og:url" content="${href('sw/settings/')}">`));
      expect(html).toContain('<meta property="og:locale" content="sw_KE">');
    }
  });

  it('gives noindex pages no alternates', async () => {
    const html = await render({ title: 'Search', path: 'search/', noindex: true });
    expect(html).not.toContain('hreflang');
  });

  it('gives a Kiswahili day page the same share card', async () => {
    const html = await render({ title: 'Jumapili', path: 'sw/2026-09-20/', lang: 'sw' });
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="${href('og/2026-09-20\\.png')}">`));
  });
});

describe('title', () => {
  it('matches the title the base layout renders', async () => {
    for (const title of ['Calendar', 'Lectio']) {
      const layout = await container.renderToString(BaseLayout, { props: { title } });
      const seo = await render({ title, path: '' });
      const documentTitle = /<title>([^<]*)<\/title>/.exec(layout)?.[1];
      expect(documentTitle).toBeDefined();
      expect(seo).toContain(`<meta property="og:title" content="${documentTitle}">`);
    }
  });
});
