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

  it('lists Swahili as coming soon and not selectable', () => {
    expect(html).toMatch(/<input type="radio" name="language" value="sw" disabled/);
    expect(html).toContain('Kiswahili');
    expect(html).toContain('coming soon');
  });

  it('inlines the head script that applies the saved theme and size before paint', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(headScript());
    expect(head).toContain('<link rel="canonical"');
  });
});
