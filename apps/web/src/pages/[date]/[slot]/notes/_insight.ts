/**
 * The Insight permalink page, `/[date]/[slot]/notes/[noteId]/` (e.g. `/2026-09-20/gospel/notes/v15-evil-eye/`):
 * one translation note of a reading as its own static page, so a link can point at a single insight.
 *
 * Built on `readingPage()` (src/lib/reading.ts), which hands over notes only for an approved passage, so a page
 * exists only for an approved note and nothing of a pending passage is ever rendered. The leading underscore keeps
 * this module out of Astro's routes.
 */
import type { ContentRepo } from '@lectio/content';

import { readingPage, readingStaticPaths, reportIssueUrl } from '../../../../lib/reading.ts';
import type { NoteView, NotesView, ReadingView } from '../../../../lib/reading.ts';

/** The page path of one insight, relative to the base path: `2026-09-20/gospel/notes/v15-evil-eye/`. */
export function insightPath(date: string, slot: string, noteId: string): string {
  return `${date}/${slot}/notes/${noteId}/`;
}

/** One Insight page. */
export interface InsightView {
  /** The reading the note belongs to (its `notes` are always non-null here). */
  readonly reading: ReadingView & { readonly notes: NotesView };
  /** The note, with its report link carrying this page's path. */
  readonly note: NoteView;
  /** The page path relative to the base path (the canonical URL). */
  readonly path: string;
}

/**
 * The Insight page for `noteId` on the reading at `date`/`slot`, or `null` when there is no such reading, its
 * passage is missing or not approved, or it has no note with that id.
 */
export function insightPage(repo: ContentRepo, date: string, slot: string, noteId: string): InsightView | null {
  const reading = readingPage(repo, date, slot);
  const notes = reading?.notes ?? null;
  if (reading === null || notes === null) return null;
  const note = notes.translationNotes.find((candidate) => candidate.id === noteId);
  if (note === undefined) return null;
  const path = insightPath(date, slot, noteId);
  return {
    reading: { ...reading, notes },
    note: { ...note, reportUrl: reportIssueUrl({ passage: notes.key, note: noteId, page: path }) },
    path,
  };
}

/** Static paths for `notes/[noteId]/index.astro`: one per approved translation note of every reading page. */
export function insightStaticPaths(repo: ContentRepo): { params: { date: string; slot: string; noteId: string } }[] {
  return readingStaticPaths(repo).flatMap(({ params: { date, slot } }) =>
    (readingPage(repo, date, slot)?.notes?.translationNotes ?? []).map((note) => ({
      params: { date, slot, noteId: note.id },
    })),
  );
}
