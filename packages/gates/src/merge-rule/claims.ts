/**
 * The claims a PR asks the verifiers to check: every claim of every changed passage file at the
 * PR head. Auto-merge needs a verifier record for each of them, so a claim the verifiers gate left
 * out cannot ride along on the scores of the others.
 */
import { contentKindOf } from '@lectio/content';

import type { GateContext } from '../core/gate.ts';

export interface ClaimRef {
  readonly file: string;
  readonly claimId: string;
}

/** Stands in for the claims of a passage whose claims cannot be read; it never has a verifier record. */
export const UNREADABLE_CLAIMS = '(unreadable claims)';

function claimIds(text: string): string[] | null {
  try {
    const claims = (JSON.parse(text) as { claims?: unknown } | null)?.claims;
    if (!Array.isArray(claims)) return null;
    const ids = claims.map((claim) => (claim as { id?: unknown } | null)?.id);
    return ids.every((id): id is string => typeof id === 'string' && id !== '') ? ids : null;
  } catch {
    return null;
  }
}

/** Every claim of the changed passage files that exist at the head, in file then claim order. */
export function changedClaims(context: Pick<GateContext, 'changedFiles' | 'readFile'>): ClaimRef[] {
  const claims: ClaimRef[] = [];
  for (const file of context.changedFiles) {
    if (file.status === 'deleted' || contentKindOf(file.path) !== 'passage') continue;
    const text = context.readFile(file.path);
    if (text === null) continue;
    const ids = claimIds(text) ?? [UNREADABLE_CLAIMS];
    for (const claimId of ids) claims.push({ file: file.path, claimId });
  }
  return claims;
}
