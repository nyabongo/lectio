import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import strings from '../../i18n/en/search.json' with { type: 'json' };
import { parseSearchPageConfig } from '../../lib/search.ts';
import Search from './index.astro';

let html: string;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

function unescape(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(Search);
});

describe('Search page', () => {
  it('has its own title, canonical path, heading and intro', () => {
    expect(html).toContain(`<title>${strings.title} · Lectio</title>`);
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/search\/"/);
    expect(html).toMatch(/<h1[^>]*>Search<\/h1>/);
    expect(html).toContain(strings.intro);
  });

  it('embeds a base-aware Pagefind config with the UI strings', () => {
    const raw = /data-search="([^"]*)"/.exec(html)?.[1];
    const config = parseSearchPageConfig(raw === undefined ? undefined : unescape(raw));
    expect(config).toEqual({
      bundlePath: `${base}pagefind/`,
      baseUrl: base,
      translations: expect.objectContaining({
        placeholder: strings.ui.placeholder,
        zero_results: strings.ui.zeroResults,
        many_results: strings.ui.manyResults,
        filters_label: strings.ui.filtersLabel,
      }) as Record<string, string>,
    });
  });

  it('does not load Pagefind up front and says what to do without JavaScript', () => {
    expect(html).not.toContain('pagefind-ui.js');
    expect(html).toContain('<noscript>');
    expect(html).toContain(strings.noscript);
    expect(html).toContain(`href="${base}calendar/"`);
  });
});
