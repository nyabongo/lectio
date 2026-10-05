// Underscore prefix: Astro does not route files starting with `_`, so this test can sit next to the page.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import { headScript } from '../../lib/settings.ts';
import SettingsPage from './index.astro';

let html: string;

beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(SettingsPage, { request: new Request('https://example.org/settings/') });
});

describe('settings page', () => {
  it('renders every setting with the defaults checked', () => {
    expect(html).toMatch(/<h1[^>]*>Settings<\/h1>/);
    expect(html).toMatch(/<input type="radio" name="textSize" value="default" checked/);
    expect(html).toMatch(/<input type="radio" name="theme" value="system" checked/);
    expect(html).toMatch(/<input type="radio" name="playbackSpeed" value="1" checked/);
    expect(html).toMatch(/<input type="radio" name="language" value="en" checked/);
    for (const speed of ['0.75×', '1.25×', '2×']) expect(html).toContain(speed);
    expect(html).toContain('Clear offline data');
  });

  it('lists Kiswahili as selectable, linking each language to its own settings page', () => {
    expect(html).toMatch(/<input type="radio" name="language" value="sw" data-href="[^"]*\/sw\/settings\/"/);
    expect(html).toMatch(/<input type="radio" name="language" value="en" checked data-href="[^"]*\/settings\/"/);
    expect(html).toContain('Kiswahili');
    expect(html).not.toContain('coming soon');
  });

  it('gets the head script from the base layout, once, and its SEO tags', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head.split(headScript())).toHaveLength(2);
    expect(head).toContain('<link rel="canonical"');
  });
});

describe('settings page in Kiswahili', () => {
  it('renders in the locale of its URL, with Kiswahili checked', async () => {
    const container = await AstroContainer.create();
    const sw = await container.renderToString(SettingsPage, {
      request: new Request('https://example.org/sw/settings/'),
    });
    expect(sw).toContain('<html lang="sw"');
    expect(sw).toMatch(/<h1[^>]*>Mipangilio<\/h1>/);
    expect(sw).toMatch(/<input type="radio" name="language" value="sw" checked/);
  });
});
