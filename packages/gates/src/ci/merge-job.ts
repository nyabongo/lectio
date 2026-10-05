/**
 * The `merge` job of content-gates.yml. Not a required check (so not in the registry); it runs in
 * the same run after `merge-rule`, and only when that job returned `approved-commit` for a PR that
 * is not merged by hand.
 *
 * It waits for every required check in the registry on the approval commit
 * (`waitForRequiredChecks`), squash-merges with `--match-head-commit <sha>`, then dispatches
 * `deploy.yml` on the base branch (a notice until deploy.yml exists, L-062). It re-checks what it
 * can before merging: the PR is open, same-repository, still at `sha`, and changes no `.github/**`
 * file (those are always merged by a maintainer).
 */
import { ProviderError } from '@lectio/providers';
import type { GitHubClient } from '@lectio/providers';

import { needsManualMerge } from '../merge-rule/index.ts';

export const DEPLOY_WORKFLOW = 'deploy.yml';

export interface MergeJobInput {
  readonly github: GitHubClient;
  readonly prNumber: number;
  /** The approval commit merge-rule decided on. */
  readonly sha: string;
  readonly log: (line: string) => void;
  /** Passed to `waitForRequiredChecks`; default: the client's own. */
  readonly timeoutMs?: number;
}

export interface MergeJobOutcome {
  readonly merged: boolean;
  readonly exitCode: number;
  readonly mergeSha?: string;
  readonly deployed: boolean;
}

const refuse = (log: (line: string) => void, message: string): MergeJobOutcome => {
  log(`merge: not merging: ${message}`);
  return { merged: false, exitCode: 1, deployed: false };
};

export async function runMergeJob(input: MergeJobInput): Promise<MergeJobOutcome> {
  const { github, prNumber, sha, log } = input;
  const pr = await github.getPr(prNumber);
  if (pr.state !== 'open') return refuse(log, `#${String(prNumber)} is ${pr.state}`);
  if (pr.fork) return refuse(log, 'a fork PR is merged by a maintainer');
  if (pr.headSha !== sha) return refuse(log, `the head is ${pr.headSha}, not the approval commit ${sha}`);
  const files = (await github.getPrFiles(prNumber)).flatMap((file) =>
    file.previousPath === undefined ? [file.path] : [file.previousPath, file.path],
  );
  if (needsManualMerge(files)) return refuse(log, 'the PR changes .github/**; a maintainer merges it by hand');

  const checks = await github.waitForRequiredChecks({
    sha,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  if (!checks.ok) {
    const failed = checks.checks.filter(
      (check) => !['success', 'neutral', 'skipped'].includes(String(check.conclusion)),
    );
    return refuse(log, `required checks failed on ${sha}: ${failed.map((check) => check.name).join(', ')}`);
  }
  const { sha: mergeSha } = await github.mergePr(prNumber, { matchHeadSha: sha, method: 'squash' });
  log(`merge: merged #${String(prNumber)} at ${sha} as ${mergeSha}`);
  try {
    await github.dispatchWorkflow(DEPLOY_WORKFLOW, pr.base);
    log(`merge: dispatched ${DEPLOY_WORKFLOW} on ${pr.base}`);
    return { merged: true, exitCode: 0, mergeSha, deployed: true };
  } catch (error) {
    if (!(error instanceof ProviderError) || error.code !== 'not-found') throw error;
    log(`::notice::${DEPLOY_WORKFLOW} does not exist yet (L-062); nothing to deploy`);
    return { merged: true, exitCode: 0, mergeSha, deployed: false };
  }
}
