import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import BaseLayout from '../../layouts/BaseLayout.astro';
import strings from '../../i18n/en/seo.json' with { type: 'json' };
import { formatTitle } from '../../lib/seo.ts';
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

describe('title template', () => {
  it('matches the title the base layout renders', async () => {
    for (const title of ['Calendar', strings.siteName]) {
      const html = await container.renderToString(BaseLayout, { props: { title } });
      expect(html).toContain(`<title>${formatTitle(title, strings.siteName, strings.titleTemplate)}</title>`);
    }
  });
});
