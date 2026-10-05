/**
 * The rule registry. Every finding a gate reports names a rule; each rule has a stable id
 * (`<gate>/<rule>`, e.g. `schema/claim-has-source`), a one-line statement of what must hold and
 * a "how to fix" text. Failure messages, the PR comment and the gate docs (L-043) all read them
 * from here, so a rule is explained the same way everywhere.
 */
import { RULE_ID_PATTERN } from '@lectio/schema/gate-result';

export interface Rule {
  /** `<gate>/<rule>` in kebab-case. */
  readonly id: string;
  /** One line: what must hold. */
  readonly statement: string;
  /** What an author does to make the rule pass. */
  readonly fix: string;
}

const RULE_ID = new RegExp(RULE_ID_PATTERN);

/** Declares a rule, checking the id shape and that both texts are present. */
export function defineRule(id: string, statement: string, fix: string): Rule {
  if (!RULE_ID.test(id)) throw new RangeError(`rule id must look like <gate>/<rule> in kebab-case, got "${id}"`);
  if (statement.trim() === '') throw new RangeError(`rule ${id} needs a statement`);
  if (fix.trim() === '') throw new RangeError(`rule ${id} needs a "how to fix" text`);
  return Object.freeze({ id, statement: statement.trim(), fix: fix.trim() });
}

/** The gate a rule id belongs to: `schema/claim-has-source` → `schema`. */
export function gateOfRule(ruleId: string): string {
  return ruleId.slice(0, ruleId.indexOf('/'));
}

/** Rules by id. */
export type RuleBook = ReadonlyMap<string, Rule>;

/**
 * Builds a rule book from rule lists. Throws on a duplicate id, and on a rule whose prefix is not
 * one of `owners` when `owners` is given (each gate owns the rules under its own id).
 */
export function createRuleBook(rules: Iterable<Rule>, owners?: ReadonlySet<string>): RuleBook {
  const book = new Map<string, Rule>();
  for (const rule of rules) {
    if (book.has(rule.id)) throw new RangeError(`duplicate rule id ${rule.id}`);
    if (owners !== undefined && !owners.has(gateOfRule(rule.id))) {
      throw new RangeError(`rule ${rule.id} does not belong to any of: ${[...owners].join(', ')}`);
    }
    book.set(rule.id, rule);
  }
  return book;
}

/** The id the runner reports under when a gate itself goes wrong. */
export const RUNNER_GATE_ID = 'runner';

/** Rules the runner reports itself; they are part of every rule book the registry builds. */
export const RUNNER_RULES = {
  crashed: defineRule(
    'runner/gate-crashed',
    'A gate must finish and report a result; it never throws.',
    'Read the error in the message, fix the gate or the input that broke it, and re-run the gates.',
  ),
  invalidResult: defineRule(
    'runner/invalid-result',
    'A gate result must match the gate-result schema and carry the id of the gate that produced it.',
    'Fix the gate so its result validates (`@lectio/schema/gate-result`): status and items must agree.',
  ),
  unknownRule: defineRule(
    'runner/unknown-rule',
    'Every finding must name a rule that its gate declares.',
    'Declare the rule in the gate with defineRule, or correct the rule id in the finding.',
  ),
  reportMissing: defineRule(
    'runner/report-missing',
    'A gate job that ran hands its report to the merge rule; a missing report never counts as a pass.',
    'Re-run the content gates; if the report is still missing, check that the job uploads it where the merge rule reads it.',
  ),
  regularFiles: defineRule(
    'runner/regular-files',
    'Every file a PR adds or changes is a regular file: symbolic links and submodules are refused, and no gate reads them.',
    'Replace the link or submodule with the file itself, or remove it from the PR.',
  ),
} as const;
