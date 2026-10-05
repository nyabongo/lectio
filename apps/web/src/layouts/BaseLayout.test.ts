import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import { headScript } from '../lib/settings.ts';
import BaseLayout from './BaseLayout.astro';

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

function render(props: Record<string, unknown>, slots: Record<string, string> = {}): Promise<string> {
  return container.renderToString(BaseLayout, { props, slots });
}

describe('BaseLayout', () => {
  it('renders the header date title, celebration and colour', async () => {
    const html = await render(
      { title: 'Today', date: '2026-09-20', celebration: 'Twenty-fifth Sunday in Ordinary Time', colour: 'green' },
      { default: '<h1>Readings</h1>' },
    );
    expect(html).toMatch(/<html lang="en" data-colour="green"/);
    expect(html).toContain('<title>Today · Lectio</title>');
    expect(html).toMatch(/<time datetime="2026-09-20"[^>]*>Sunday 20 September 2026<\/time>/);
    expect(html).toContain('Twenty-fifth Sunday in Ordinary Time');
    expect(html).toContain('<h1>Readings</h1>');
  });

  it('links to the calendar, search, settings and about pages under the base path', async () => {
    const html = await render({ title: 'Lectio' });
    const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
    expect(html).toContain(`href="${base}calendar/"`);
    expect(html).toContain(`href="${base}settings/"`);
    expect(html).toMatch(
      new RegExp(`<nav class="site-nav"[^>]*>[\\s\\S]*<a href="${base}search/"[^>]*>Search</a>[\\s\\S]*</nav>`),
    );
    expect(html).toContain(`href="${base}about/"`);
    expect(html).toContain('<title>Lectio</title>');
  });

  it('carries the study-aid disclaimer in the footer', async () => {
    const html = await render({ title: 'Lectio' });
    expect(html).toMatch(/<footer[^>]*>[\s\S]*study aid, not Church teaching[\s\S]*<\/footer>/);
  });

  it('inlines the generated colour tokens for light, dark and every liturgical colour', async () => {
    const html = await render({ title: 'Lectio' });
    expect(html).toContain('--colour-accent:');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain(':root[data-theme="dark"]');
    for (const colour of ['green', 'violet', 'white', 'gold', 'red', 'rose', 'black']) {
      expect(html).toContain(`[data-colour="${colour}"]`);
    }
  });

  it('inlines the settings head script so saved theme and text size apply before paint', async () => {
    const html = await render({ title: 'Lectio' });
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<script>${headScript()}</script>`);
  });

  it('falls back to the default colour and omits the date title when there is no day', async () => {
    const html = await render({ title: 'About', colour: 'teal', description: 'How it works' });
    expect(html).toMatch(/data-colour="green"/);
    expect(html).not.toContain('<time');
    expect(html).toContain('<meta name="description" content="How it works">');
  });

  it('sets the page language and fills the head and header-actions slots', async () => {
    const html = await render(
      { title: 'Siku', lang: 'sw', date: '2026-09-20' },
      { head: '<meta name="x-test" content="head-slot">', 'header-actions': '<button>Share</button>' },
    );
    expect(html).toMatch(/<html lang="sw"/);
    expect(html).toContain('<meta name="x-test" content="head-slot">');
    expect(html).toMatch(/<nav[^>]*>[\s\S]*<button>Share<\/button>[\s\S]*<\/nav>/);
  });

  it('prefixes links for a non-default locale and uses its catalog', async () => {
    const html = await render({ title: 'Kalenda', lang: 'sw' });
    const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
    expect(html).toContain(`href="${base}sw/calendar/"`);
    expect(html).toContain(`href="${base}sw/"`);
    expect(html).toContain('<title>Kalenda · Lectio</title>');
    expect(html).toContain('<html lang="sw"');
    expect(html).toContain('Ruka hadi maudhui');
    expect(html).toMatch(/<nav class="site-nav" aria-label="Tovuti"/);
  });
});
