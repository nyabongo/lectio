/**
 * The findings fix-up mode feeds back into the repair loop. Their text goes verbatim into the
 * repair prompt, so they come only from the CI bot's own gate output, never from what anyone can
 * write on a PR:
 *
 * - the sticky gates comment, accepted only when its author is the workflow bot
 *   (`github-actions[bot]`) and it starts with the `<!-- lectio-gates -->` marker line; or
 * - the `gates.json` workflow artifact, downloaded by the owner (`gh run download`) and passed
 *   with `--report`.
 *
 * Only findings fix-up can act on are kept: verifier refutations and low support on a claim of
 * the PR's passage file. Gates 1–3 are re-run locally anyway, and a sensitive-claim flag is for a
 * person to judge, not for a repair to talk away.
 */
import { COMMENT_MARKER_LINE } from '@lectio/gates';
import type { GateResultItem } from '@lectio/gates';
import type { IssueComment } from '@lectio/providers';
import { validateGateResult } from '@lectio/schema/gate-result';

/** The login the content-gates workflow comments as. */
export const GATES_BOT = 'github-actions[bot]';

/** Rules whose findings a repair can address. */
export const FIXUP_RULES: readonly string[] = ['verifiers/claim-not-refuted', 'verifiers/claim-supported'];

/** The gate findings a fix-up starts from. */
export interface GateFindings {
  /** Where they came from, for the report. */
  readonly source: string;
  /** The head the gates ran on, when the output names it. */
  readonly head: string | null;
  readonly findings: readonly GateResultItem[];
  /** True when the comment left findings out for its size limit (the artifact has them all). */
  readonly truncated: boolean;
}

/** A malformed or untrusted gate output. */
export class GateOutputError extends Error {
  override readonly name = 'GateOutputError';
}

/** The bot's latest gates comment, or `undefined`. Comments by anyone else are ignored, marker or not. */
export function latestGatesComment(
  comments: readonly IssueComment[],
  bot: string = GATES_BOT,
): IssueComment | undefined {
  return comments
    .filter((comment) => comment.author === bot && comment.body.startsWith(COMMENT_MARKER_LINE))
    .reduce<IssueComment | undefined>(
      (latest, comment) => (latest === undefined || comment.updatedAt >= latest.updatedAt ? comment : latest),
      undefined,
    );
}

const FINDING = /^- \*\*(error|warning|info)\*\* · `([^`]*)` \((.*?)\)(?: at `([^`]*)`)?: (.*)$/u;
const FILE_HEADING = /^#### `([^`]*)`$/u;
const CLAIM_HEADING = /^\*\*Claim `([^`]*)`\*\*$/u;
/** The hidden head marker of the content-gates comment (#209): `<!-- lectio-gates-head: <sha> -->`. */
export const HEAD_MARKER = /<!-- lectio-gates-head: (\S+) -->/u;
/** The visible head line of the same comment: ``Checked head: `<sha>` ``. */
export const HEAD_LINE = /^Checked head: `([^`]+)`/u;

const unescape = (text: string): string => text.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');

/** Reads the findings back out of a rendered gates comment (`renderComment` in `@lectio/gates`). */
export function parseGatesComment(body: string): Omit<GateFindings, 'source'> {
  let file: string | undefined;
  let claimId: string | undefined;
  let marker: string | undefined;
  let visible: string | undefined;
  let truncated = false;
  const findings: GateResultItem[] = [];
  for (const line of body.split('\n')) {
    const fileMatch = FILE_HEADING.exec(line);
    if (fileMatch !== null || line === '#### Pull request') {
      file = fileMatch?.[1];
      claimId = undefined;
      continue;
    }
    const claimMatch = CLAIM_HEADING.exec(line);
    if (claimMatch !== null || line === '**Whole file**') {
      claimId = claimMatch?.[1];
      continue;
    }
    const match = FINDING.exec(line);
    if (match !== null) {
      findings.push({
        ruleId: match[2] as string,
        severity: match[1] as GateResultItem['severity'],
        ...(file === undefined ? {} : { file }),
        pointer: match[4] ?? '',
        ...(claimId === undefined ? {} : { claimId }),
        message: unescape(match[5] as string),
      });
      continue;
    }
    if (line.includes('not shown (comment size limit)')) truncated = true;
    marker = HEAD_MARKER.exec(line)?.[1] ?? marker;
    visible = HEAD_LINE.exec(line)?.[1] ?? visible;
  }
  // Both name the head; when they disagree the comment does not say which head it is about.
  const head = marker !== undefined && visible !== undefined && marker !== visible ? null : (marker ?? visible ?? null);
  return { head, findings, truncated };
}

/** The findings of a `gates.json` report (the content-gates workflow artifact). */
export function parseGatesReport(text: string, file: string): Omit<GateFindings, 'source'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new GateOutputError(`${file}: not valid JSON (${(error as Error).message})`);
  }
  const report = parsed as { results?: unknown; head?: unknown } | null;
  const results = report?.results;
  if (!Array.isArray(results)) throw new GateOutputError(`${file}: expected a gate report with a "results" array`);
  const findings = results.flatMap((result: unknown, index) => {
    if (!validateGateResult(result)) {
      throw new GateOutputError(`${file}: results/${String(index)} is not a valid gate result`);
    }
    return result.items;
  });
  return { head: typeof report?.head === 'string' ? report.head : null, findings, truncated: false };
}

/** The findings a fix-up of `path` acts on. */
export function fixupFindings(findings: readonly GateResultItem[], path: string): GateResultItem[] {
  return findings.filter((item) => FIXUP_RULES.includes(item.ruleId) && item.file === path && item.severity !== 'info');
}

/**
 * Whether gate output is about the PR's current head: `current`, `stale` (another head), or
 * `unknown` when the output names no head or something that is not a full commit sha. Fix-up treats
 * `unknown` like `stale`: it fails closed.
 */
export type HeadCheck = 'current' | 'stale' | 'unknown';

export function checkHead(head: string | null, headSha: string): HeadCheck {
  if (head === null || !/^[0-9a-f]{40}$/u.test(head)) return 'unknown';
  return head === headSha ? 'current' : 'stale';
}
