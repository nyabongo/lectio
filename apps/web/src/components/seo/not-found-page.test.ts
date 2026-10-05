import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import strings from '../../i18n/en/seo.json' with { type: 'json' };
import NotFound from '../../pages/404.astro';

let html: string;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(NotFound);
});

describe('404 page', () => {
  it('has its own title and heading from the seo catalog', () => {
    expect(html).toContain(`<title>${strings.notFoundTitle} · Lectio</title>`);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${strings.notFoundHeading}</h1>`));
  });

  it('is kept out of search results', () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
  });

  it('links home and to the calendar with base-aware absolute paths', () => {
    expect(html).toContain(`href="${base}"`);
    expect(html).toContain(`href="${base}calendar/"`);
  });
});
