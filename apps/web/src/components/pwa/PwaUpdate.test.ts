import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import strings from '../../i18n/en/pwa.json' with { type: 'json' };
import swStrings from '../../i18n/sw/pwa.json' with { type: 'json' };
import OfflinePage from '../../pages/offline/index.astro';
import PwaUpdate from './PwaUpdate.astro';

let container: AstroContainer;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

beforeAll(async () => {
  container = await AstroContainer.create();
});

describe('PwaUpdate', () => {
  it('renders the hidden update toast with the worker URL and scope when enabled', async () => {
    const html = await container.renderToString(PwaUpdate, { props: { lang: 'en', enabled: true } });
    expect(html).toMatch(/<div class="pwa-region"[^>]*aria-live="polite"/);
    expect(html).toMatch(/<div class="pwa-toast"[^>]*data-pwa-toast/);
    expect(html).toContain(`data-sw-url="${base}sw.js"`);
    expect(html).toContain(`data-sw-scope="${base}"`);
    expect(html).toMatch(/data-pwa-toast[^>]*hidden/);
    for (const text of Object.values(strings.update)) expect(html).toContain(text);
  });

  it('renders only the empty live region in development, so no worker is registered', async () => {
    const html = await container.renderToString(PwaUpdate, { props: { lang: 'en', enabled: false } });
    expect(html).toContain('pwa-region');
    expect(html).not.toContain('data-pwa-toast');
  });
});

describe('offline page', () => {
  let html: string;

  beforeAll(async () => {
    html = await container.renderToString(OfflinePage);
  });

  it('explains what is kept offline, from the pwa catalog', () => {
    expect(html).toContain(`<title>${strings.offline.title} · Lectio</title>`);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${strings.offline.heading}</h1>`));
    expect(html).toContain(strings.offline.body);
    expect(html).toContain(`href="${base}"`);
    expect(html).toContain(strings.offline.retry);
  });

  it('renders in Kiswahili at /sw/offline/, with a link to the Kiswahili Today page', async () => {
    const sw = await container.renderToString(OfflinePage, {
      request: new Request(`https://example.org${base}sw/offline/`),
    });
    expect(sw).toMatch(/<html lang="sw"/);
    expect(sw).toContain(swStrings.offline.heading);
    expect(sw).toContain(swStrings.offline.body);
    expect(sw).toContain(`href="${base}sw/"`);
  });

  it('is kept out of search results', () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('gets the manifest, theme colour and icons from the base layout', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<link rel="manifest" href="${base}manifest.webmanifest">`);
    expect(head).toContain('<meta name="theme-color" content="#2f6b4f">');
    expect(head).toContain(`<link rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png">`);
  });
});
