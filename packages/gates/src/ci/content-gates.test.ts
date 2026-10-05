/**
 * content-gates.yml end to end on the fake GitHub: both approval paths from a pending passage to
 * main, the approval-commit rules, label transitions and the guards around protected paths.
 */
import { describe, expect, it } from 'vitest';

import type { FakeGitHubClient } from '@lectio/providers';

import { APPROVAL_WORKFLOW, formatApprovalTrailer } from '../merge-rule/index.ts';
import {
  AUTO_RESULTS,
  CLAIM_IDS,
  DETERMINISTIC_PASS,
  FLAGGED_RESULTS,
  PASSAGE,
  PASSAGE_TEXT,
  REGISTRY,
  REVIEWER,
  SCHEMA_FAIL,
  STRANGER,
  SUMMARY,
  lastDispatchedGatesRun,
  newRepo,
  openPr,
  pushContent,
  registryJobs,
  simulateRun,
} from './fixtures/content-gates.ts';
import { ACTIONS_BOT, runName } from './facts.ts';
import { runMergeJob } from './merge-job.ts';
import { DECISION_LABELS } from './merge-rule-job.ts';

const BRANCH = 'research/mt-20';

interface Review {
  status: string;
  method?: string;
  reviewers: string[];
  approvedVia?: string;
  verifierSummary?: unknown;
}

function reviewAt(bot: FakeGitHubClient, ref: string): Review {
  return (JSON.parse(bot.fileAt(ref, PASSAGE) as string) as { review: Review }).review;
}

async function decisionLabels(bot: FakeGitHubClient, number: number): Promise<string[]> {
  const pr = await bot.getPr(number);
  return pr.labels.filter((label) => (DECISION_LABELS as readonly string[]).includes(label));
}

/** Plays the run the merge-rule job dispatched on the approval commit. */
async function dispatchedRun(bot: FakeGitHubClient, number: number) {
  const run = await lastDispatchedGatesRun(bot);
  expect(run).not.toBeNull();
  return simulateRun(bot, number, { event: 'workflow_dispatch', results: DETERMINISTIC_PASS, run: run ?? undefined });
}

describe('content-gates: a pending passage reaches main approved', () => {
  it('(a) the author is the reviewer and adds the approved label', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER);

    const opened = await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    expect(opened.mergeRule).toMatchObject({ decision: 'needs-review', exitCode: 1, label: 'needs-review' });
    expect(bot.dispatches).toEqual([]);

    await bot.as(REVIEWER).addLabels(number, [CONFIG_LABEL]);
    const labeled = await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    expect(labeled.mergeRule).toMatchObject({ decision: 'human-approved', exitCode: 0, label: 'auto-merge-candidate' });
    const approvalSha = bot.headOf(BRANCH);
    expect(labeled.mergeRule.approvalCommitSha).toBe(approvalSha);

    // One signed bot commit on the decided head, with the review block and the trailer.
    const commit = await bot.getCommit(approvalSha);
    expect(commit).toMatchObject({ author: ACTIONS_BOT, verified: true, parents: [labeled.headSha] });
    expect(commit.message).toContain(
      formatApprovalTrailer({ kind: 'human', runId: String(labeled.run.id), head: labeled.headSha }),
    );
    expect(reviewAt(bot, approvalSha)).toMatchObject({
      status: 'approved',
      method: 'human',
      reviewers: [REVIEWER],
      approvedVia: 'label',
    });

    // Every registered workflow dispatched once on the head branch; content-gates gets the PR.
    expect(bot.dispatches.map((dispatch) => [dispatch.file, dispatch.ref, dispatch.sha])).toEqual(
      REGISTRY.workflows.map((workflow) => [workflow, BRANCH, approvalSha]),
    );
    expect(bot.dispatches.find((dispatch) => dispatch.file === APPROVAL_WORKFLOW)?.inputs).toEqual({
      pr: String(number),
    });

    const final = await dispatchedRun(bot, number);
    expect(final.headSha).toBe(approvalSha);
    expect(final.mergeRule).toMatchObject({ decision: 'approved-commit', exitCode: 0, dispatched: [] });
    expect(final.merge).toMatchObject({ merged: true, exitCode: 0, deployed: true });
    expect(bot.merges).toEqual([expect.objectContaining({ number, headSha: approvalSha, method: 'squash' })]);
    expect(reviewAt(bot, 'main')).toMatchObject({ status: 'approved', method: 'human', approvedVia: 'label' });
    expect(bot.dispatches.at(-1)).toMatchObject({ file: 'deploy.yml', ref: 'main' });
    expect(await decisionLabels(bot, number)).toEqual(['auto-merge-candidate']);
  });

  it('(b) the decision is auto-merge', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');

    const opened = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    expect(opened.mergeRule).toMatchObject({ decision: 'auto-merge', exitCode: 0, label: 'auto-merge-candidate' });
    const approvalSha = bot.headOf(BRANCH);
    const commit = await bot.getCommit(approvalSha);
    expect(commit.message).toContain(`Lectio-Approval: auto run=${String(opened.run.id)} head=${opened.headSha}`);
    expect(reviewAt(bot, approvalSha)).toEqual({
      status: 'approved',
      method: 'auto',
      reviewers: [],
      approvedVia: 'auto',
      lastReviewedAt: '2026-10-05T12:00:00Z',
      verifierSummary: SUMMARY,
    });

    const final = await dispatchedRun(bot, number);
    expect(final.mergeRule.decision).toBe('approved-commit');
    expect(final.merge?.merged).toBe(true);
    expect(reviewAt(bot, 'main')).toMatchObject({ method: 'auto', verifierSummary: SUMMARY });
    expect(bot.dispatches.filter((dispatch) => dispatch.file === 'deploy.yml')).toHaveLength(1);
  });

  it('merges only after the merge-rule check on the approval commit has finished', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    const approvalSha = bot.headOf(BRANCH);
    // The dispatched run has reported changes and deterministic, but merge-rule is still running.
    bot.setCheck(approvalSha, 'changes', 'success');
    bot.setCheck(approvalSha, 'deterministic', 'success');
    await expect(
      runMergeJob({ github: bot, prNumber: number, sha: approvalSha, log: () => undefined }),
    ).rejects.toThrow(/did not finish: merge-rule/);
    bot.setCheck(approvalSha, 'merge-rule', null);
    await expect(
      runMergeJob({ github: bot, prNumber: number, sha: approvalSha, log: () => undefined }),
    ).rejects.toThrow(/did not finish: merge-rule/);
    expect(bot.merges).toEqual([]);
    bot.setCheck(approvalSha, 'merge-rule', 'success');
    expect((await runMergeJob({ github: bot, prNumber: number, sha: approvalSha, log: () => undefined })).merged).toBe(
      true,
    );
  });

  it('every workflow in .github/required-checks/ reports on the approval commit', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    const approvalSha = bot.headOf(BRANCH);
    await dispatchedRun(bot, number);
    const { checks, ok } = await bot.waitForRequiredChecks({ sha: approvalSha });
    expect(ok).toBe(true);
    for (const [workflow, jobs] of Object.entries(registryJobs())) {
      expect(bot.dispatches.some((dispatch) => dispatch.file === workflow && dispatch.sha === approvalSha)).toBe(true);
      for (const job of jobs)
        expect(checks.find((check) => check.name === job)).toEqual({
          name: job,
          headSha: approvalSha,
          status: 'completed',
          conclusion: 'success',
        });
    }
  });

  it('dispatches exactly one round: the run on the approval commit dispatches nothing', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    const round = bot.dispatches.length;
    expect(round).toBe(REGISTRY.workflows.length);
    const run = await lastDispatchedGatesRun(bot);
    // Even with fresh green verifier results, the approval commit is not decided again.
    const final = await simulateRun(bot, number, {
      event: 'workflow_dispatch',
      results: AUTO_RESULTS,
      run: run ?? undefined,
    });
    expect(final.mergeRule).toMatchObject({ decision: 'approved-commit', dispatched: [] });
    expect(final.mergeRule.approvalCommitSha).toBeUndefined();
    expect(bot.dispatches.slice(round).map((dispatch) => dispatch.file)).toEqual(['deploy.yml']);
  });
});

const CONFIG_LABEL = 'approved';

describe('content-gates: approval commits', () => {
  /**
   * A PR whose head is a commit with `message`, pushed by `author` (`verified` as given) on top of
   * a content commit that no run has checked yet; `runId` is the PR's pull_request run on the
   * commit before it.
   */
  async function forged(message: (parent: string, runId: string) => string, author = ACTIONS_BOT, verified = true) {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const first = await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    await pushContent(bot, 'research-bot', BRANCH, PASSAGE_TEXT.replace('"summary": "', '"summary": "Edited. '));
    const parent = bot.headOf(BRANCH);
    await bot.as(author).pushCommit({
      branch: BRANCH,
      message: message(parent, String(first.run.id)),
      files: [{ path: 'passages/notes.txt', content: 'x' }],
      verified,
    });
    return { bot, number, parent, first };
  }

  const trailer = (parent: string, runId: string) => `Approve\n\nLectio-Approval: auto run=${runId} head=${parent}\n`;

  it.each([
    ['a wrong author', () => forged(trailer, REVIEWER, true), /not authored by github-actions\[bot\]/],
    ['an unsigned commit', () => forged(trailer, ACTIONS_BOT, false), /signature is not verified/],
    [
      'a trailer head that is not the parent',
      () => forged((_parent, runId) => trailer('f'.repeat(40), runId)),
      /is not the commit's parent/,
    ],
    ['a run id that does not exist', () => forged((parent) => trailer(parent, '123456789')), /no such run/],
    [
      'a pull_request run whose head is not the parent',
      () => forged((parent, runId) => trailer(parent, runId)),
      /pull_request run \d+ ran on/,
    ],
  ])('blocks a forged trailer: %s', async (_name, make, reason) => {
    const { bot, number } = await make();
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    expect(outcome.mergeRule).toMatchObject({ decision: 'blocked', exitCode: 1, label: 'gates-failed' });
    expect(outcome.mergeRule.summary).toMatch(reason);
    expect(outcome.merge).toBeNull();
    expect(bot.merges).toEqual([]);
  });

  it('blocks a trailer naming a run of another PR', async () => {
    const bot = newRepo();
    const other = await openPr(bot, 'research-bot', { 'passages/other.json': '{}' }, 'research/other');
    const otherRun = await simulateRun(bot, other, { event: 'pull_request', results: FLAGGED_RESULTS });
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    const parent = bot.headOf(BRANCH);
    await bot.pushCommit({
      branch: BRANCH,
      message: trailer(parent, String(otherRun.run.id)),
      files: [{ path: 'passages/notes.txt', content: 'x' }],
      verified: true,
    });
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    expect(outcome.mergeRule.decision).toBe('blocked');
    expect(outcome.mergeRule.summary).toContain(`belongs to PR #${String(other)}, not #${String(number)}`);
  });

  it('flagged → a reviewer comments /approve (issue_comment run) → a valid trailer → merged', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const flagged = await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    expect(await decisionLabels(bot, number)).toEqual(['needs-review']);
    expect(flagged.mergeRule.decision).toBe('needs-review');

    await bot.as(REVIEWER).postComment(number, '/approve');
    const approved = await simulateRun(bot, number, { event: 'issue_comment', results: DETERMINISTIC_PASS });
    expect(approved.run).toMatchObject({ event: 'issue_comment', prNumbers: [], displayTitle: runName(number) });
    expect(approved.mergeRule.decision).toBe('human-approved');
    expect(await decisionLabels(bot, number)).toEqual(['auto-merge-candidate']);
    const approvalSha = bot.headOf(BRANCH);
    expect((await bot.getCommit(approvalSha)).message).toContain(
      `Lectio-Approval: human run=${String(approved.run.id)} head=${approved.headSha}`,
    );
    expect(reviewAt(bot, approvalSha)).toMatchObject({
      method: 'human',
      approvedVia: 'comment',
      reviewers: [REVIEWER],
    });

    const final = await dispatchedRun(bot, number);
    expect(final.mergeRule.decision).toBe('approved-commit');
    expect(final.merge?.merged).toBe(true);
  });
});

describe('content-gates: labels and approvals', () => {
  it('fail → fixed → auto-merge', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const failed = await simulateRun(bot, number, { event: 'pull_request', results: SCHEMA_FAIL });
    expect(failed.mergeRule).toMatchObject({ decision: 'blocked', exitCode: 1 });
    expect(await decisionLabels(bot, number)).toEqual(['gates-failed']);
    expect(failed.mergeRule.summary).toContain('gates failed');

    await pushContent(bot, 'research-bot', BRANCH, PASSAGE_TEXT.replace('"summary": "', '"summary": "Fixed. '));
    const fixed = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    expect(fixed.mergeRule.decision).toBe('auto-merge');
    expect(await decisionLabels(bot, number)).toEqual(['auto-merge-candidate']);
  });

  it('ignores an approval from a handle that is not configured', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    await bot.as(STRANGER).addLabels(number, [CONFIG_LABEL]);
    await bot.as(STRANGER).postComment(number, '/approve');
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    expect(outcome.mergeRule).toMatchObject({ decision: 'needs-review', label: 'needs-review' });
    expect(outcome.mergeRule.summary).toContain(
      `@${STRANGER} via comment ignored: not a handle in config.reviewer.githubHandles`,
    );
    expect(bot.dispatches).toEqual([]);
  });

  it('an approval followed by a new content commit needs review again', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    await bot.as(REVIEWER).addLabels(number, [CONFIG_LABEL]);
    const approved = await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    expect(approved.mergeRule.decision).toBe('human-approved');

    // The author edits the content on top of the approval commit, keeping the approved block.
    const passage = JSON.parse(bot.fileAt(BRANCH, PASSAGE) as string) as { summary: string };
    passage.summary = `${passage.summary} Revised.`;
    await pushContent(bot, 'research-bot', BRANCH, `${JSON.stringify(passage, null, 2)}\n`);
    const edited = await simulateRun(bot, number, { event: 'pull_request', results: FLAGGED_RESULTS });
    expect(edited.mergeRule).toMatchObject({ decision: 'needs-review', label: 'needs-review' });
    expect(edited.mergeRule.summary).toMatch(
      /approval by @nyabongo via label ignored: given at .*, not after the last content commit/,
    );

    // A fresh approval after the edit approves again.
    await bot.as(REVIEWER).postComment(number, '/approve');
    const again = await simulateRun(bot, number, { event: 'issue_comment', results: DETERMINISTIC_PASS });
    expect(again.mergeRule.decision).toBe('human-approved');
  });

  it('a review block set to approved by the author is blocked', async () => {
    const bot = newRepo();
    const passage = JSON.parse(PASSAGE_TEXT) as Record<string, unknown>;
    passage['review'] = {
      status: 'approved',
      method: 'human',
      reviewers: [REVIEWER],
      approvedVia: 'cli',
      lastReviewedAt: '2026-10-05T09:00:00Z',
    };
    const number = await openPr(bot, 'research-bot', { [PASSAGE]: JSON.stringify(passage) });
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    expect(outcome.mergeRule.decision).toBe('blocked');
  });
});

describe('content-gates: protected paths', () => {
  const editedDecide = "export function decide() {\n  return { decision: 'auto-merge', reasons: [] };\n}\n";

  it('a PR that edits decide to always auto-merge does not change its own decision', async () => {
    const bot = newRepo({ 'packages/gates/src/merge-rule/index.ts': '// decide\n' });
    const number = await openPr(bot, 'research-bot', {
      [PASSAGE]: PASSAGE_TEXT,
      'packages/gates/src/merge-rule/index.ts': editedDecide,
    });
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    // The tooling's decide ran (from this checkout); the PR's copy was only data.
    expect(outcome.mergeRule).toMatchObject({ decision: 'needs-review', label: 'needs-review' });
    expect(outcome.mergeRule.summary).toContain('packages/gates/src/merge-rule/index.ts is under packages/gates/**');
    expect(bot.dispatches).toEqual([]);
  });

  it.each([['packages/gates/src/x.ts'], ['.github/workflows/content-gates.yml'], ['config/lectio.config.json']])(
    'a PR touching %s with perfect verifier scores needs review',
    async (path) => {
      const bot = newRepo();
      const number = await openPr(bot, 'research-bot', { [PASSAGE]: PASSAGE_TEXT, [path]: 'x\n' });
      const outcome = await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
      expect(outcome.mergeRule.decision).toBe('needs-review');
      expect(bot.dispatches).toEqual([]);
    },
  );

  it('never writes an approval commit, dispatches or merges for a .github/** PR, even when approved', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER, { [PASSAGE]: PASSAGE_TEXT, '.github/workflows/x.yml': 'on: push\n' });
    await simulateRun(bot, number, { event: 'pull_request', results: AUTO_RESULTS });
    await bot.as(REVIEWER).addLabels(number, [CONFIG_LABEL]);
    const head = bot.headOf(BRANCH);
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: DETERMINISTIC_PASS });
    expect(outcome.mergeRule).toMatchObject({
      decision: 'human-approved',
      manualMerge: true,
      exitCode: 0,
      label: 'needs-review',
      dispatched: [],
    });
    expect(outcome.mergeRule.summary).toContain('a maintainer merges it by hand');
    expect(bot.headOf(BRANCH)).toBe(head);
    expect(outcome.merge).toBeNull();
    // Even if asked directly, the merge job refuses.
    const merge = await runMergeJob({ github: bot, prNumber: number, sha: head, log: () => undefined });
    expect(merge).toEqual({ merged: false, exitCode: 1, deployed: false });
    expect(bot.merges).toEqual([]);
  });
});

describe('content-gates: claims', () => {
  it('needs a verifier record for every claim before auto-merging', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const partial = AUTO_RESULTS.map((result) =>
      result.gate === 'verifiers'
        ? {
            ...result,
            meta: {
              ...result.meta,
              claims: (result.meta['claims'] as { claimId: string }[]).slice(0, CLAIM_IDS.length - 1),
            },
          }
        : result,
    );
    const outcome = await simulateRun(bot, number, { event: 'pull_request', results: partial });
    expect(outcome.mergeRule.decision).toBe('needs-review');
    expect(outcome.mergeRule.summary).toContain('claim c5');
  });
});
