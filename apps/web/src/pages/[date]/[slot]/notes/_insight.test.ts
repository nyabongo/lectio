/**
 * The Insight permalink page (notes/[noteId]/index.astro) and its view model (_insight.ts), against the fixture
 * content root: every approved Mt 20 note gets a page; the pending Isaiah passage gets none.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentRepo } from '@lectio/content';
import type { Passage, TranslationNote } from '@lectio/schema/passage';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import strings from '../../../../i18n/en/insight.json' with { type: 'json' };
import type * as InsightTypes from './_insight.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const passagesDir = resolve(webRoot, 'test/fixtures/content/passages');

type Params = { date: string; slot: string; noteId: string };
type InsightModule = typeof InsightTypes;

let render: (params: Params) => Promise<string>;
let staticPaths: { params: Params }[];
let insight: InsightModule;
let repo: ContentRepo;
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
  insight = await import('./_insight.ts');
  repo = (await import('../../../../lib/site.ts')).siteContext().repo;
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

describe('insightPath', () => {
  it('nests the note under its reading', () => {
    expect(insight.insightPath('2026-09-20', 'gospel', 'v15-evil-eye')).toBe('2026-09-20/gospel/notes/v15-evil-eye/');
  });
});

describe('insightStaticPaths', () => {
  it('has one path per approved note and none for the pending passage', () => {
    for (const note of mt.translationNotes)
      expect(staticPaths).toContainEqual({ params: { date: '2026-09-20', slot: 'gospel', noteId: note.id } });
    expect(staticPaths.some(({ params }) => params.slot === 'first-reading')).toBe(false);
    for (const note of is.translationNotes)
      expect(staticPaths.some(({ params }) => params.noteId === note.id)).toBe(false);
  });
});

describe('insightPage', () => {
  it('returns the note with a report link that carries the permalink path', () => {
    const view = insight.insightPage(repo, '2026-09-20', 'gospel', 'v15-evil-eye');
    expect(view?.path).toBe('2026-09-20/gospel/notes/v15-evil-eye/');
    expect(view?.note.id).toBe('v15-evil-eye');
    expect(view?.reading.ref).toBe('Mt 20:1-16a');
    const report = new URL(view?.note.reportUrl ?? '');
    expect(report.searchParams.get('page')).toBe('2026-09-20/gospel/notes/v15-evil-eye/');
    expect(report.searchParams.get('note')).toBe('v15-evil-eye');
    expect(report.searchParams.get('passage')).toBe(mt.key);
  });

  it('is null for an unknown reading, a pending passage or an unknown note', () => {
    expect(insight.insightPage(repo, '2026-09-20', 'epistle', 'v15-evil-eye')).toBeNull();
    expect(insight.insightPage(repo, '1999-01-01', 'gospel', 'v15-evil-eye')).toBeNull();
    const pendingNote = is.translationNotes[0]?.id ?? 'missing';
    expect(insight.insightPage(repo, '2026-09-20', 'first-reading', pendingNote)).toBeNull();
    expect(insight.insightPage(repo, '2026-09-20', 'gospel', 'no-such-note')).toBeNull();
  });
});

describe('Insight page', () => {
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
    // Sources: a visible list with superscripts linking to it, and how it was reviewed.
    expect(html).toMatch(new RegExp(`<h2 id="sources-heading"[^>]*>${strings.sources}</h2>`));
    expect(html).toMatch(/<sup class="cite[^"]*"[^>]*><a href="#note-v15-evil-eye-source-/);
    expect(html).toMatch(/<li id="note-v15-evil-eye-source-[^"]+"/);
    expect(html).toMatch(/Verified against \d+ sources?\./);
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
