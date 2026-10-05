/**
 * The Reading and Insight pages on `/sw/` when Mt 20 has no reviewed, up-to-date Kiswahili translation (L-113): the
 * English notes, marked `lang="en"`, under an "English only" badge in Kiswahili. The fixture's translation is fresh
 * and approved, so the pages' content view is swapped for one that finds no translation (as a stale, pending or
 * missing file would).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as NotesLocale from '../../lib/notes-locale.ts';

vi.mock('../../lib/notes-locale.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof NotesLocale>();
  const { siteContext } = await import('../../lib/site.ts');
  return {
    ...actual,
    siteRepo: (locale: string) => actual.localeRepo(siteContext().repo, locale, { translations: () => null }),
  };
});

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

type Renderable = Parameters<AstroContainer['renderToString']>[0];
let container: AstroContainer;
let ReadingPage: Renderable;
let InsightPage: Renderable;

beforeAll(async () => {
  vi.stubEnv('LECTIO_CONFIG', 'apps/web/test/lectio.config.fixture.json');
  vi.stubEnv('LECTIO_DATE', '2026-09-20');
  vi.stubEnv('INIT_CWD', webRoot);
  container = await AstroContainer.create();
  ReadingPage = (await import('../../pages/[date]/[slot]/index.astro')).default as unknown as Renderable;
  InsightPage = (await import('../../pages/[date]/[slot]/notes/[noteId]/index.astro')).default as unknown as Renderable;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('/sw/ pages without a reviewed translation', () => {
  it('shows the English notes of the reading under an “English only” badge', async () => {
    const html = await container.renderToString(ReadingPage, {
      params: { date: '2026-09-20', slot: 'gospel' },
      request: new Request('https://example.org/sw/2026-09-20/gospel/'),
    });
    expect(html).toContain('<html lang="sw"');
    expect(html).toMatch(/<p class="notes-lang"[^>]*data-notes-lang="en"/);
    expect(html).toContain('Kiingereza pekee');
    expect(html).toMatch(/<p class="reading__summary"[^>]*lang="en"[^>]*>A landowner pays/);
    expect(html).toMatch(/class="context__title"[^>]*lang="en"/);
    expect(html).toContain('“envious”');
    expect(html).not.toContain('Mwenye shamba');
  });

  it('shows the English note on the insight page under the same badge', async () => {
    const html = await container.renderToString(InsightPage, {
      params: { date: '2026-09-20', slot: 'gospel', noteId: 'v15-evil-eye' },
      request: new Request('https://example.org/sw/2026-09-20/gospel/notes/v15-evil-eye/'),
    });
    expect(html).toContain('Kiingereza pekee');
    expect(html).toMatch(/class="insight__summary"[^>]*lang="en"/);
    expect(html).not.toContain('wivu');
  });

  it('never shows the badge on an English page', async () => {
    const html = await container.renderToString(ReadingPage, { params: { date: '2026-09-20', slot: 'gospel' } });
    expect(html).not.toContain('notes-lang');
    expect(html).not.toContain('English only');
  });
});
