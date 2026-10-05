/**
 * What the merge rule knows about a pull request (`decide({ results, config, pr })`, L-028),
 * assembled by the CI job (L-031) or read from `lectio-gates decide --pr <file>`.
 *
 * These are the canonical shapes. They live in `core/` so the CLI and the CI job share them;
 * the merge rule (`src/merge-rule`) should import them from here.
 */

/**
 * A reviewer's approval on the PR, per [decision 003](../../../../docs/decisions/003-auto-merge.md):
 * an `approved` label or a `/approve` comment. A local `review:approve` run (`approvedVia: cli`)
 * is not a PR approval, so `cli` is deliberately not a channel here.
 */
export interface PullRequestApproval {
  readonly handle: string;
  readonly via: 'label' | 'comment';
  /** ISO timestamp of the label or comment event. */
  readonly at: string;
}

/** The head commit when it carries a `Lectio-Approval` trailer. */
export interface ApprovalCommit {
  readonly kind: 'human' | 'auto';
  readonly runId: string;
  readonly trailerHead: string;
  readonly parentSha: string;
  readonly authorIsBot: boolean;
  readonly signatureVerified: boolean;
  readonly run: {
    readonly workflow: string;
    readonly prNumber: number;
    readonly event: string;
    readonly headSha: string;
  };
}

export interface PullRequestFacts {
  /** The PR number; an approval commit is valid only if its run belongs to this PR. */
  readonly number: number;
  /** Every changed path, repository-relative. */
  readonly files: readonly string[];
  /** Files whose review block the PR changes. */
  readonly reviewEdits: readonly string[];
  readonly approval: PullRequestApproval | null;
  readonly approvalCommit: ApprovalCommit | null;
  /** ISO timestamp of the last commit that changed content (approval commits excluded). */
  readonly lastContentCommitAt: string | null;
  readonly fork: boolean;
}

type Check = (value: unknown) => boolean;

const isString: Check = (value) => typeof value === 'string';
const isBoolean: Check = (value) => typeof value === 'boolean';
const isPrNumber: Check = (value) => Number.isInteger(value) && (value as number) > 0;
const isStringArray: Check = (value) => Array.isArray(value) && value.every(isString);
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const oneOf =
  (...options: readonly string[]): Check =>
  (value) =>
    options.includes(value as string);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Problems with `value` against `shape`, as `<path>: expected <field description>`. */
function problems(value: Record<string, unknown>, shape: Readonly<Record<string, Check>>, prefix: string): string[] {
  return Object.entries(shape)
    .filter(([key, check]) => !check(value[key]))
    .map(([key]) => `${prefix}${key}: missing or of the wrong type`);
}

const RUN_SHAPE = { workflow: isString, prNumber: isPrNumber, event: isString, headSha: isString };
const APPROVAL_SHAPE = { handle: isString, via: oneOf('label', 'comment'), at: isString };
const COMMIT_SHAPE = {
  kind: oneOf('human', 'auto'),
  runId: isString,
  trailerHead: isString,
  parentSha: isString,
  authorIsBot: isBoolean,
  signatureVerified: isBoolean,
  run: isObject,
};
const FACTS_SHAPE = {
  number: isPrNumber,
  files: isStringArray,
  reviewEdits: isStringArray,
  approval: nullable(isObject),
  approvalCommit: nullable(isObject),
  lastContentCommitAt: nullable(isString),
  fork: isBoolean,
};

/** Every problem that keeps `value` from being {@link PullRequestFacts}; empty when it is one. */
export function pullRequestFactsProblems(value: unknown): string[] {
  if (!isObject(value)) return ['expected a JSON object'];
  const found = problems(value, FACTS_SHAPE, '');
  const { approval, approvalCommit } = value;
  if (isObject(approval)) found.push(...problems(approval, APPROVAL_SHAPE, 'approval.'));
  if (isObject(approvalCommit)) {
    found.push(...problems(approvalCommit, COMMIT_SHAPE, 'approvalCommit.'));
    const { run } = approvalCommit;
    if (isObject(run)) found.push(...problems(run, RUN_SHAPE, 'approvalCommit.run.'));
  }
  return found;
}

/** `value` as {@link PullRequestFacts}; throws a `TypeError` listing every problem. */
export function parsePullRequestFacts(value: unknown): PullRequestFacts {
  const found = pullRequestFactsProblems(value);
  if (found.length > 0) throw new TypeError(`not valid pull request facts: ${found.join('; ')}`);
  return value as PullRequestFacts;
}
