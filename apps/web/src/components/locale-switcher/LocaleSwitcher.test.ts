import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import LocaleSwitcher from './LocaleSwitcher.astro';

let container: AstroContainer;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

beforeAll(async () => {
  container = await AstroContainer.create();
});

function render(lang: string, path: string): Promise<string> {
  return container.renderToString(LocaleSwitcher, {
    props: { lang },
    request: new Request(`https://example.org${base}${path}`),
  });
}

describe('LocaleSwitcher', () => {
  it('links an English page to the same page in Kiswahili, named in Kiswahili', async () => {
    const html = await render('en', 'calendar/2026/09/');
    expect(html).toMatch(
      new RegExp(`<a href="${base}sw/calendar/2026/09/" hreflang="sw" lang="sw" data-locale="sw"[^>]*>\\s*Kiswahili`),
    );
    expect(html).toContain('Language:');
    expect(html).not.toContain('data-homes');
  });

  it('links a Kiswahili page back to English', async () => {
    const html = await render('sw', 'sw/2026-09-20/gospel/');
    expect(html).toMatch(new RegExp(`<a href="${base}2026-09-20/gospel/" hreflang="en" lang="en"[^>]*>\\s*English`));
    expect(html).toContain('Lugha:');
  });

  it('carries the other Today pages on the default Today page, for the saved-language redirect', async () => {
    const html = await render('en', '');
    expect(html).toContain(`data-homes="{&quot;sw&quot;:&quot;${base}sw/&quot;}"`);
    expect(await render('sw', 'sw/')).not.toContain('data-homes');
  });

  it('renders nothing on the not-found and offline pages', async () => {
    expect(await render('en', '404.html')).not.toContain('data-locale-switcher');
    expect(await render('en', 'offline/')).not.toContain('data-locale-switcher');
  });
});
