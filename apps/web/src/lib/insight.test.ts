import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import { insightPage, insightPath, insightStaticPaths } from './insight.ts';
import { siteContext } from './site.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const passagesDir = resolve(webRoot, 'test/fixtures/content/passages');
const { repo } = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } });
const mt = JSON.parse(readFileSync(resolve(passagesDir, 'MT.20.1-16.json'), 'utf8')) as Passage;
const is = JSON.parse(readFileSync(resolve(passagesDir, 'IS.55.6-9.json'), 'utf8')) as Passage;

describe('insightPath', () => {
  it('nests the note under its reading', () => {
    expect(insightPath('2026-09-20', 'gospel', 'v15-evil-eye')).toBe('2026-09-20/gospel/notes/v15-evil-eye/');
  });
});

describe('insightStaticPaths', () => {
  it('has one path per approved note and none for the pending passage', () => {
    const paths = insightStaticPaths(repo);
    for (const note of mt.translationNotes)
      expect(paths).toContainEqual({ params: { date: '2026-09-20', slot: 'gospel', noteId: note.id } });
    expect(paths.some(({ params }) => params.date === '2026-09-20' && params.slot === 'first-reading')).toBe(false);
    for (const note of is.translationNotes) expect(paths.some(({ params }) => params.noteId === note.id)).toBe(false);
  });
});

describe('insightPage', () => {
  it('returns the note with a report link that carries the permalink path', () => {
    const view = insightPage(repo, '2026-09-20', 'gospel', 'v15-evil-eye');
    expect(view?.path).toBe('2026-09-20/gospel/notes/v15-evil-eye/');
    expect(view?.note.id).toBe('v15-evil-eye');
    expect(view?.reading.ref).toBe('Mt 20:1-16a');
    expect(view?.reading.notes.key).toBe(mt.key);
    const report = new URL(view?.note.reportUrl ?? '');
    expect(report.searchParams.get('page')).toBe('2026-09-20/gospel/notes/v15-evil-eye/');
    expect(report.searchParams.get('note')).toBe('v15-evil-eye');
    expect(report.searchParams.get('passage')).toBe(mt.key);
  });

  it('is null for an unknown reading, a pending passage or an unknown note', () => {
    expect(insightPage(repo, '2026-09-20', 'epistle', 'v15-evil-eye')).toBeNull();
    expect(insightPage(repo, '1999-01-01', 'gospel', 'v15-evil-eye')).toBeNull();
    const pendingNote = is.translationNotes[0]?.id ?? 'missing';
    expect(insightPage(repo, '2026-09-20', 'first-reading', pendingNote)).toBeNull();
    expect(insightPage(repo, '2026-09-20', 'gospel', 'no-such-note')).toBeNull();
  });
});
