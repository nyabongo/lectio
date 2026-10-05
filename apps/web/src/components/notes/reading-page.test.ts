/**
 * The Reading page (src/pages/[date]/[slot]/index.astro) rendered with the Container API against the fixture
 * content root: the approved Mt 20 passage shows all its notes, the pending Isaiah passage shows none.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Passage } from '@lectio/schema/passage';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const passagesDir = resolve(webRoot, 'test/fixtures/content/passages');

let render: (date: string, slot: string, path?: string) => Promise<string>;
let staticPaths: { params: { date: string; slot: string } }[];
let mt: Passage;
let is: Passage;

beforeAll(async () => {
  // The page reads the shared site context, so point it at the fixture config before anything imports it.
  vi.stubEnv('LECTIO_CONFIG', 'apps/web/test/lectio.config.fixture.json');
  vi.stubEnv('LECTIO_DATE', '2026-09-20');
  vi.stubEnv('INIT_CWD', webRoot);
  const { readFileSync } = await import('node:fs');
  mt = JSON.parse(readFileSync(resolve(passagesDir, 'MT.20.1-16.json'), 'utf8')) as Passage;
  is = JSON.parse(readFileSync(resolve(passagesDir, 'IS.55.6-9.json'), 'utf8')) as Passage;
  const page = await import('../../pages/[date]/[slot]/index.astro');
  // `.astro` modules are typed as their default export only; the page also exports getStaticPaths.
  staticPaths = (page as unknown as { getStaticPaths: () => typeof staticPaths }).getStaticPaths();
  const container = await AstroContainer.create();
  const Page = page.default as unknown as Parameters<AstroContainer['renderToString']>[0];
  render = (date, slot, path) =>
    container.renderToString(Page, {
      params: { date, slot },
      ...(path === undefined ? {} : { request: new Request(`https://example.org${path}`) }),
    });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Reading page', () => {
  it('is built for every reading of the fixture calendar', () => {
    expect(staticPaths).toContainEqual({ params: { date: '2026-09-20', slot: 'gospel' } });
    expect(staticPaths).toContainEqual({ params: { date: '2026-09-20', slot: 'first-reading' } });
  });

  it('renders every note of the approved Mt 20 passage', async () => {
    const html = await render('2026-09-20', 'gospel');
    expect(html).toContain('<title>Mt 20:1-16a · Gospel · Lectio</title>');
    expect(html).toMatch(/<h1[^>]*>Mt 20:1-16a<\/h1>/);
    for (const note of mt.translationNotes) {
      expect(html).toContain(`id="note-${note.id}"`);
      expect(html).toContain(note.summary);
      expect(html).toContain(`lang="grc" dir="ltr"`);
      expect(html).toContain(note.original.text);
      expect(html).toContain(note.original.translit);
    }
    expect(html).toContain('Verse 15');
    expect(html).toContain('“envious”');
    expect(html).toContain(mt.context.title);
    // Source superscripts link to the list entries.
    expect(html).toMatch(
      /<sup class="cite[^"]*"[^>]*><a href="#context-source-davies-allison"[^>]*aria-label="Source 6"/,
    );
    expect(html).toContain('id="context-source-davies-allison"');
    // The verification footer: mark, excerpt with its language, review date and report link.
    expect(html).toContain('Verified · 3 sources');
    expect(html).toContain('Verified · 1 source');
    expect(html).toMatch(/<blockquote[^>]*lang="grc" dir="ltr"[^>]*>εἷς ἐστιν ὁ ἀγαθός<\/blockquote>/);
    expect(html).toContain('Last reviewed 3 September 2026');
    expect(html).toContain('Approved by a human reviewer');
    expect(html).toContain('https://github.com/nyabongo/lectio/issues/new?template=content-issue.yml');
    expect(html).toContain('note=v15-evil-eye');
    expect(html).toContain('note=_context');
    expect(html).toContain('A study aid, not Church teaching');
    // Each note links to its permalink page.
    for (const note of mt.translationNotes) expect(html).toContain(`href="/2026-09-20/gospel/notes/${note.id}/"`);
  });

  it('has Context and Original panels with headings and a Text link-out', async () => {
    const html = await render('2026-09-20', 'gospel');
    expect(html).toMatch(/<section[^>]*id="context"[^>]*>\s*<h2[^>]*>Context<\/h2>/);
    expect(html).toMatch(/<section[^>]*id="original"[^>]*>\s*<h2[^>]*>Original<\/h2>/);
    expect(html).toContain('href="#context"');
    expect(html).toContain('href="#original"');
    expect(html).toMatch(/href="https:\/\/www\.drbo\.org\/chapter\/47020\.htm"[^>]*target="_blank"/);
    expect(html).toContain('aria-label="Read the text of Mt 20:1-16a at Douay-Rheims (drbo.org) (opens in a new tab)"');
    expect(html).toMatch(/data-colour="green"/);
    expect(html).toContain('rel="canonical"');
  });

  it('renders none of the pending Isaiah passage', async () => {
    const html = await render('2026-09-20', 'first-reading');
    expect(html).toMatch(/<h1[^>]*>Is 55:6-9<\/h1>/);
    expect(html).toContain('in preparation');
    expect(html).not.toContain(is.context.title);
    // Short distinctive substrings (no quotes or apostrophes, so HTML escaping cannot hide a leak).
    expect(is.translationNotes.length).toBeGreaterThan(0);
    for (const leak of [
      'book of consolation',
      'Second Isaiah calls the exiles',
      'PENDING-NOTE-SUMMARY',
      'PENDING-NOTE-BODY',
      'v8-thoughts',
      'מַחְשְׁבוֹתַי',
      'maḥšəḇôṯay',
      'Brown, Driver and Briggs',
      'Isaiah 40:1',
    ])
      expect(html).not.toContain(leak);
    expect(html).not.toContain('Verified');
    expect(html).not.toContain('class="note"');
    expect(html).not.toContain('issues/new');
  });

  it('shows the reviewed Kiswahili notes on /sw/, with English sources and no English-only badge (L-113)', async () => {
    const html = await render('2026-09-20', 'gospel', '/sw/2026-09-20/gospel/');
    expect(html).toContain('<html lang="sw"');
    expect(html).toContain('Mwenye shamba anawalipa walioajiriwa mwisho');
    expect(html).toContain('Wafanyakazi katika shamba la mizabibu');
    expect(html).toContain('“wivu”');
    expect(html).toContain('jicho lako ovu');
    expect(html).not.toContain(mt.summary);
    expect(html).not.toContain('Kiingereza pekee');
    expect(html).not.toMatch(/class="reading__summary"[^>]*lang="en"/);
    // Sources and original words stay the English file's.
    expect(html).toContain('id="context-source-davies-allison"');
    expect(html).toContain('ὀφθαλμός σου πονηρός');
    expect(html).toContain('href="/sw/2026-09-20/gospel/notes/v15-evil-eye/"');
    // The share card is the Kiswahili one.
    expect(html).toContain('/og/sw/2026-09-20/gospel.png');
  });

  it('throws for a reading the calendar does not have', async () => {
    await expect(render('2026-09-20', 'epistle')).rejects.toThrow(/no reading for 2026-09-20\/epistle/);
  });
});
