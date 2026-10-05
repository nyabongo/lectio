/**
 * @lectio/provider-gh: the `GitHubClient` (L-008) on the gh CLI. Consumers construct it
 * and inject it; it is not registered in `createProviders`.
 *
 * ```ts
 * const github = new GhGitHubClient({ repo: 'nyabongo/lectio' });
 * ```
 */
export const packageName = '@lectio/provider-gh';

export { GhGitHubClient, ISSUE_FIELDS, PR_FIELDS } from './client.ts';
export type { GhGitHubClientOptions } from './client.ts';
export { createGitRunner, createProcessExec, parseGitHubRemote } from './exec.ts';
export type { Exec, ExecOptions, ExecResult, GitRunner } from './exec.ts';
