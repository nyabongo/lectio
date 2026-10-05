/**
 * What the merge rule reads from the `verifiers` gate result (L-027).
 *
 * Contract: the verifiers gate puts one record per checked claim in `meta.claims`:
 *
 *     meta.claims: [{
 *       file: 'passages/MT.20.1-16.json', claimId: 'c1',
 *       sensitive: false,                                   // the generator's claims[].sensitive
 *       confirmer: { verdict: 'supported', support: 0.95, sensitive: false },
 *       refuter:   { verdict: 'supported', support: 0.92, sensitive: false },
 *     }, …]
 *
 * `confirmer` / `refuter` is `null` (or absent) when that verifier gave no verdict for the claim.
 * Anything that does not match this shape is unreadable, and the merge rule then asks for review:
 * it never auto-merges on scores it cannot read.
 */
export const VERDICTS = ['supported', 'unsupported', 'refuted', 'uncertain'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One verifier's structured output for one claim (rationale and cost stay in the gate's own meta). */
export interface VerifierVerdict {
  readonly verdict: Verdict;
  /** 0–1. */
  readonly support: number;
  /** The verifier marks the claim doctrinally or pastorally sensitive. */
  readonly sensitive: boolean;
}

export interface VerifierClaimRecord {
  readonly file: string;
  readonly claimId: string;
  /** The generator's `claims[].sensitive`. */
  readonly sensitive: boolean;
  readonly confirmer: VerifierVerdict | null;
  readonly refuter: VerifierVerdict | null;
}

/** The part of the verifiers gate's `meta` the merge rule reads. */
export interface VerifierMeta {
  readonly claims: readonly VerifierClaimRecord[];
}

export const VERIFIER_ROLES = ['confirmer', 'refuter'] as const;
export type VerifierRole = (typeof VERIFIER_ROLES)[number];

export type ReadVerifierClaims =
  | { readonly ok: true; readonly claims: readonly VerifierClaimRecord[] }
  | { readonly ok: false; readonly error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readVerdict(value: unknown): VerifierVerdict | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const { verdict, support, sensitive } = value;
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) return undefined;
  if (typeof support !== 'number' || !Number.isFinite(support) || support < 0 || support > 1) return undefined;
  if (typeof sensitive !== 'boolean') return undefined;
  return { verdict: verdict as Verdict, support, sensitive };
}

function readRecord(value: unknown): VerifierClaimRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { file, claimId, sensitive } = value;
  if (typeof file !== 'string' || file === '' || typeof claimId !== 'string' || claimId === '') return undefined;
  if (typeof sensitive !== 'boolean') return undefined;
  const confirmer = readVerdict(value['confirmer']);
  const refuter = readVerdict(value['refuter']);
  if (confirmer === undefined || refuter === undefined) return undefined;
  return { file, claimId, sensitive, confirmer, refuter };
}

/** The per-claim records in a verifiers gate result's `meta`, or why they cannot be read. */
export function readVerifierClaims(meta: Record<string, unknown>): ReadVerifierClaims {
  const claims = meta['claims'];
  if (!Array.isArray(claims)) return { ok: false, error: 'the verifiers result has no meta.claims list' };
  const records: VerifierClaimRecord[] = [];
  for (const [index, value] of claims.entries()) {
    const record = readRecord(value);
    if (record === undefined)
      return { ok: false, error: `meta.claims/${String(index)} is not a readable claim record` };
    records.push(record);
  }
  return { ok: true, claims: records };
}
