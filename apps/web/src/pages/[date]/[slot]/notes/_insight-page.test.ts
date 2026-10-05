/**
 * The Insight permalink page (notes/[noteId]/index.astro) rendered with the Container API against the fixture
 * content root. The view model (src/lib/insight.ts) has its own tests.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Passage, TranslationNote } from '@lectio/schema/passage';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const passagesDir = resolve(webRoot, 'test/fixtures/content/passages');

type Params = { date: string; slot: string; noteId: string };

let render: (params: Params) => Promise<string>;
let staticPaths: { params: Params }[];
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
  const page = await import('./[noteId]/index.astro');
  // `.astro` modules are typed as their default export only; the page also exports getStaticPaths.
  staticPaths = (page as unknown as { getStaticPaths: () => typeof staticPaths }).getStaticPaths();
  const container = await AstroContainer.create();
  const Page = page.default as unknown as Parameters<AstroContainer['renderToString']>[0];
  render = (params) => container.renderToString(Page, { params });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Insight page', () => {
  it('is built for every approved note and no pending one', () => {
    for (const note of mt.translationNotes)
      expect(staticPaths).toContainEqual({ params: { date: '2026-09-20', slot: 'gospel', noteId: note.id } });
    // The first reading of 2026-09-20 (Isaiah 55) is pending; that of 2026-09-14 (Numbers 21) is approved.
    expect(staticPaths.some(({ params }) => params.date === '2026-09-20' && params.slot === 'first-reading')).toBe(
      false,
    );
    expect(staticPaths).toContainEqual({
      params: { date: '2026-09-14', slot: 'first-reading', noteId: 'v9-bronze-serpent' },
    });
  });

  it('renders /2026-09-20/gospel/notes/v15-evil-eye/ with the note, its sources and a link back', async () => {
    const html = await render({ date: '2026-09-20', slot: 'gospel', noteId: 'v15-evil-eye' });
    const note = mt.translationNotes.find((candidate: TranslationNote) => candidate.id === 'v15-evil-eye');
    expect(note).toBeDefined();
    if (note === undefined) return;
    expect(html).toContain('<title>“envious” · Mt 20:1-16a, verse 15 · Lectio</title>');
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Verse 15[\s\S]*“envious”[\s\S]*<\/h1>/);
    expect(html).toContain('Translation note · Mt 20:1-16a');
    expect(html).toContain(note.original.text);
    expect(html).toContain(note.original.translit);
    expect(html).toContain('lang="grc" dir="ltr"');
    // The summary is the description, and the canonical URL is the permalink.
    expect(html).toContain(`<meta name="description" content="${note.summary}"`);
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/2026-09-20\/gospel\/notes\/v15-evil-eye\/"/);
    expect(html).toContain('<meta property="og:type" content="article"');
    // The reading page's verification footer, with the sources expanded; superscripts link to them.
    expect(html).toMatch(/<details class="verification__details"[^>]*open/);
    expect(html).toMatch(/<sup class="cite[^"]*"[^>]*><a href="#note-v15-evil-eye-source-/);
    expect(html).toMatch(/<li id="note-v15-evil-eye-source-[^"]+"/);
    expect(html).toContain('Verified · 3 sources');
    expect(html).toContain('Approved by a human reviewer');
    expect(html).toContain('Last reviewed 3 September 2026');
    expect(html).toContain('page=2026-09-20%2Fgospel%2Fnotes%2Fv15-evil-eye%2F');
    // Back to the note on the reading page.
    expect(html).toMatch(/href="[^"]*\/2026-09-20\/gospel\/#note-v15-evil-eye"/);
    expect(html).toContain('All notes for Mt 20:1-16a');
    expect(html).toContain('A study aid, not Church teaching');
    // Only this note.
    expect(html).not.toContain('note-v15-agathos');
  });

  it('renders every approved note', async () => {
    for (const note of mt.translationNotes) {
      const html = await render({ date: '2026-09-20', slot: 'gospel', noteId: note.id });
      expect(html).toContain(`data-note="${note.id}"`);
    }
  });

  it('throws for a note that has no approved page', async () => {
    const pendingNote = is.translationNotes[0]?.id ?? 'missing';
    await expect(render({ date: '2026-09-20', slot: 'first-reading', noteId: pendingNote })).rejects.toThrow(
      /no approved note/,
    );
  });
});
