import { describe, expect, it } from 'vitest';

import type { ChangedFile } from '../core/git.ts';
import { approvedReviewEdits, isReviewedContent } from './review-edits.ts';

const pending = { status: 'pending', reviewers: [] };
const approved = { status: 'approved', method: 'human', reviewers: ['nyabongo'], approvedVia: 'label' };
const passage = (review: unknown): string => JSON.stringify({ key: 'MT.20.1-16', review });

function edits(
  changedFiles: ChangedFile[],
  head: Record<string, string>,
  base: Record<string, string> = {},
  root = '.',
): string[] {
  return approvedReviewEdits({
    config: { content: { root } },
    changedFiles,
    readFile: (path) => head[path] ?? null,
    readBase: (path) => base[path] ?? null,
  });
}

describe('approvedReviewEdits', () => {
  it('lists a passage whose review block becomes approved', () => {
    const file = 'passages/MT.20.1-16.json';
    expect(
      edits([{ path: file, status: 'modified' }], { [file]: passage(approved) }, { [file]: passage(pending) }),
    ).toEqual([file]);
  });

  it('lists a new passage that arrives approved', () => {
    const file = 'passages/MT.20.1-16.json';
    expect(edits([{ path: file, status: 'added' }], { [file]: passage(approved) })).toEqual([file]);
  });

  it('compares a renamed passage with its old path', () => {
    const files: ChangedFile[] = [{ path: 'passages/B.json', status: 'renamed', previousPath: 'passages/A.json' }];
    expect(edits(files, { 'passages/B.json': passage(approved) }, { 'passages/A.json': passage(approved) })).toEqual(
      [],
    );
    expect(edits(files, { 'passages/B.json': passage(approved) }, { 'passages/B.json': passage(approved) })).toEqual([
      'passages/B.json',
    ]);
  });

  it('lists a translation whose review block becomes approved', () => {
    const file = 'passages/i18n/sw/MT.20.1-16.json';
    expect(edits([{ path: file, status: 'added' }], { [file]: passage(approved) })).toEqual([file]);
    expect(
      edits([{ path: 'passages/i18n/en/MT.20.1-16.json', status: 'added' }], { [file]: passage(approved) }),
    ).toEqual([]);
  });

  it('ignores unchanged approvals, pending blocks, deletions, other files and unreadable JSON', () => {
    const head = {
      'passages/same.json': passage(approved),
      'passages/pending.json': passage(pending),
      'passages/none.json': JSON.stringify({ key: 'x' }),
      'passages/scalar.json': '3',
      'passages/null-review.json': passage(null),
      'passages/broken.json': '{',
      'calendar/2026.json': passage(approved),
      'passages/notes.txt': passage(approved),
    };
    const files: ChangedFile[] = [
      ...Object.keys(head).map((path): ChangedFile => ({ path, status: 'modified' })),
      { path: 'passages/gone.json', status: 'deleted' },
      { path: 'passages/missing.json', status: 'modified' },
    ];
    expect(edits(files, head, { 'passages/same.json': passage(approved) })).toEqual([]);
  });

  it('ignores approved-looking files in a passages/ or calendar/ directory outside the content root', () => {
    const outside = [
      'tests/gates/fixtures/bad-week/head/passages/MT.20.1-16.json',
      'tests/gates/fixtures/bad-week/head/passages/i18n/sw/MT.20.1-16.json',
      'tests/gates/fixtures/bad-week/head/calendar/2026.json',
      'packages/gates/src/merge-rule/fixtures/passages/MT.20.1-16.json',
      'packages/content/src/fixtures/passages/i18n/sw/MT.20.1-16.json',
      'passages/drafts/MT.20.1-16.json',
    ];
    const head = Object.fromEntries(outside.map((path) => [path, passage(approved)]));
    const files = outside.map((path): ChangedFile => ({ path, status: 'added' }));
    expect(edits(files, head)).toEqual([]);
  });

  it('still lists review edits under the content root, however the path is spelt', () => {
    const spellings = ['./passages/MT.20.1-16.json', 'passages//JN.1.1-5.json', 'tests/../passages/LK.2.1-14.json'];
    const head = Object.fromEntries(spellings.map((path) => [path, passage(approved)]));
    const files = spellings.map((path): ChangedFile => ({ path, status: 'added' }));
    expect(edits(files, head)).toEqual(spellings);
  });

  it('follows a configured content root', () => {
    const inside = 'content/passages/MT.20.1-16.json';
    const translation = 'content/passages/i18n/sw/MT.20.1-16.json';
    const outside = 'passages/MT.20.1-16.json';
    const head = { [inside]: passage(approved), [translation]: passage(approved), [outside]: passage(approved) };
    const files = Object.keys(head).map((path): ChangedFile => ({ path, status: 'added' }));
    expect(edits(files, head, {}, './content/')).toEqual([inside, translation]);
    expect(isReviewedContent('content/calendar/2026.json', 'content')).toBe(false);
  });
});
