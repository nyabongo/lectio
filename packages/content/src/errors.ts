import type { ErrorObject } from '@lectio/schema/common';

/** One problem in a content file, located by an RFC 6901 JSON pointer (`""` is the whole file). */
export interface ContentIssue {
  readonly pointer: string;
  readonly message: string;
}

/**
 * A content file that cannot be read, parsed or validated. `file` is the path the caller
 * works with (repository-relative for `openRepo`); `pointer` and `message` describe the first
 * problem and `issues` lists every one.
 */
export class ContentError extends Error {
  readonly file: string;
  readonly pointer: string;
  readonly issues: readonly ContentIssue[];

  constructor(file: string, issues: readonly [ContentIssue, ...ContentIssue[]]) {
    super(issues.map((issue) => formatIssue(file, issue)).join('\n'));
    this.name = 'ContentError';
    this.file = file;
    this.issues = issues;
    this.pointer = issues[0].pointer;
  }
}

/** `<file>#<pointer>: <message>`, or `<file>: <message>` for the whole file. */
export function formatIssue(file: string, issue: ContentIssue): string {
  return `${file}${issue.pointer === '' ? '' : `#${issue.pointer}`}: ${issue.message}`;
}

/** Escapes one JSON pointer segment (RFC 6901). */
export function pointerSegment(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function toIssue(error: ErrorObject): ContentIssue {
  const { params } = error;
  if (error.keyword === 'additionalProperties') {
    const key = String(params.additionalProperty);
    return { pointer: `${error.instancePath}/${pointerSegment(key)}`, message: 'unknown field' };
  }
  if (error.keyword === 'required') {
    const key = String(params.missingProperty);
    return { pointer: `${error.instancePath}/${pointerSegment(key)}`, message: 'is required' };
  }
  if (error.keyword === 'propertyNames') {
    const key = String(params.propertyName);
    return { pointer: `${error.instancePath}/${pointerSegment(key)}`, message: 'field name is not allowed' };
  }
  if (error.keyword === 'enum') {
    const allowed = (params.allowedValues as unknown[]).map((value) => JSON.stringify(value)).join(', ');
    return { pointer: error.instancePath, message: `must be one of ${allowed}` };
  }
  return { pointer: error.instancePath, message: String(error.message) };
}

/**
 * ajv errors as content issues, one per distinct pointer and message. Errors that only restate
 * another are dropped: `if` (a conditional branch failed; the branch's own error is kept) and
 * the inner errors of `propertyNames` (the outer one names the field). Never empty: with
 * nothing left it reports the whole file as invalid.
 */
export function issuesFromAjv(errors: readonly ErrorObject[] | null | undefined): [ContentIssue, ...ContentIssue[]] {
  const seen = new Set<string>();
  const issues: ContentIssue[] = [];
  for (const error of errors ?? []) {
    if (error.keyword === 'if' || error.propertyName !== undefined) continue;
    const issue = toIssue(error);
    const id = `${issue.pointer}\u0000${issue.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    issues.push(issue);
  }
  const [first = { pointer: '', message: 'does not match the schema' }, ...rest] = issues;
  return [first, ...rest];
}
