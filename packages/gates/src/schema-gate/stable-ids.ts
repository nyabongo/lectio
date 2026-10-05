/**
 * `schema/note-ids-stable`: insight permalinks (L-055) point at translation-note and claim ids, so
 * a change may add ids but never drop or rename one that exists on the base branch. The base
 * version comes from the context's git reader (`git show <base>:<file>`, injected in tests);
 * a file that is new in the pull request is exempt.
 */
import type { ChangedFile } from '../core/git.ts';
import { finding } from '../core/result.ts';
import type { GateResultItem } from '../core/result.ts';
import { SCHEMA_RULES } from './rules.ts';

interface IdBearing {
  readonly translationNotes?: unknown;
  readonly claims?: unknown;
}

/** The `id` strings of an array of objects; anything malformed yields nothing. */
function idsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    const id = (entry as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? [id] : [];
  });
}

/** Note and claim ids of a passage's text, or `null` when it is not a JSON object. */
export function stableIds(text: string): { notes: string[]; claims: string[] } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const passage = value as IdBearing;
  return { notes: idsOf(passage.translationNotes), claims: idsOf(passage.claims) };
}

/**
 * Findings for one changed passage file: every base id missing from `headText`. A deleted
 * passage (`headText` null) drops all of its ids, which is flagged for review rather than failed.
 */
export function checkStableIds(
  change: ChangedFile,
  baseText: string | null,
  headText: string | null,
): GateResultItem[] {
  if (baseText === null) return [];
  const base = stableIds(baseText);
  if (base === null) return [];
  const file = change.path;
  if (headText === null) {
    const count = base.notes.length + base.claims.length;
    if (count === 0) return [];
    return [
      finding(SCHEMA_RULES.noteIdsStable, {
        file,
        severity: 'warning',
        message: `deleting this passage (or moving it out of passages/) removes ${String(count)} published note and claim ids; a person must confirm their permalinks may break`,
      }),
    ];
  }
  const head = stableIds(headText);
  // A head file that does not parse is reported by schema/valid-passage instead.
  if (head === null) return [];
  const was = change.previousPath === undefined ? '' : ` (was ${change.previousPath})`;
  const missing = (kind: string, pointer: string, before: string[], after: string[]): GateResultItem[] => {
    const kept = new Set(after);
    return before
      .filter((id) => !kept.has(id))
      .map((id) =>
        finding(SCHEMA_RULES.noteIdsStable, {
          file,
          pointer,
          ...(kind === 'claim' ? { claimId: id } : {}),
          message: `${kind} id ${JSON.stringify(id)} exists on the base branch${was} but not in this change`,
        }),
      );
  };
  return [
    ...missing('translation-note', '/translationNotes', base.notes, head.notes),
    ...missing('claim', '/claims', base.claims, head.claims),
  ];
}
