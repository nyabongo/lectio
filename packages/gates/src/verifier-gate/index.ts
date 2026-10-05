/**
 * Gate `verifiers` (LLM verifiers, gate 4): two model families see only claims and sources. The
 * confirmer (`config.verifiers.confirmer`) checks that each claim is supported; the refuter
 * (`config.verifiers.refuter`, another family) tries to refute it. Each answers per claim with a
 * verdict (`supported | unsupported | refuted | uncertain`), a support score (0–1), a `sensitive`
 * flag and a short rationale.
 *
 * - `config.verifiers.mode`: `skip` → skipped; `auto` → skipped unless both slots hold a live
 *   client (no API key means no live client, and the merge rule then requires review); `live` →
 *   a missing live client is an error; `fake` → runs on whatever clients are injected (tests).
 * - A refutation fails the gate; low support, a non-`supported` verdict, a sensitive flag or a
 *   verifier that gave no verdict flag it for review. Nothing here closes a PR.
 * - `meta.claims` holds one {@link VerifierClaimRecord} per verified claim (file, claim id, the
 *   generator's `sensitive` flag, each verifier's `{ verdict, support, sensitive }` or `null`):
 *   the contract the merge rule (L-028) reads.
 * - `meta.files[<path>].verifierSummary` is the review block's `verifierSummary` (schema shape)
 *   when both live verifiers answered every claim (`null` for a fake run or an unreadable file): each verifier's model and lowest support, the lower
 *   of the two, the number of `refuted` verdicts from either verifier and the number of claims
 *   either flagged sensitive. `meta.prompts` records the prompt versions, `meta.costUsd` the cost.
 *
 * Live clients are injected by the caller (L-031) through the provider set.
 */
import { checkContentText, contentPlaceAt } from '@lectio/content';
import { createCostMeter } from '@lectio/providers';
import type { LlmClient } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import type { Gate, GateContext } from '../core/gate.ts';
import { finding, resultFromFindings, skippedResult } from '../core/result.ts';
import type { GateResult, GateResultItem } from '../core/result.ts';
import { defineRule } from '../core/rules.ts';
import type { VerifierSummary } from '../review/approve.ts';
import { claimInput, fetchSourceTexts } from './input.ts';
import { VERIFIER_ROLES, loadPrompt } from './prompts.ts';
import type { ReadPrompt, VerifierPrompt, VerifierRole } from './prompts.ts';
import { verifyClaim } from './verify.ts';
import type { CallOutcome, Verdict } from './verify.ts';

export { MAX_FETCHED_CHARS, claimInput, fetchSourceTexts, trimFetched } from './input.ts';
export type { ClaimInput, SourceInput } from './input.ts';
export { PROMPT_FILES, VERIFIER_ROLES, loadPrompt, readPromptFile } from './prompts.ts';
export type { ReadPrompt, VerifierPrompt, VerifierRole } from './prompts.ts';
export { MAX_RATIONALE_CHARS, VERDICTS, VERDICT_SCHEMA, VERIFIER_MAX_TOKENS, verifyClaim } from './verify.ts';
export type { CallOutcome, ClaimVerdict, Verdict } from './verify.ts';

const ID = 'verifiers';

export const VERIFIER_RULES = {
  twoFamilies: defineRule(
    'verifiers/two-families',
    'The confirmer and the refuter come from two different model families, each as configured.',
    'Set config.verifiers.confirmer and .refuter to different families, and inject live clients of those families.',
  ),
  liveVerifiers: defineRule(
    'verifiers/live-verifiers',
    'With config.verifiers.mode "live", both verifiers are live clients.',
    'Provide the confirmer and refuter API keys to the content-gates job, or set config.verifiers.mode to "auto".',
  ),
  passageReadable: defineRule(
    'verifiers/passage-readable',
    'A changed passage file parses and validates, so its claims can be verified.',
    'Fix the problems gate 1 (schema) reports for the file; the verifiers then check its claims.',
  ),
  claimNotRefuted: defineRule(
    'verifiers/claim-not-refuted',
    'Neither verifier refutes a claim.',
    'Correct or remove the claim, or cite a source that supports it as written; a person settles disagreements.',
  ),
  verifierAnswered: defineRule(
    'verifiers/verifier-answered',
    'Both verifiers return a well-formed verdict for every claim.',
    'Re-run the gates; if the provider keeps failing or answering malformed output, a person reviews the claims.',
  ),
  claimSupported: defineRule(
    'verifiers/claim-supported',
    'Both verifiers judge every claim supported, with support at or above config.autoMerge.minSupport.',
    'Cite a source (with an excerpt) that states the claim directly, or narrow the claim to what the sources say.',
  ),
  claimNotSensitive: defineRule(
    'verifiers/claim-not-sensitive',
    'A claim either verifier flags as doctrinally or pastorally sensitive waits for a person.',
    'A reviewer reads the claim and its sources and approves the PR if it is sound.',
  ),
  liveResults: defineRule(
    'verifiers/live-results',
    'Verifier results count as evidence only when they come from live models; a fake run always waits for a person.',
    'Nothing to fix in content: the verifiers ran on fake clients (config.verifiers.mode "fake"), so no verifierSummary is recorded.',
  ),
} as const;

export type { ClaimResult };

export interface VerifierGateOptions {
  /** Reads the prompt files; defaults to `packages/gates/prompts/`. */
  readonly readPrompt?: ReadPrompt;
}

interface ClaimResult {
  readonly id: string;
  readonly index: number;
  readonly text: string;
  /** The generator's `claims[].sensitive` (never shown to the verifiers). */
  readonly sensitive: boolean;
  readonly outcomes: Readonly<Record<VerifierRole, CallOutcome>>;
}

type OkOutcome = Extract<CallOutcome, { ok: true }>;

const isOk = (outcome: CallOutcome): outcome is OkOutcome => outcome.ok;

const short = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const ZWSP = '\u200b';

/**
 * Model-written text (a rationale, a provider error) made inert for the Markdown PR comment and
 * quoted: whitespace collapsed, truncated, backslashes and Markdown punctuation escaped (no links,
 * images, emphasis or code), `@mentions` and bare URLs broken with a zero-width space. HTML is
 * escaped by the comment renderer.
 */
export function quoteModelText(text: string, max = 200): string {
  const inert = short(text.replace(/\s+/g, ' ').trim(), max)
    .replace(/`/g, "'")
    .replace(/[\\[\]()*_~#|!]/g, (char) => `\\${char}`)
    .replace(/@/g, `@${ZWSP}`)
    .replace(/:\/\//g, `:${ZWSP}//`)
    .replace(/www\./gi, (match) => `${match.slice(0, 3)}${ZWSP}.`);
  return `“${inert}”`;
}

/**
 * A support score for display, truncated (never rounded) to 3 decimals, so a score just under
 * the threshold never reads as meeting it (0.8999 shows as 0.899, not 0.900).
 */
export function formatSupport(support: number): string {
  return (Math.floor(support * 1000 + 1e-9) / 1000).toFixed(3);
}

/** The changed passage files under the content root the gate verifies (deletions excluded). */
function passageFiles(context: GateContext): string[] {
  const { root } = context.config.content;
  return context.changedFiles
    .filter((file) => file.status !== 'deleted' && contentPlaceAt(file.path, root)?.kind === 'passage')
    .map((file) => file.path);
}

/** Findings about the verifier set-up; any of them stops the gate before a model is called. */
function setupFindings(context: GateContext, fakeRoles: readonly VerifierRole[]): GateResultItem[] {
  const { verifiers } = context.config;
  const items: GateResultItem[] = [];
  if (verifiers.mode === 'live' && fakeRoles.length > 0) {
    items.push(
      finding(VERIFIER_RULES.liveVerifiers, {
        message: `no live client for the ${fakeRoles.join(' and ')}`,
      }),
    );
  }
  if (verifiers.confirmer.family === verifiers.refuter.family) {
    items.push(
      finding(VERIFIER_RULES.twoFamilies, {
        message: `confirmer and refuter are both "${verifiers.confirmer.family}"`,
      }),
    );
  }
  for (const role of VERIFIER_ROLES) {
    const client: LlmClient = context.providers[role];
    const expected = verifiers[role].family;
    const fakeAllowed = verifiers.mode === 'fake' && client.family === 'fake';
    if (client.family !== expected && !fakeAllowed) {
      items.push(
        finding(VERIFIER_RULES.twoFamilies, {
          message: `the ${role} client is "${client.family}" but config.verifiers.${role}.family is "${expected}"`,
        }),
      );
    }
  }
  return items;
}

function describe(role: VerifierRole, outcome: CallOutcome, minSupport: number): string {
  if (!isOk(outcome)) return `${role}: no verdict (${outcome.kind}: ${quoteModelText(outcome.error, 160)})`;
  const { verdict, support, rationale } = outcome.verdict;
  const doubt = verdict !== 'supported' || support < minSupport;
  return `${role}: ${verdict} ${formatSupport(support)}${doubt ? ` (${quoteModelText(rationale)})` : ''}`;
}

/** One finding for a flagged claim, naming both verdicts and any sensitive flag; `null` when it is clean. */
function claimFinding(file: string, claim: ClaimResult, minSupport: number): GateResultItem | null {
  const outcomes = VERIFIER_ROLES.map((role) => claim.outcomes[role]);
  const answered = outcomes.filter(isOk);
  const sensitiveBy = VERIFIER_ROLES.filter((role) => {
    const outcome = claim.outcomes[role];
    return isOk(outcome) && outcome.verdict.sensitive;
  });
  const rule = answered.some((outcome) => outcome.verdict.verdict === 'refuted')
    ? VERIFIER_RULES.claimNotRefuted
    : answered.length < outcomes.length
      ? VERIFIER_RULES.verifierAnswered
      : answered.some((outcome) => outcome.verdict.verdict !== 'supported' || outcome.verdict.support < minSupport)
        ? VERIFIER_RULES.claimSupported
        : sensitiveBy.length > 0
          ? VERIFIER_RULES.claimNotSensitive
          : null;
  if (rule === null) return null;
  const verdicts = VERIFIER_ROLES.map((role) => describe(role, claim.outcomes[role], minSupport)).join('; ');
  const sensitive = sensitiveBy.length > 0 ? `; flagged sensitive by the ${sensitiveBy.join(' and ')}` : '';
  return finding(rule, {
    file,
    pointer: `/claims/${String(claim.index)}`,
    claimId: claim.id,
    severity: rule === VERIFIER_RULES.claimNotRefuted ? 'error' : 'warning',
    message: `${claim.id} “${short(claim.text, 100)}”: ${verdicts}${sensitive}`,
  });
}

/** Lowest support a verifier gave across `claims` (all answered). */
function minSupportOf(claims: readonly ClaimResult[], role: VerifierRole): number {
  return Math.min(...claims.map((claim) => (claim.outcomes[role] as OkOutcome).verdict.support));
}

/**
 * The review block's `verifierSummary`, or `null` when a verifier left a claim without a verdict.
 * `models` are the configured model ids of the two clients.
 */
export function summarise(
  claims: readonly ClaimResult[],
  models: Readonly<Record<VerifierRole, string>>,
): VerifierSummary | null {
  if (claims.length === 0 || !claims.every((claim) => VERIFIER_ROLES.every((role) => claim.outcomes[role].ok))) {
    return null;
  }
  const confirmer = { model: models.confirmer, minSupport: minSupportOf(claims, 'confirmer') };
  const refuter = { model: models.refuter, minSupport: minSupportOf(claims, 'refuter') };
  const verdicts = claims.flatMap((claim) => VERIFIER_ROLES.map((role) => (claim.outcomes[role] as OkOutcome).verdict));
  return {
    confirmer,
    refuter,
    minSupport: Math.min(confirmer.minSupport, refuter.minSupport),
    refutations: verdicts.filter((verdict) => verdict.verdict === 'refuted').length,
    sensitive: claims.filter((claim) =>
      VERIFIER_ROLES.some((role) => (claim.outcomes[role] as OkOutcome).verdict.sensitive),
    ).length,
  };
}

/** One verifier's verdict as the merge rule reads it, or `null` when it gave none. */
export interface VerifierVerdictRecord {
  readonly verdict: Verdict;
  readonly support: number;
  readonly sensitive: boolean;
}

/**
 * One record per verified claim in `meta.claims`, the contract the merge rule (L-028) reads:
 * `sensitive` is the generator's flag; `confirmer` / `refuter` is `null` without a verdict.
 */
export interface VerifierClaimRecord {
  readonly file: string;
  readonly claimId: string;
  readonly sensitive: boolean;
  readonly confirmer: VerifierVerdictRecord | null;
  readonly refuter: VerifierVerdictRecord | null;
}

function verdictRecord(outcome: CallOutcome): VerifierVerdictRecord | null {
  if (!isOk(outcome)) return null;
  const { verdict, support, sensitive } = outcome.verdict;
  return { verdict, support, sensitive };
}

/** The `meta.claims` record for `claim` in `file`. */
export function claimRecord(file: string, claim: ClaimResult): VerifierClaimRecord {
  return {
    file,
    claimId: claim.id,
    sensitive: claim.sensitive,
    confirmer: verdictRecord(claim.outcomes.confirmer),
    refuter: verdictRecord(claim.outcomes.refuter),
  };
}

function outcomeMeta(outcome: CallOutcome): Record<string, unknown> {
  return isOk(outcome)
    ? { ...outcome.verdict, model: outcome.model, attempts: outcome.attempts }
    : { error: outcome.error, kind: outcome.kind, attempts: outcome.attempts };
}

function readPassage(context: GateContext, file: string): Passage | string {
  const text = context.readFile(file);
  if (text === null) return 'the file does not exist at the PR head';
  try {
    return checkContentText('passage', text, file) as Passage;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Runs the verifiers over the changed passages. */
export async function runVerifiers(context: GateContext, options: VerifierGateOptions = {}): Promise<GateResult> {
  const files = passageFiles(context);
  const { verifiers, autoMerge, pricing } = context.config;
  if (files.length === 0) {
    // The diff is between commits, so a passage edited but not committed is not in it.
    const range = `${context.base}...${context.head}`;
    const reason = `no passage files changed relative to ${context.base} (git diff ${range}; uncommitted changes are not included)`;
    return skippedResult(ID, reason);
  }
  if (verifiers.mode === 'skip') return skippedResult(ID, 'config.verifiers.mode is "skip"');
  const fakeRoles = VERIFIER_ROLES.filter((role) => context.providers.fakes.has(role));
  if (verifiers.mode === 'auto' && fakeRoles.length > 0) {
    return skippedResult(ID, `no live ${fakeRoles.join(' or ')} client (API key missing); a person reviews`, {
      missing: fakeRoles,
    });
  }
  const setup = setupFindings(context, fakeRoles);
  if (setup.length > 0) return resultFromFindings(ID, setup, { mode: verifiers.mode });

  const prompts: Record<VerifierRole, VerifierPrompt> = {
    confirmer: loadPrompt('confirmer', options.readPrompt),
    refuter: loadPrompt('refuter', options.readPrompt),
  };
  // Fail closed: a fake verdict must never look auto-mergeable (flag, and no verifierSummary).
  const fake = fakeRoles.length > 0 || VERIFIER_ROLES.some((role) => context.providers[role].family === 'fake');
  const items: GateResultItem[] = fake
    ? [finding(VERIFIER_RULES.liveResults, { severity: 'warning', message: 'the verifiers ran on fake clients' })]
    : [];
  const models = { confirmer: verifiers.confirmer.model, refuter: verifiers.refuter.model };
  const prices = createCostMeter({ pricing });
  const unpriced = new Set<string>();
  let costUsd = 0;
  let calls = 0;
  let budget: string | undefined;
  const filesMeta: Record<string, unknown> = {};
  const claimRecords: VerifierClaimRecord[] = [];

  const call = async (role: VerifierRole, input: ReturnType<typeof claimInput>): Promise<CallOutcome> => {
    if (budget !== undefined) return { ok: false, kind: 'budget', error: budget, usages: [], attempts: 0 };
    const outcome = await verifyClaim({
      role,
      client: context.providers[role],
      model: verifiers[role].model,
      prompt: prompts[role],
      input,
    });
    calls += outcome.attempts;
    for (const { model, usage } of outcome.usages) {
      try {
        costUsd += prices.price(model, usage);
      } catch {
        unpriced.add(model);
      }
    }
    if (!outcome.ok && outcome.kind === 'budget') budget = outcome.error;
    return outcome;
  };

  for (const file of files) {
    const passage = readPassage(context, file);
    if (typeof passage === 'string') {
      items.push(
        finding(VERIFIER_RULES.passageReadable, { file, severity: 'warning', message: `not verified: ${passage}` }),
      );
      filesMeta[file] = { verifierSummary: null, error: passage, claims: [] };
      continue;
    }
    const fetched = await fetchSourceTexts(passage, context.providers.fetcher);
    const claims: ClaimResult[] = [];
    for (const [index, claim] of passage.claims.entries()) {
      const input = claimInput(claim, passage, fetched);
      const confirmer = await call('confirmer', input);
      const refuter = await call('refuter', input);
      claims.push({
        id: claim.id,
        index,
        text: claim.text,
        sensitive: claim.sensitive,
        outcomes: { confirmer, refuter },
      });
    }
    for (const claim of claims) {
      claimRecords.push(claimRecord(file, claim));
      const item = claimFinding(file, claim, autoMerge.minSupport);
      if (item !== null) items.push(item);
    }
    const count = (role: VerifierRole): number =>
      claims.filter((claim) => {
        const outcome = claim.outcomes[role];
        return isOk(outcome) && outcome.verdict.verdict === 'refuted';
      }).length;
    filesMeta[file] = {
      verifierSummary: fake ? null : summarise(claims, models),
      refutations: { confirmer: count('confirmer'), refuter: count('refuter') },
      claims: claims.map((claim) => ({
        id: claim.id,
        confirmer: outcomeMeta(claim.outcomes.confirmer),
        refuter: outcomeMeta(claim.outcomes.refuter),
      })),
    };
  }

  return resultFromFindings(ID, items, {
    mode: verifiers.mode,
    fake,
    models: { confirmer: verifiers.confirmer, refuter: verifiers.refuter },
    prompts: {
      confirmer: { id: prompts.confirmer.id, sha256: prompts.confirmer.sha256 },
      refuter: { id: prompts.refuter.id, sha256: prompts.refuter.sha256 },
    },
    minSupport: autoMerge.minSupport,
    calls,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    ...(unpriced.size > 0 ? { unpricedModels: [...unpriced].sort() } : {}),
    files: filesMeta,
    claims: claimRecords,
  });
}

export const verifierGate: Gate = {
  id: ID,
  title: 'LLM verifiers',
  rules: Object.values(VERIFIER_RULES),
  run: (context) => runVerifiers(context),
};
