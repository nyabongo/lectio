/**
 * Building gate results (`@lectio/schema/gate-result`, L-004). Gates report findings against
 * their rules and let {@link resultFromFindings} derive the status, so status and items always
 * agree: any `error` → `fail`; otherwise any `warning` → `flag`; otherwise `pass` (an `info`
 * item never changes the status).
 */
import type { GateResult, GateResultItem } from '@lectio/schema/gate-result';

import type { Rule, RuleBook } from './rules.ts';

export type { GateResult, GateResultItem };
export type GateStatus = GateResult['status'];
export type Severity = GateResultItem['severity'];

/** Where a finding points and what it says; the rule id comes from the rule. */
export interface FindingInput {
  /** Repository-relative path with forward slashes; omit for a finding about the whole PR. */
  readonly file?: string;
  /** RFC 6901 pointer into `file`; defaults to `""` (the whole file). */
  readonly pointer?: string;
  /** The claim the finding is about (`c3`), when there is one. */
  readonly claimId?: string;
  /** What is wrong here, specifically (the rule statement and fix are added by the renderers). */
  readonly message: string;
  /** Defaults to `error`. */
  readonly severity?: Severity;
}

/** One finding against `rule`. */
export function finding(rule: Rule, input: FindingInput): GateResultItem {
  return {
    ruleId: rule.id,
    severity: input.severity ?? 'error',
    ...(input.file === undefined ? {} : { file: input.file }),
    pointer: input.pointer ?? '',
    ...(input.claimId === undefined ? {} : { claimId: input.claimId }),
    message: input.message.trim(),
  };
}

/** The status the items imply. */
export function statusOf(items: readonly GateResultItem[]): Exclude<GateStatus, 'skipped'> {
  if (items.some((item) => item.severity === 'error')) return 'fail';
  if (items.some((item) => item.severity === 'warning')) return 'flag';
  return 'pass';
}

/** A result whose status is derived from its findings. */
export function resultFromFindings(
  gate: string,
  items: readonly GateResultItem[],
  meta: Record<string, unknown> = {},
): GateResult {
  return { gate, status: statusOf(items), items: [...items], meta };
}

/** A result for a gate that did not run, with the reason in `meta.reason`. */
export function skippedResult(gate: string, reason: string, meta: Record<string, unknown> = {}): GateResult {
  return { gate, status: 'skipped', items: [], meta: { ...meta, reason } };
}

/** The reason a skipped result gives, if any. */
export function skipReason(result: GateResult): string | undefined {
  const reason = result.meta['reason'];
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * A finding as plain text, with its rule statement and fix:
 *
 *     passages/MT.20.1-16.json#/claims/0 [c1] schema/claim-has-source: claim c1 cites no source
 *       Rule: Every claim cites at least one source.
 *       Fix: Add a source id to the claim's sourceIds.
 */
export function formatFinding(item: GateResultItem, rules: RuleBook): string {
  const where =
    item.file === undefined ? '(pull request)' : `${item.file}${item.pointer === '' ? '' : `#${item.pointer}`}`;
  const claim = item.claimId === undefined ? '' : ` [${item.claimId}]`;
  const lines = [`${where}${claim} ${item.ruleId} (${item.severity}): ${item.message}`];
  const rule = rules.get(item.ruleId);
  if (rule !== undefined) lines.push(`  Rule: ${rule.statement}`, `  Fix: ${rule.fix}`);
  return lines.join('\n');
}
