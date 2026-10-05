/**
 * The bad week (L-033): one pull request whose files show the failure message of every content
 * rule of gates 1 to 3 (see ./helpers/bad-week.ts), run through the gates as content-gates.yml
 * runs them, offline: recorded pages for the fetcher, fake verifiers. The rendered PR comment is a
 * file snapshot, fixtures/bad-week/comment.md, which the gate docs (L-043) show as an example.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '@lectio/config';
import { GATES, createContext, decide, runGates, skipReason } from '@lectio/gates';
import type { ChangedFile, GateContext, GateReport, GateResult } from '@lectio/gates';
import { SOURCE_FIXTURES_ENV, createProviders } from '@lectio/providers';

import { labelFor, renderDecisionComment } from '../../packages/gates/src/ci/merge-rule-job.ts';
import { changedClaims, factsFromChanges } from '../../packages/gates/src/merge-rule/index.ts';
import { BAD_WEEK_DIR, EXPECTED, NOT_SHOWN, badWeekFiles, diskPath, prPath } from './helpers/bad-week.ts';
import { REPO_ROOT } from './helpers/gate-test.ts';

/** The head sha the comment names (the fixture has no commit). */
const HEAD = 'b'.repeat(40);

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

const read = (dir: string, path: string): string | null => {
  const file = join(BAD_WEEK_DIR, dir, diskPath(path));
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

/** The bad-week PR: the head files over the repository (corpus, guard index), the base file on the base branch. */
function badWeekContext(): GateContext {
  const head = filesUnder(join(BAD_WEEK_DIR, 'head')).map(prPath);
  const changed: ChangedFile[] = head.map((path) => ({
    path,
    status: read('base', path) === null ? 'added' : 'modified',
  }));
  const config = loadConfig(undefined, { cwd: REPO_ROOT });
  return createContext({
    root: REPO_ROOT,
    base: 'origin/main',
    head: HEAD,
    config,
    providers: createProviders(config, { [SOURCE_FIXTURES_ENV]: join(BAD_WEEK_DIR, 'pages') }),
    git: { changedFiles: () => changed, show: (_ref, path) => read('base', path) },
    readText: (absolute) => read('head', relative(REPO_ROOT, absolute)),
  });
}

const deterministic = new Set(['schema', 'evidence', 'licence']);

describe('the bad week', () => {
  let context: GateContext;
  let report: GateReport;
  beforeAll(async () => {
    context = badWeekContext();
    report = await runGates(
      GATES.filter((gate) => deterministic.has(gate.id) || gate.id === 'verifiers'),
      context,
    );
  });

  it('commits exactly the files its builder writes (run write-bad-week.ts after changing it)', () => {
    const committed = filesUnder(BAD_WEEK_DIR).filter((file) => file !== 'comment.md');
    const files = badWeekFiles();
    expect(committed).toEqual(Object.keys(files).sort());
    // JSON is compared parsed: the committed files are Prettier-formatted (write-bad-week.ts formats them).
    for (const [file, text] of Object.entries(files)) {
      const committedText = readFileSync(join(BAD_WEEK_DIR, file), 'utf8');
      if (file.endsWith('.json')) expect(JSON.parse(committedText)).toEqual(JSON.parse(text));
      else expect(committedText).toBe(text);
    }
  });

  it('each file breaks exactly the rules it is built to break', () => {
    const broken: Record<string, string[]> = {};
    for (const file of Object.keys(EXPECTED)) broken[file] = [];
    for (const result of report.results) {
      for (const item of result.items) {
        if (item.severity === 'info') continue;
        const rules = (broken[item.file ?? '(no file)'] ??= []);
        if (!rules.includes(item.ruleId)) rules.push(item.ruleId);
      }
    }
    for (const rules of Object.values(broken)) rules.sort();
    expect(broken).toEqual(EXPECTED);
  });

  it('shows every content rule of gates 1 to 3 at least once', () => {
    const shown = new Set(Object.values(EXPECTED).flat());
    const rules = GATES.filter((gate) => deterministic.has(gate.id)).flatMap((gate) =>
      gate.rules.map((rule) => rule.id),
    );
    expect(rules.filter((rule) => !shown.has(rule)).sort()).toEqual([...NOT_SHOWN].sort());
  });

  it('fails gates 1 to 3, skips the verifiers without API keys, and the merge rule blocks it', () => {
    const status = (id: string): GateResult => report.results.find((result) => result.gate === id) as GateResult;
    expect(status('schema').status).toBe('fail');
    expect(status('evidence').status).toBe('fail');
    expect(status('licence').status).toBe('fail');
    expect(status('verifiers').status).toBe('skipped');
    expect(skipReason(status('verifiers'))).toMatch(/API key|live/u);
    const outcome = decide({
      results: report.results,
      config: context.config,
      pr: factsFromChanges(context),
      claims: changedClaims(context),
    });
    expect(outcome.decision).toBe('blocked');
    expect(labelFor(outcome.decision, false)).toBe('gates-failed');
  });

  it('renders the PR comment (fixtures/bad-week/comment.md)', async () => {
    const outcome = decide({
      results: report.results,
      config: context.config,
      pr: factsFromChanges(context),
      claims: changedClaims(context),
    });
    const comment = renderDecisionComment(report, outcome, []);
    // Prettier-formatted (tables aligned) so the snapshot passes format:check; the markdown is the same.
    const snapshot = join(BAD_WEEK_DIR, 'comment.md');
    const options = (await resolveConfig(snapshot)) ?? {};
    await expect(await format(comment, { ...options, parser: 'markdown' })).toMatchFileSnapshot(snapshot);
  });
});
