import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseShareConfig } from '../../lib/share.ts';
import ShareButton from './ShareButton.astro';

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

function unescape(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

async function render(insight: string | null): Promise<string> {
  return container.renderToString(ShareButton, {
    props: {
      title: 'Mt 20:1-16a · Gospel',
      shareRef: 'Mt 20:1-16a',
      insight,
      path: '2026-09-20/gospel/',
    },
    request: new Request('https://nyabongo.github.io/lectio/2026-09-20/gospel/'),
  });
}

describe('ShareButton', () => {
  it('renders a disclosure with the share data, WhatsApp, email and the link', async () => {
    const html = await render('A landowner pays the last hired the same as the first.');
    const json = /data-share="([^"]*)"/.exec(html)?.[1];
    const config = parseShareConfig(json === undefined ? undefined : unescape(json));
    expect(config).not.toBeNull();
    const url = config?.payload.url ?? '';
    expect(url).toMatch(/\/2026-09-20\/gospel\/$/);
    expect(config?.payload).toEqual({
      title: 'Mt 20:1-16a · Gospel',
      text: 'Mt 20:1-16a\nA landowner pays the last hired the same as the first.',
      url,
    });
    expect(config?.text).toBe(`${config?.payload.text ?? ''}\n${url}`);

    expect(html).toMatch(/<details class="share"/);
    expect(html).toContain('aria-label="Share Mt 20:1-16a"');
    expect(html).toContain('>Share');
    expect(html).toMatch(/<button[^>]*data-share-copy[^>]*hidden[^>]*>Copy link<\/button>/);
    expect(html).toContain(`href="https://wa.me/?text=${encodeURIComponent(config?.text ?? '')}"`);
    expect(html).toContain('rel="noopener noreferrer external"');
    expect(html).toContain('aria-label="Share on WhatsApp (opens in a new tab)"');
    expect(unescape(html)).toContain(
      `href="mailto:?subject=${encodeURIComponent('Mt 20:1-16a · Gospel')}&body=${encodeURIComponent(config?.text ?? '')}"`,
    );
    expect(html).toMatch(/<label[^>]*for="share-2026-09-20-gospel-url"[^>]*>Link to share<\/label>/);
    expect(html).toContain(`value="${url}"`);
    expect(html).toContain('role="status"');
    expect(unescape(html)).toContain('"copied":"Copied the link with its reference."');
  });

  it('leaves the insight line out when there is none', async () => {
    const html = await render(null);
    const json = /data-share="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(parseShareConfig(unescape(json))?.payload.text).toBe('Mt 20:1-16a');
  });
});
