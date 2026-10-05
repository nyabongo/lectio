import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import strings from '../../i18n/en/about.json' with { type: 'json' };
import { LICENSE_URL, REPORT_ISSUE_URL, loadAttributions, siteAttributionPaths } from '../../lib/attributions.ts';
import About from './index.astro';

let html: string;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(About);
});

describe('About page', () => {
  it('has its own title, canonical path and heading', () => {
    expect(html).toContain(`<title>${strings.title} · Lectio</title>`);
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/about\/"/);
    expect(html).toContain(strings.heading);
  });

  it('says it is a study aid, not Church teaching, and explains the steps, gates and Verified', () => {
    expect(html).toContain(strings.studyAid.title);
    for (const step of ['research', 'tests', 'crossExamine', 'human'] as const)
      expect(html).toContain(escape(strings.steps[step].title));
    for (const gate of ['schema', 'evidence', 'licence', 'verifiers', 'merge'] as const)
      expect(html).toContain(escape(strings.gates[gate].title));
    expect(html).toContain(strings.verified.heading);
  });

  it('credits the link-out provider and links to issue reports', () => {
    expect(html).toContain('href="https://www.drbo.org/"');
    expect(html).toContain(`href="${REPORT_ISSUE_URL}"`);
    expect(html).toContain(`href="${LICENSE_URL}"`);
    expect(html).not.toContain('never stores the text of any translation');
  });

  it('lists every corpus edition, the guard limitation, versification, lectionary and font sources from data', async () => {
    const { corpora, guard, fonts, versification, lectionary } = await loadAttributions(siteAttributionPaths());
    for (const entry of corpora) {
      expect(html).toContain(`id="corpus-${entry.edition}"`);
      expect(html).toContain(escape(entry.name));
    }
    expect(html).toContain(escape(guard?.limitation ?? 'missing'));
    for (const source of [...versification, ...lectionary]) expect(html).toContain(escape(source.name));
    for (const font of fonts) expect(html).toContain(`href="${base}fonts/${font.file}"`);
    expect(html).toContain('href="https://spdx.org/licenses/Apache-2.0.html"');
    expect(html).not.toMatch(/href="[^"]*\.tar\.gz"/);
    expect(html.match(/Reserved Font Name/g)).toHaveLength(1);
  });
});
