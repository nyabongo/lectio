import { describe, expect, it } from 'vitest';

import type { ChangedFile } from '../core/git.ts';
import { UNREADABLE_CLAIMS, changedClaims } from './claims.ts';

describe('changedClaims', () => {
  it('lists every claim of the changed passages at the head', () => {
    const files: Record<string, string> = {
      'passages/A.json': JSON.stringify({ claims: [{ id: 'c1' }, { id: 'c2' }] }),
      'passages/B.json': JSON.stringify({ claims: [] }),
      'calendar/2026.json': JSON.stringify({ claims: [{ id: 'c9' }] }),
      'passages/bad.json': '{',
      'passages/no-claims.json': JSON.stringify({ key: 'x' }),
      'passages/null.json': 'null',
      'passages/bad-id.json': JSON.stringify({ claims: [{ id: 'c1' }, { id: '' }] }),
      'passages/null-claim.json': JSON.stringify({ claims: [null] }),
    };
    const changedFiles: ChangedFile[] = [
      ...Object.keys(files).map((path): ChangedFile => ({ path, status: 'modified' })),
      { path: 'passages/gone.json', status: 'deleted' },
      { path: 'passages/missing.json', status: 'modified' },
    ];
    expect(changedClaims({ changedFiles, readFile: (path) => files[path] ?? null })).toEqual([
      { file: 'passages/A.json', claimId: 'c1' },
      { file: 'passages/A.json', claimId: 'c2' },
      { file: 'passages/bad.json', claimId: UNREADABLE_CLAIMS },
      { file: 'passages/no-claims.json', claimId: UNREADABLE_CLAIMS },
      { file: 'passages/null.json', claimId: UNREADABLE_CLAIMS },
      { file: 'passages/bad-id.json', claimId: UNREADABLE_CLAIMS },
      { file: 'passages/null-claim.json', claimId: UNREADABLE_CLAIMS },
    ]);
  });
});
