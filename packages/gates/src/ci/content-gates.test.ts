/**
 * The content gates end to end on the fake GitHub: the PR-side content-checks.yml and the trusted
 * content-gates.yml (main's copy). Both approval paths from a pending passage to main, the
 * approval-commit rules, label transitions and the guards around protected paths and symlinks.
 */
import { describe, expect, it } from 'vitest';

import type { FakeGitHubClient, WorkflowRun } from '@lectio/providers';

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
  contentChecksRun,
  dispatchedChecksReport,
  lastDispatchedGatesRun,
  newRepo,
  openPr,
  pushContent,
  REQUIRED_CHECKS,
  registryJobs,
  simulateRun,
} from './fixtures/content-gates.ts';
import { ACTIONS_BOT, CHECKS_WORKFLOW, approvalArtifactName } from './facts.ts';
import { runMergeJob } from './merge-job.ts';
import { DECISION_LABELS, MERGE_RULE_CHECK, headMarker } from './merge-rule-job.ts';

const BRANCH = 'research/mt-20';
const APPROVED = 'approved';

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

/** The merge-rule check published last on `sha`. */
function mergeRuleCheck(bot: FakeGitHubClient, sha: string) {
  return bot.publishedChecks.filter((check) => check.name === MERGE_RULE_CHECK && check.headSha === sha).at(-1);
}

/** Plays the dispatched PR-side run and the dispatched trusted run on the approval commit. */
async function dispatchedRun(bot: FakeGitHubClient, number: number) {
  dispatchedChecksReport(bot, bot.headOf(BRANCH));
  const run = await lastDispatchedGatesRun(bot);
  expect(run).toMatchObject({ event: 'workflow_dispatch', headBranch: 'main' });
  return simulateRun(bot, number, { event: 'workflow_dispatch', results: DETERMINISTIC_PASS, run: run ?? undefined });
}

describe('content gates: a pending passage reaches main approved', () => {
  it('(a) the author is the reviewer and adds the approved label', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER);

    const opened = await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
    expect(opened.mergeRule).toMatchObject({ decision: 'needs-review', exitCode: 1, label: 'needs-review' });
    expect(mergeRuleCheck(bot, opened.headSha)).toMatchObject({ conclusion: 'failure', title: 'needs-review' });
    // The sticky comment keeps the lectio-gates marker first and names the head it was written for.
    const [comment] = await bot.listComments(number);
    expect(comment?.author).toBe(ACTIONS_BOT);
    expect(comment?.body.startsWith('<!-- lectio-gates -->\n')).toBe(true);
    expect(comment?.body).toContain(`Checked head: \`${opened.headSha}\` ${headMarker(opened.headSha)}`);
    expect(opened.mergeRule.report).toMatchObject({ head: opened.headSha, decision: { decision: 'needs-review' } });
    expect(bot.dispatches).toEqual([]);

    await bot.as(REVIEWER).addLabels(number, [APPROVED]);
    const labeled = await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    expect(labeled.mergeRule).toMatchObject({ decision: 'human-approved', exitCode: 0, label: 'auto-merge-candidate' });
    const approvalSha = bot.headOf(BRANCH);
    expect(labeled.mergeRule.approvalCommitSha).toBe(approvalSha);
    expect(await bot.listRunArtifacts(labeled.run.id)).toEqual([approvalArtifactName(number, approvalSha)]);
    expect(mergeRuleCheck(bot, labeled.headSha)).toMatchObject({ conclusion: 'success', actor: ACTIONS_BOT });

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

    // Every registered workflow dispatched once on the head branch, then the trusted one on main.
    expect(bot.dispatches.map((dispatch) => [dispatch.file, dispatch.ref])).toEqual([
      ...REGISTRY.workflows.map((workflow) => [workflow, BRANCH]),
      [APPROVAL_WORKFLOW, 'main'],
    ]);
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

    const opened = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
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
    await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    const approvalSha = bot.headOf(BRANCH);
    dispatchedChecksReport(bot, approvalSha);
    const merge = () => runMergeJob({ github: bot, prNumber: number, sha: approvalSha, log: () => undefined });
    await expect(merge()).rejects.toThrow(/did not finish: merge-rule/);
    bot.setCheck(approvalSha, MERGE_RULE_CHECK, null);
    await expect(merge()).rejects.toThrow(/did not finish: merge-rule/);
    expect(bot.merges).toEqual([]);
    await bot.createCheckRun({
      name: MERGE_RULE_CHECK,
      headSha: approvalSha,
      conclusion: 'success',
      title: '',
      summary: '',
    });
    expect((await merge()).merged).toBe(true);
  });

  it('every workflow in .github/required-checks/ reports on the approval commit', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    const approvalSha = bot.headOf(BRANCH);
    await dispatchedRun(bot, number);
    const { checks, ok } = await bot.waitForRequiredChecks({ sha: approvalSha });
    expect(ok).toBe(true);
    for (const [workflow, jobs] of Object.entries(registryJobs())) {
      expect(bot.dispatches.some((dispatch) => dispatch.file === workflow)).toBe(true);
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
    await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    const round = bot.dispatches.length;
    expect(round).toBe(REGISTRY.workflows.length + 1);
    dispatchedChecksReport(bot, bot.headOf(BRANCH));
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
    // A second trusted run on the same commit (workflow_run of the dispatched check) finds it merged.
    const again = await runMergeJob({ github: bot, prNumber: number, sha: final.headSha, log: () => undefined });
    expect(again).toEqual({ merged: false, exitCode: 0, deployed: false });
  });
});

describe('content gates: approval commits', () => {
  /** Names the artifact the writer run uploads for the pushed commit (none when absent). */
  type Artifact = (number: number, commit: string) => string;
  interface Writer {
    readonly run: (bot: FakeGitHubClient, number: number, parent: string) => WorkflowRun;
    readonly artifact?: Artifact;
  }

  /** A trusted-looking run of content-gates.yml, `overrides` applied, with no artifact unless given. */
  const writerRun = (overrides: Partial<WorkflowRun> = {}, artifact?: Artifact): Writer => ({
    ...(artifact === undefined ? {} : { artifact }),
    run: (bot) => {
      const run = bot.addWorkflowRun({
        workflowFile: APPROVAL_WORKFLOW,
        event: 'workflow_run',
        headSha: bot.headOf('main'),
        headBranch: 'main',
        prNumbers: [],
        status: 'completed',
        conclusion: 'success',
        actor: 'someone',
        ...overrides,
      });
      return run;
    },
  });
  const validArtifact: Artifact = (number, commit) => approvalArtifactName(number, commit);

  /** A PR whose head is a commit with an approval trailer naming `writer`'s run, pushed by `author`. */
  async function forged(writer: Writer, options: { author?: string; verified?: boolean; head?: string } = {}) {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
    const parent = bot.headOf(BRANCH);
    const run = writer.run(bot, number, parent);
    const commit = await bot.as(options.author ?? ACTIONS_BOT).pushCommit({
      branch: BRANCH,
      message: `Approve\n\n${formatApprovalTrailer({ kind: 'auto', runId: String(run.id), head: options.head ?? parent })}\n`,
      files: [{ path: 'passages/notes.txt', content: 'x' }],
      verified: options.verified ?? true,
    });
    if (writer.artifact !== undefined) bot.addRunArtifact(run.id, writer.artifact(number, commit.sha));
    return { bot, number };
  }

  it('accepts a trusted run that uploaded the approval artifact for this PR and this commit', async () => {
    const { bot, number } = await forged(writerRun({}, validArtifact));
    for (const check of REQUIRED_CHECKS) bot.setCheck(bot.headOf(BRANCH), check, 'success');
    const outcome = await simulateRun(bot, number, { event: 'workflow_dispatch', results: DETERMINISTIC_PASS });
    expect(outcome.mergeRule.decision).toBe('approved-commit');
    expect(outcome.merge?.merged).toBe(true);
  });

  it.each<[string, () => ReturnType<typeof forged>, RegExp]>([
    [
      'a wrong author',
      () => forged(writerRun({}, validArtifact), { author: REVIEWER, verified: true }),
      /not authored by github-actions\[bot\]/,
    ],
    [
      'an unsigned commit',
      () => forged(writerRun({}, validArtifact), { verified: false }),
      /signature is not verified/,
    ],
    [
      'a trailer head that is not the parent',
      () => forged(writerRun({}, validArtifact), { head: 'f'.repeat(40) }),
      /is not the commit's parent/,
    ],
    ['a run id that does not exist', () => forged({ run: () => ({ id: 123456789 }) as WorkflowRun }), /no such run/],
    ['a trusted run without the approval artifact', () => forged(writerRun()), /belongs to PR #0/],
    [
      'a trusted run whose artifact names another PR',
      () => forged(writerRun({}, (_n, commit) => approvalArtifactName(999, commit))),
      /belongs to PR #0/,
    ],
    [
      'a trusted run whose artifact names another commit',
      () => forged(writerRun({}, (n) => approvalArtifactName(n, 'e'.repeat(40)))),
      /belongs to PR #0/,
    ],
    [
      'a pull_request run of a PR copy of content-gates.yml, even with the artifact and the PR listed',
      () =>
        forged({
          artifact: validArtifact,
          run: (bot, number, parent) =>
            writerRun({ event: 'pull_request', prNumbers: [number], headSha: parent, headBranch: BRANCH }).run(
              bot,
              number,
              parent,
            ),
        }),
      /belongs to PR #0/,
    ],
    [
      'a dispatch run on a foreign branch (not main’s copy)',
      () => forged(writerRun({ event: 'workflow_dispatch', headBranch: 'attacker/branch' }, validArtifact)),
      /belongs to PR #0/,
    ],
    [
      'a run whose title names this PR (titles are never trusted)',
      () =>
        forged(
          writerRun({
            event: 'workflow_dispatch',
            headBranch: 'attacker/branch',
            displayTitle: 'Content gates · PR #1',
          }),
        ),
      /belongs to PR #0/,
    ],
    [
      'a run of another workflow',
      () => forged(writerRun({ workflowFile: CHECKS_WORKFLOW }, validArtifact)),
      /is a content-checks.yml run, not content-gates.yml/,
    ],
  ])('blocks a forged trailer: %s', async (_name, make, reason) => {
    const { bot, number } = await make();
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    expect(outcome.mergeRule).toMatchObject({ decision: 'blocked', exitCode: 1, label: 'gates-failed' });
    expect(outcome.mergeRule.summary).toMatch(reason);
    expect(outcome.merge).toBeNull();
    expect(bot.merges).toEqual([]);
  });

  it('blocks a spoofed title that targets another PR: a run of PR A cannot approve PR B', async () => {
    const bot = newRepo();
    const victim = await openPr(bot, 'research-bot');
    await simulateRun(bot, victim, { event: 'workflow_run', results: FLAGGED_RESULTS });
    const other = await openPr(bot, 'research-bot', { 'passages/other.json': '{}' }, 'research/other');
    // A legitimate trusted run for the other PR, whose title claims the victim.
    const run = writerRun({ displayTitle: `Content gates · PR #${String(victim)}` }).run(bot, victim, '');
    const commit = await bot.pushCommit({
      branch: BRANCH,
      message: `x\n\n${formatApprovalTrailer({ kind: 'auto', runId: String(run.id), head: bot.headOf(BRANCH) })}\n`,
      files: [{ path: 'passages/notes.txt', content: 'x' }],
      verified: true,
    });
    bot.addRunArtifact(run.id, approvalArtifactName(other, commit.sha));
    const outcome = await simulateRun(bot, victim, { event: 'workflow_run', results: AUTO_RESULTS });
    expect(outcome.mergeRule.decision).toBe('blocked');
    expect(outcome.mergeRule.summary).toContain(`belongs to PR #0, not #${String(victim)}`);
  });

  it('blocks a forged commit with the same parent and run id but another tree, force-pushed over the approval', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const approved = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    const legit = await bot.getCommit(bot.headOf(BRANCH));
    expect(await bot.listRunArtifacts(approved.run.id)).toEqual([approvalArtifactName(number, legit.sha)]);

    // A collaborator's own workflow token writes a bot-signed commit on the same parent with the same
    // trailer and other content, and force-pushes the branch to it.
    await bot.createBranch({ name: 'forge', from: approved.headSha });
    const forgedCommit = await bot.commitFiles({
      branch: 'forge',
      message: legit.message,
      files: [{ path: PASSAGE, content: PASSAGE_TEXT.replace('"summary": "', '"summary": "Unreviewed. ') }],
    });
    expect(forgedCommit).toMatchObject({ parents: [approved.headSha], author: ACTIONS_BOT, verified: true });
    expect(forgedCommit.sha).not.toBe(legit.sha);
    bot.forcePush(BRANCH, forgedCommit.sha);
    for (const check of REQUIRED_CHECKS) bot.setCheck(forgedCommit.sha, check, 'success');

    const outcome = await simulateRun(bot, number, { event: 'workflow_dispatch', results: DETERMINISTIC_PASS });
    expect(outcome.headSha).toBe(forgedCommit.sha);
    expect(outcome.mergeRule.decision).toBe('blocked');
    expect(outcome.mergeRule.summary).toContain(`belongs to PR #0, not #${String(number)}`);
    expect(outcome.merge).toBeNull();
    // And the merge job, asked for the legitimate approval commit, refuses the moved head.
    expect(await runMergeJob({ github: bot, prNumber: number, sha: legit.sha, log: () => undefined })).toMatchObject({
      merged: false,
      exitCode: 1,
    });
    expect(bot.merges).toEqual([]);
  });

  it('flagged → a reviewer comments /approve (issue_comment run) → a valid trailer → merged', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const flagged = await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
    expect(await decisionLabels(bot, number)).toEqual(['needs-review']);
    expect(flagged.mergeRule.decision).toBe('needs-review');

    await bot.as(REVIEWER).postComment(number, '/approve');
    const approved = await simulateRun(bot, number, { event: 'issue_comment', results: DETERMINISTIC_PASS });
    expect(approved.run).toMatchObject({ event: 'issue_comment', prNumbers: [], headBranch: 'main' });
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

describe('content gates: labels and approvals', () => {
  it('fail → fixed → auto-merge', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    const failed = await simulateRun(bot, number, { event: 'workflow_run', results: SCHEMA_FAIL });
    expect(failed.mergeRule).toMatchObject({ decision: 'blocked', exitCode: 1 });
    expect(await decisionLabels(bot, number)).toEqual(['gates-failed']);
    expect(failed.mergeRule.summary).toContain('gates failed');

    await pushContent(bot, 'research-bot', BRANCH, PASSAGE_TEXT.replace('"summary": "', '"summary": "Fixed. '));
    const fixed = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    expect(fixed.mergeRule.decision).toBe('auto-merge');
    expect(await decisionLabels(bot, number)).toEqual(['auto-merge-candidate']);
  });

  it('ignores an approval from a handle that is not configured', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
    await bot.as(STRANGER).addLabels(number, [APPROVED]);
    await bot.as(STRANGER).postComment(number, '/approve');
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    expect(outcome.mergeRule).toMatchObject({ decision: 'needs-review', label: 'needs-review' });
    expect(outcome.mergeRule.summary).toContain(
      `@${STRANGER} via comment ignored: not a handle in config.reviewer.githubHandles`,
    );
    expect(bot.dispatches).toEqual([]);
  });

  it('a label the reviewer removed and someone else re-added does not approve', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
    await bot.as(REVIEWER).addLabels(number, [APPROVED]);
    await bot.as(REVIEWER).removeLabels(number, [APPROVED]);
    await bot.as(STRANGER).addLabels(number, [APPROVED]);
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    expect(outcome.mergeRule.decision).toBe('needs-review');
    expect(outcome.mergeRule.summary).toContain(`approval by @${STRANGER} via label ignored`);
    expect(bot.dispatches).toEqual([]);
  });

  it('an approval followed by a new content commit needs review again', async () => {
    const bot = newRepo();
    const number = await openPr(bot, 'research-bot');
    await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
    await bot.as(REVIEWER).addLabels(number, [APPROVED]);
    const approved = await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
    expect(approved.mergeRule.decision).toBe('human-approved');

    // The author edits the content on top of the approval commit, keeping the approved block.
    const passage = JSON.parse(bot.fileAt(BRANCH, PASSAGE) as string) as { summary: string };
    passage.summary = `${passage.summary} Revised.`;
    await pushContent(bot, 'research-bot', BRANCH, `${JSON.stringify(passage, null, 2)}\n`);
    const edited = await simulateRun(bot, number, { event: 'workflow_run', results: FLAGGED_RESULTS });
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
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    expect(outcome.mergeRule.decision).toBe('blocked');
  });
});

describe('content gates: protected paths and symlinks', () => {
  const editedDecide = "export function decide() {\n  return { decision: 'auto-merge', reasons: [] };\n}\n";

  // The PR copy of decide is never executed (only main's tooling runs; workflow.test.ts checks
  // that nothing runs from pr-head/). Here the decision comes from this checkout's decide, and
  // the only reasons are the protected path and the file outside passages/.
  it('a PR that edits decide to always auto-merge is decided by main’s decide: protected path', async () => {
    const bot = newRepo({ 'packages/gates/src/merge-rule/index.ts': '// decide\n' });
    const number = await openPr(bot, 'research-bot', {
      [PASSAGE]: PASSAGE_TEXT,
      'packages/gates/src/merge-rule/index.ts': editedDecide,
    });
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    expect(outcome.mergeRule).toMatchObject({ decision: 'needs-review', label: 'needs-review' });
    const reasons = outcome.mergeRule.summary
      .split('### Merge rule')[1]
      ?.split('\n')
      .filter((line) => line.startsWith('- '));
    expect(reasons).toEqual([
      '- packages/gates/src/merge-rule/index.ts is under packages/gates/** (never auto-merged)',
      '- packages/gates/src/merge-rule/index.ts is outside passages/',
    ]);
    expect(bot.dispatches).toEqual([]);
  });

  it.each([['packages/gates/src/x.ts'], ['.github/workflows/content-gates.yml'], ['config/lectio.config.json']])(
    'a PR touching %s with perfect verifier scores needs review',
    async (path) => {
      const bot = newRepo();
      const number = await openPr(bot, 'research-bot', { [PASSAGE]: PASSAGE_TEXT, [path]: 'x\n' });
      const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
      expect(outcome.mergeRule.decision).toBe('needs-review');
      expect(bot.dispatches).toEqual([]);
    },
  );

  it('never writes an approval commit, dispatches or merges for a .github/** PR, even when approved', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER, { [PASSAGE]: PASSAGE_TEXT, '.github/workflows/x.yml': 'on: push\n' });
    await simulateRun(bot, number, { event: 'workflow_run', results: AUTO_RESULTS });
    await bot.as(REVIEWER).addLabels(number, [APPROVED]);
    const head = bot.headOf(BRANCH);
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: DETERMINISTIC_PASS });
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
    expect(mergeRuleCheck(bot, head)).toMatchObject({ conclusion: 'success', title: 'human-approved (manual merge)' });
    // Even if asked directly, the merge job refuses.
    const merge = await runMergeJob({ github: bot, prNumber: number, sha: head, log: () => undefined });
    expect(merge).toEqual({ merged: false, exitCode: 1, deployed: false });
    expect(bot.merges).toEqual([]);
  });

  it('blocks a PR with a changed symbolic link, never reading or committing what it points to', async () => {
    const bot = newRepo();
    const number = await openPr(bot, REVIEWER, { 'calendar/2026.json': '/proc/self/environ' });
    contentChecksRun(bot, number, bot.headOf(BRANCH), BRANCH);
    await bot.as(REVIEWER).addLabels(number, [APPROVED]);
    const outcome = await simulateRun(bot, number, {
      event: 'workflow_run',
      results: DETERMINISTIC_PASS,
      nonRegular: ['calendar/2026.json'],
    });
    expect(outcome.mergeRule).toMatchObject({ decision: 'blocked', label: 'gates-failed', exitCode: 1 });
    expect(outcome.mergeRule.summary).toContain('calendar/2026.json is not a regular file');
    expect(outcome.mergeRule.summary).toContain('runner/regular-files');
    expect(bot.dispatches).toEqual([]);
  });
});

describe('content gates: claims', () => {
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
    const outcome = await simulateRun(bot, number, { event: 'workflow_run', results: partial });
    expect(outcome.mergeRule.decision).toBe('needs-review');
    expect(outcome.mergeRule.summary).toContain('claim c5');
  });
});
