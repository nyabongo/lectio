import { COMMENT_MARKER, GATES, allRules, renderComment } from '@lectio/gates';
import type { GateReport, GateResultItem } from '@lectio/gates';
import type { FakeLlmScriptEntry, PullRequest } from '@lectio/providers';
import { afterEach, describe, expect, it } from 'vitest';

import { APPROVAL_AUTHOR, APPROVAL_TRAILER } from '../publish/publish.ts';
import { KEY, PATH, e2eWorld } from './fixtures/e2e.ts';
import type { E2eWorld } from './fixtures/e2e.ts';
import { FixupRefusedError, formatFixupReport, runFixup } from './fixup.ts';
import type { FixupDeps, FixupInput } from './fixup.ts';
import { GATES_BOT } from './gates-comment.ts';
import { main } from './main.ts';
import type { ComposeOptions } from './providers.ts';

const BRANCH = `research/${KEY}`;
const quiet = { out: () => undefined, err: () => undefined };

const REFUTED: GateResultItem = {
  ruleId: 'verifiers/claim-not-refuted',
  severity: 'error',
  file: PATH,
  pointer: '/claims/1',
  claimId: 'c2',
  message: 'c2 refuted',
};

function report(head: string, items: GateResultItem[] = [REFUTED]): GateReport {
  return {
    reportVersion: 1,
    status: items.length === 0 ? 'pass' : 'fail',
    base: 'main',
    head,
    changedFiles: [PATH],
    results: [{ gate: 'verifiers', status: items.length === 0 ? 'pass' : 'fail', items, meta: {} }],
  } as GateReport;
}

let world: E2eWorld | undefined;

afterEach(() => {
  world?.cleanUp();
  world = undefined;
});

/** A world with one published research PR; returns its number. */
async function published(repair?: FakeLlmScriptEntry): Promise<{ w: E2eWorld; number: number; pr: PullRequest }> {
  const w = e2eWorld(repair === undefined ? {} : { repair });
  world = w;
  expect(await main(['run', '--from', '2026-10-05', '--budget', '10'], w.context, quiet)).toBe(0);
  const [pr] = await w.github.listPrs();
  return { w, number: (pr as PullRequest).number, pr: pr as PullRequest };
}

async function comment(w: E2eWorld, number: number, items?: GateResultItem[], head?: string): Promise<void> {
  const body = renderComment(report(head ?? w.github.headOf(BRANCH), items), { gates: GATES, rules: allRules() });
  await w.github.as(GATES_BOT).upsertComment(number, COMMENT_MARKER, body);
}

async function deps(w: E2eWorld, extra: Partial<FixupDeps> = {}): Promise<FixupDeps> {
  const compose = w.context.compose as (options: ComposeOptions) => ReturnType<NonNullable<typeof w.context.compose>>;
  const kit = await compose({ mode: 'live', config: w.context.config, env: {}, ceilingUsd: 10, llm: true });
  return {
    ...kit,
    config: w.context.config,
    repoRoot: w.root,
    repo: w.context.repo as FixupDeps['repo'],
    dryRun: false,
    files: w.context.files as FixupDeps['files'],
    readReport: () => {
      throw new Error('no report');
    },
    format: (json) => Promise.resolve(json),
    ...extra,
  };
}

const input = (pr: number, extra: Partial<FixupInput> = {}): FixupInput => ({ pr, force: false, ...extra });

describe('runFixup refusals', () => {
  it('refuses closed, fork and non-research PRs', async () => {
    const { w, number } = await published();
    const d = await deps(w);
    await w.github.createBranch({ name: 'feature/x' });
    await w.github.commitFiles({ branch: 'feature/x', message: 'x', files: [{ path: 'x.txt', content: 'x' }] });
    const other = (await w.github.openOrUpdatePr({ head: 'feature/x', title: 'x', body: '' })).pr;
    await expect(runFixup(input(other.number), d)).rejects.toThrow(
      'is on feature/x, not a research/<passage key> branch',
    );
    const fork = await w.github.openForkPr({ head: BRANCH, headRepo: 'someone/lectio', title: 'f', body: '' });
    await expect(runFixup(input(fork.number), d)).rejects.toThrow('comes from a fork');
    await w.github.closePr(number);
    await expect(runFixup(input(number), d)).rejects.toThrow(`PR #${String(number)} is closed`);
  });

  it('refuses a head someone else pushed', async () => {
    const { w, number } = await published();
    await w.github.as('reviewer').pushCommit({
      branch: BRANCH,
      message: 'tweak',
      files: [{ path: PATH, content: '{}' }],
    });
    await expect(runFixup(input(number, { force: true }), await deps(w))).rejects.toThrow(
      'is not a research or approval commit',
    );
  });

  it('refuses an approved PR unless forced, by label or by approval commit', async () => {
    const { w, number } = await published();
    await comment(w, number);
    await w.github.addLabels(number, ['approved']);
    const d = await deps(w);
    await expect(runFixup(input(number), d)).rejects.toThrow('is already approved; a fix-up commit would reset');
    const forced = await runFixup(input(number, { force: true }), d);
    expect(forced.status).toBe('pushed');

    const again = await published();
    await again.w.github.as(APPROVAL_AUTHOR).pushCommit({
      branch: BRANCH,
      message: `Approve\n\n${APPROVAL_TRAILER}: label approved by nyabongo`,
      files: [{ path: 'passages/.gitkeep', content: 'approved' }],
      verified: true,
    });
    await comment(again.w, again.number);
    await expect(runFixup(input(again.number), await deps(again.w))).rejects.toThrow('is already approved');
  });

  it('refuses without a gates comment from the bot, and ignores look-alikes', async () => {
    const { w, number } = await published();
    const body = renderComment(report(w.github.headOf(BRANCH)), { gates: GATES, rules: allRules() });
    await w.github.as('mallory').postComment(number, body);
    await expect(runFixup(input(number), await deps(w))).rejects.toThrow(
      `PR #${String(number)} has no gates comment from ${GATES_BOT} yet`,
    );
    await expect(runFixup(input(number), await deps(w, { bot: 'mallory' }))).resolves.toMatchObject({
      status: 'pushed',
    });
  });

  it('refuses a stale comment unless forced', async () => {
    const { w, number } = await published();
    await comment(w, number, [REFUTED], '1234567890abc');
    await expect(runFixup(input(number), await deps(w))).rejects.toThrow('is for head 1234567890abc');
    expect((await runFixup(input(number, { force: true }), await deps(w))).status).toBe('pushed');
  });

  it('refuses a head without a valid passage file', async () => {
    const { w, number } = await published();
    await comment(w, number);
    const d = await deps(w);
    const read = (text: string | null): FixupDeps['files'] => ({
      head: () => Promise.resolve(text),
      base: () => Promise.resolve(null),
    });
    await expect(runFixup(input(number), { ...d, files: read(null) })).rejects.toThrow(`head has no ${PATH}`);
    await expect(runFixup(input(number), { ...d, files: read('{') })).rejects.toThrow('is not JSON');
    await expect(runFixup(input(number), { ...d, files: read('{"key":"MT.20.1-16"}') })).rejects.toThrow(
      FixupRefusedError,
    );
    await expect(runFixup(input(number), { ...d, files: read('{"key":"MT.20.1-16"}') })).rejects.toThrow(
      'is not a valid passage:',
    );
  });
});

describe('runFixup outcomes', () => {
  it('reads a downloaded gates.json report instead of the comment', async () => {
    const { w, number } = await published();
    const head = w.github.headOf(BRANCH);
    const read: string[] = [];
    const d = await deps(w, {
      readReport: (path) => {
        read.push(path);
        return JSON.stringify(report(head));
      },
    });
    const result = await runFixup(input(number, { report: 'out/gates.json' }), d);
    expect(read).toEqual(['out/gates.json']);
    expect(result).toMatchObject({ status: 'pushed', source: 'out/gates.json', findings: [REFUTED] });
    expect(formatFixupReport(result)).toContain('Result: pushed a fix-up commit (');
  });

  it('has nothing to fix when the gates found nothing it can act on', async () => {
    const { w, number } = await published();
    await comment(w, number, []);
    const head = w.github.headOf(BRANCH);
    const result = await runFixup(input(number), await deps(w));
    expect(result).toMatchObject({ status: 'nothing-to-fix', commit: null, findings: [] });
    expect(w.github.headOf(BRANCH)).toBe(head);
    expect(formatFixupReport(result)).toContain('nothing pushed');
  });

  it('pushes nothing on a dry run', async () => {
    const { w, number } = await published();
    await comment(w, number);
    const head = w.github.headOf(BRANCH);
    const result = await runFixup(input(number), await deps(w, { dryRun: true }));
    expect(result.status).toBe('dry-run');
    expect(w.github.headOf(BRANCH)).toBe(head);
  });

  it('reports unchanged when the repaired file is what the PR has', async () => {
    const { VALID_OUTPUT } = await import('../validate/fixtures/draft.ts');
    const { w, number } = await published({ output: VALID_OUTPUT, usage: { inputTokens: 0, outputTokens: 0 } });
    await comment(w, number);
    const before = w.github.fileAt(BRANCH, PATH);
    const result = await runFixup(input(number), await deps(w));
    expect(w.github.fileAt(BRANCH, PATH)).toBe(before);
    expect(result.status).toBe('unchanged');
    expect(formatFixupReport(result)).toContain('the repaired file is what the PR already has');
  });

  it('abandons, pushing nothing, when a finding cannot be repaired or dropped', async () => {
    const { w, number } = await published();
    const unplaced: GateResultItem = {
      ...REFUTED,
      ruleId: 'verifiers/claim-supported',
      pointer: '',
      severity: 'warning',
    };
    delete (unplaced as { claimId?: string }).claimId;
    await comment(w, number, [unplaced]);
    const head = w.github.headOf(BRANCH);
    const result = await runFixup(
      input(number),
      await deps(w, { config: { ...w.context.config, research: { ...w.context.config.research, maxRepairs: 0 } } }),
    );
    expect(result.status).toBe('abandoned');
    expect(w.github.headOf(BRANCH)).toBe(head);
    const text = formatFixupReport(result);
    expect(text).toContain('verifiers/claim-supported file: c2 refuted');
    expect(text).toContain('abandoned');
  });
});
