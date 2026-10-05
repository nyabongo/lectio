/**
 * The security shape of the two content workflows, checked as text: the PR side
 * (content-checks.yml: read-only, no secrets) and the trusted side (content-gates.yml: main's copy
 * only, writes and secrets), base checkouts, per-job permissions, concurrency, where secrets and
 * the token go, the live fetcher, and the registry.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateRequiredChecks } from '@lectio/shared/required-checks';

import { REPO_ROOT } from './fixtures/content-gates.ts';

const workflowsDir = join(REPO_ROOT, '.github/workflows');
const read = (file: string): string => readFileSync(join(workflowsDir, file), 'utf8');
/** The workflow without its comment lines (the comments describe the model; the code must follow it). */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
const checks = code(read('content-checks.yml'));
const gates = code(read('content-gates.yml'));

/** Each job's text, by job id. */
function jobs(text: string): Record<string, string> {
  const body = text.slice(text.indexOf('\njobs:\n'));
  const found: Record<string, string> = {};
  let current: string | null = null;
  for (const line of body.split('\n')) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) current = header[1] as string;
    else if (current !== null) found[current] = `${found[current] ?? ''}${line}\n`;
  }
  return found;
}

const CHECKS = jobs(checks);
const GATES = jobs(gates);
const job = (all: Record<string, string>, id: string): string => all[id] as string;
const uses = (text: string): string[] =>
  [...text.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1] as string);

describe('content-checks.yml (PR side)', () => {
  it('runs on pull_request and dispatch only, read-only, with no secrets and no token use', () => {
    expect(Object.keys(CHECKS)).toEqual(['changes', 'deterministic']);
    expect(checks).toContain('types: [opened, synchronize, reopened, labeled]');
    expect(checks).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(checks).not.toMatch(/issue_comment|workflow_run|pull_request_target/);
    expect(checks).toContain('run-name: Content checks (${{ github.event.action || github.event_name }})');
    expect(checks).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(checks).not.toMatch(/:\s*write/);
    expect(checks).not.toContain('secrets.');
    expect(checks).not.toContain('GH_TOKEN');
    expect(checks).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(job(CHECKS, 'deterministic')).toContain('--gates schema,evidence,licence --fetch live');
  });
});

describe('content-gates.yml (trusted side)', () => {
  it('runs only main’s copy: workflow_run, /approve comments, and dispatches on the default branch', () => {
    // Job names never equal a check name: these jobs report on main, merge-rule is a Checks API run.
    expect(Object.keys(GATES)).toEqual(['resolve', 'gates-trusted', 'verifiers', 'decide', 'merge']);
    expect(gates).toMatch(/workflow_run:\n {4}workflows: \[Content checks\]\n {4}types: \[completed\]/);
    expect(gates).toMatch(/issue_comment:\n {4}types: \[created\]/);
    expect(gates).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}pr:/);
    expect(gates).not.toMatch(/^ {2}pull_request(_target)?:/m);
    expect(gates).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(job(GATES, 'resolve')).toContain(
      "github.event_name != 'workflow_dispatch' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    // Every other job needs resolve, so nothing runs when resolve is skipped.
    for (const id of ['gates-trusted', 'verifiers', 'decide', 'merge'])
      expect(job(GATES, id)).toMatch(/needs: .*resolve/);
    expect(gates).not.toContain('run-name: Content gates · PR');
  });

  it('keeps unrelated comments out of every gate concurrency group', () => {
    const group = gates.slice(gates.indexOf('concurrency:'), gates.indexOf('cancel-in-progress'));
    expect(group).toContain('content-gates-${{ github.event_name }}-');
    expect(group).toContain(
      "(github.event_name == 'issue_comment' && !(github.event.issue.pull_request && startsWith(github.event.comment.body, '/approve')))",
    );
    expect(group).toContain("&& format('unrelated-{0}', github.run_id)");
    expect(gates).toMatch(/^ {2}cancel-in-progress: false$/m);
    expect(job(GATES, 'decide')).toContain('group: content-gates-merge-rule-${{ needs.resolve.outputs.pr }}');
    expect(job(GATES, 'merge')).toContain('group: content-gates-merge-${{ needs.resolve.outputs.pr }}');
  });

  it('grants nothing by default and writes only in decide and merge', () => {
    expect(gates).toMatch(/^permissions: \{\}$/m);
    for (const id of ['resolve', 'gates-trusted', 'verifiers']) expect(job(GATES, id), id).not.toMatch(/:\s*write/);
    expect(job(GATES, 'decide')).toMatch(
      /contents: write[\s\S]*pull-requests: write[\s\S]*issues: write[\s\S]*actions: write[\s\S]*checks: write/,
    );
    expect(job(GATES, 'merge')).toMatch(/contents: write[\s\S]*pull-requests: write[\s\S]*actions: write/);
  });

  it('gives the verifier keys to the verifiers job only, and the token only to tooling steps', () => {
    const secrets = [...gates.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]);
    expect(secrets).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    for (const [id, text] of Object.entries(GATES)) expect(text.includes('secrets.'), id).toBe(id === 'verifiers');
    for (const id of ['gates-trusted', 'verifiers']) expect(job(GATES, id)).not.toContain('GH_TOKEN');
    for (const line of gates.split('\n').filter((text) => text.includes('GH_TOKEN')))
      expect(line.trim()).toBe('GH_TOKEN: ${{ github.token }}');
  });

  it('re-runs the deterministic gates itself and uploads the artifact naming the commit before dispatching', () => {
    expect(job(GATES, 'gates-trusted')).toContain('--gates schema,evidence,licence --fetch live');
    expect(job(GATES, 'verifiers')).toContain('--gates verifiers --fetch live --llm live');
    const mergeRule = job(GATES, 'decide');
    const decide = mergeRule.indexOf('--phase decide');
    const approve = mergeRule.indexOf('--phase approve');
    const upload = mergeRule.indexOf('name: ${{ steps.approve.outputs.approval-artifact }}');
    const dispatch = mergeRule.indexOf('--phase dispatch');
    expect(decide).toBeGreaterThan(0);
    expect(approve).toBeGreaterThan(decide);
    expect(upload).toBeGreaterThan(approve);
    expect(dispatch).toBeGreaterThan(upload);
    expect(mergeRule).toContain('--approval-commit "$APPROVAL_COMMIT"');
    expect(mergeRule).toContain('ci skip --head-sha');
    expect(mergeRule).toContain('name: gates-report');
  });

  it('reads each gate report exactly where its job uploads it', () => {
    const decide = job(GATES, 'decide');
    // Every download names its artifact and unpacks it into out/<name>/: never the whole-run layout.
    const downloads = [...decide.matchAll(/uses: actions\/download-artifact@\S+\n((?: {8}.*\n)+)/g)].map(
      (match) => match[1] as string,
    );
    expect(downloads).toHaveLength(2);
    for (const [id, name] of [
      ['gates-trusted', 'deterministic'],
      ['verifiers', 'verifiers'],
    ] as const) {
      const producer = job(GATES, id);
      expect(producer).toContain(`--json out/${name}/gates.json`);
      expect(producer).toMatch(new RegExp(`name: ${name}\\n {10}path: out/${name}/\\n`));
      const download = downloads.find((text) => text.includes(`name: ${name}\n`));
      expect(download, name).toContain(`path: out/${name}\n`);
      expect(download, name).toContain(`needs.${id}.result != 'skipped'`);
      expect(decide).toContain(`--results out/${name}/gates.json --job-result "out/${name}/gates.json=$`);
    }
    // With the verifiers skipped only one artifact exists; a nameless download would unpack it
    // straight into its path. Each download names its artifact, so the layout never depends on count.
    for (const text of downloads) expect(text).toMatch(/name: \S+/);
    expect(decide).not.toMatch(/download-artifact@\S+\n(?: {8}.*\n)*? {10}path: out\n/);
  });

  it('diffs against the base commit it fetched, never an empty base', () => {
    const decide = job(GATES, 'decide');
    expect(decide).toContain('echo "base-sha=$(git rev-parse "refs/remotes/origin/${BASE_REF}")" >> "$GITHUB_OUTPUT"');
    expect(decide.match(/BASE_SHA: \$\{\{ steps\.fetch\.outputs\.base-sha \}\}/g)).toHaveLength(3);
    expect(decide.match(/--base "\$BASE_SHA"/g)).toHaveLength(3);
  });

  it('merges only after approved-commit, never for a manual-merge or fork PR', () => {
    const merge = job(GATES, 'merge');
    expect(merge).toContain("needs.decide.outputs.decision == 'approved-commit'");
    expect(merge).toContain("needs.decide.outputs.manual-merge != 'true'");
    expect(merge).toContain("needs.resolve.outputs.fork != 'true'");
  });
});

describe('both workflows', () => {
  const all: [string, string, Record<string, string>][] = [
    ['content-checks.yml', checks, CHECKS],
    ['content-gates.yml', gates, GATES],
  ];

  it('check out main for tooling (one commit per run) in every job, never persisting the token', () => {
    for (const [file, , byJob] of all)
      for (const [id, text] of Object.entries(byJob)) {
        expect(text.split('uses: actions/checkout@').length - 1, `${file} ${id}`).toBe(1);
        expect(text, `${file} ${id}`).toMatch(
          /ref: \$\{\{ (github\.event\.repository\.default_branch|needs\.(changes|resolve)\.outputs\.tool-sha) \}\}/,
        );
        expect(text, `${file} ${id}`).toContain('persist-credentials: false');
      }
  });

  it('read the PR head only as data in pr-head/ and never install or run it', () => {
    for (const [file, text] of all) {
      expect(text, file).not.toMatch(/working-directory:\s*pr-head/);
      expect(text, file).not.toMatch(/cd pr-head|pr-head\/package|--prefix pr-head/);
      for (const line of text.split('\n').filter((entry) => /\bnpm (ci|install|run)\b/.test(entry)))
        expect(line, file).not.toContain('pr-head/');
      expect(text, file).toContain('git worktree add --detach pr-head');
    }
  });

  it('keep unit CI offline', () => {
    const ci = read('ci.yml');
    expect(ci).not.toContain('--fetch live');
    expect(ci).not.toContain('secrets.');
  });

  it('pin actions like the other workflows', () => {
    const others = readdirSync(workflowsDir)
      .filter((file) => !file.startsWith('content-'))
      .flatMap((file) => uses(read(file)));
    for (const [, text] of all)
      for (const action of uses(text)) {
        const name = action.split('@')[0] as string;
        const known = others.filter((other) => other.startsWith(`${name}@`));
        if (known.length > 0) expect(known, action).toContain(action);
        else expect(action).toMatch(/^actions\/[\w-]+@v\d+$/);
      }
  });

  it('register the PR side (changes, deterministic) and the registry validates', () => {
    const dir = join(REPO_ROOT, '.github/required-checks');
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }));
    const entry = (file: string): unknown =>
      JSON.parse(files.find((candidate) => candidate.file === file)?.source ?? '{}');
    expect(entry('content-checks.json')).toEqual({
      workflow: 'content-checks.yml',
      jobs: ['changes', 'deterministic'],
    });
    // merge-rule is a Checks API run from the trusted workflow, not a job: not in the registry.
    expect(files.map((file) => file.file)).not.toContain('content-gates.json');
    expect(validateRequiredChecks(files, (workflow) => read(workflow))).toEqual([]);
  });
});
