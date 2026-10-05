/**
 * The security shape of .github/workflows/content-gates.yml, checked as text: base checkouts,
 * per-job permissions, where secrets and the token go, the live fetcher, and the registry.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateRequiredChecks } from '@lectio/shared/required-checks';

import { REPO_ROOT } from './fixtures/content-gates.ts';

const workflowsDir = join(REPO_ROOT, '.github/workflows');
const source = readFileSync(join(workflowsDir, 'content-gates.yml'), 'utf8');

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

const JOBS = jobs(source);
const uses = (text: string): string[] =>
  [...text.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1] as string);

describe('content-gates.yml', () => {
  it('has the five jobs and the triggers the issue asks for, with no trigger-level paths', () => {
    expect(Object.keys(JOBS)).toEqual(['changes', 'deterministic', 'verifiers', 'merge-rule', 'merge']);
    expect(source).toContain('types: [opened, synchronize, reopened, labeled]');
    expect(source).toMatch(/issue_comment:\n {4}types: \[created\]/);
    expect(source).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}pr:/);
    expect(source).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(source).not.toContain('pull_request_target');
    expect(source).toContain('run-name: Content gates · PR #');
  });

  it('grants nothing by default and writes only in merge-rule and merge', () => {
    expect(source).toMatch(/^permissions: \{\}$/m);
    for (const job of ['changes', 'deterministic', 'verifiers']) expect(JOBS[job], job).not.toMatch(/:\s*write/);
    expect(JOBS['merge-rule']).toMatch(
      /contents: write[\s\S]*pull-requests: write[\s\S]*issues: write[\s\S]*actions: write/,
    );
    expect(JOBS['merge']).toMatch(/contents: write[\s\S]*pull-requests: write[\s\S]*actions: write/);
  });

  it('checks out main for tooling in every job, never persisting the token', () => {
    for (const [id, text] of Object.entries(JOBS)) {
      const checkouts = text.split('uses: actions/checkout@').length - 1;
      expect(checkouts, id).toBe(1);
      expect(text, id).toContain('ref: ${{ github.event.repository.default_branch }}');
      expect(text, id).toContain('persist-credentials: false');
    }
  });

  it('reads the PR head only as data in pr-head/ and never installs or runs it', () => {
    expect(source).not.toMatch(/working-directory:\s*pr-head/);
    expect(source).not.toMatch(/cd pr-head|pr-head\/package|--prefix pr-head/);
    for (const line of source.split('\n').filter((text) => /\bnpm (ci|install|run)\b/.test(text)))
      expect(line).not.toContain('pr-head/');
    expect(source.match(/git worktree add --detach pr-head "\$HEAD_SHA"/g)).toHaveLength(4);
  });

  it('gives the verifier keys to the verifiers job only, and the token only to the tooling steps that need it', () => {
    const secrets = [...source.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]);
    expect(secrets).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    for (const [id, text] of Object.entries(JOBS)) expect(text.includes('secrets.'), id).toBe(id === 'verifiers');
    expect([...source.matchAll(/GH_TOKEN: \$\{\{ github\.token \}\}/g)]).toHaveLength(3);
    for (const job of ['deterministic', 'verifiers']) expect(JOBS[job]).not.toContain('GH_TOKEN');
  });

  it('fetches sources live here, while unit CI stays offline', () => {
    expect(JOBS['deterministic']).toContain('--gates schema,evidence,licence --fetch live');
    expect(JOBS['verifiers']).toContain('--gates verifiers --fetch live --llm live');
    const ci = readFileSync(join(workflowsDir, 'ci.yml'), 'utf8');
    expect(ci).not.toContain('--fetch live');
    expect(ci).not.toContain('secrets.');
  });

  it('merges only after approved-commit, never for a manual-merge or fork PR', () => {
    expect(JOBS['merge']).toContain("needs.merge-rule.outputs.decision == 'approved-commit'");
    expect(JOBS['merge']).toContain("needs.merge-rule.outputs.manual-merge != 'true'");
    expect(JOBS['merge']).toContain("needs.changes.outputs.fork != 'true'");
    expect(JOBS['merge']).toContain('needs: [changes, merge-rule]');
  });

  it('pins actions like the other workflows', () => {
    const others = readdirSync(workflowsDir)
      .filter((file) => file !== 'content-gates.yml')
      .flatMap((file) => uses(readFileSync(join(workflowsDir, file), 'utf8')));
    for (const action of uses(source)) {
      const name = action.split('@')[0] as string;
      const known = others.filter((other) => other.startsWith(`${name}@`));
      if (known.length > 0) expect(known, action).toContain(action);
      else expect(action).toMatch(/^actions\/[\w-]+@v\d+$/);
    }
  });

  it('is registered with changes, deterministic and merge-rule, and the registry validates', () => {
    const dir = join(REPO_ROOT, '.github/required-checks');
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }));
    expect(JSON.parse(files.find((file) => file.file === 'content-gates.json')?.source ?? '{}')).toEqual({
      workflow: 'content-gates.yml',
      jobs: ['changes', 'deterministic', 'merge-rule'],
    });
    expect(validateRequiredChecks(files, (workflow) => readFileSync(join(workflowsDir, workflow), 'utf8'))).toEqual([]);
  });
});
