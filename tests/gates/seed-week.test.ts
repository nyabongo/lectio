/**
 * The seed week through every gate (L-033), offline, as content-gates.yml runs it on a PR that adds
 * all of it: gates 1 to 3 over every committed passage and calendar year, with the web pages the
 * passages cite served from recordings of the live pages (fixtures/seed-pages, see
 * ./helpers/seed-pages.ts) instead of the network; gate 4 without API keys; gate 5 deciding.
 *
 * Gates 1 to 3 must report no error and no unchecked source: every cited excerpt is on its recorded
 * page, and no note copies a long run from a cited commentary section. The only warnings allowed
 * are print sources, which are flagged for a reviewer by design. Gate 4 is skipped (no keys), so the
 * merge rule asks for review: the seed week never auto-merges.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { GATES, decide, formatFinding, ruleBookFor, runGates, skipReason } from '@lectio/gates';
import type { GateContext, GateReport, GateResult } from '@lectio/gates';
import { SOURCE_FIXTURES_ENV } from '@lectio/providers';
import type { FakeSourcePage } from '@lectio/providers';

import { labelFor } from '../../packages/gates/src/ci/merge-rule-job.ts';
import { changedClaims, factsFromChanges } from '../../packages/gates/src/merge-rule/index.ts';
import { REPO_ROOT, contentContext, contentFiles } from './helpers/gate-test.ts';

const SEED_PAGES = join(REPO_ROOT, 'tests', 'gates', 'fixtures', 'seed-pages');

/** Warnings that are expected on committed content: print sources always wait for a reviewer. */
const ALLOWED_WARNINGS = new Set(['evidence/print-source-flag']);

/**
 * Findings fixed in a pull request of their own, by `<file>#<pointer> <rule>`: tolerated until it
 * merges, then this entry goes (the test does not require it, so the order of merging does not matter).
 */
const FIXED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ['passages/LK.8.19-21.json#/claims/15/text licence/commentary-overlap', 'nyabongo/lectio#223'],
]);

const findingKey = (item: { file?: string; pointer?: string; ruleId: string }): string =>
  `${item.file ?? ''}#${item.pointer ?? ''} ${item.ruleId}`;

const GATE_IDS = ['schema', 'evidence', 'licence', 'verifiers'];
const rules = ruleBookFor(GATES);

/** Every web URL the committed passages cite. */
function citedUrls(): string[] {
  const urls = new Set<string>();
  for (const file of contentFiles().filter((path) => path.startsWith('passages/'))) {
    const passage = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as {
      sources: { type: string; url?: string }[];
    };
    for (const source of passage.sources) if (source.type === 'web' && source.url !== undefined) urls.add(source.url);
  }
  return [...urls].sort();
}

describe('the seed week through every gate (recorded pages, no API keys)', () => {
  let context: GateContext;
  let report: GateReport;
  const result = (id: string): GateResult => report.results.find((entry) => entry.gate === id) as GateResult;

  beforeAll(async () => {
    context = contentContext(contentFiles(), REPO_ROOT, { [SOURCE_FIXTURES_ENV]: SEED_PAGES });
    report = await runGates(
      GATE_IDS.map((id) => GATES.find((gate) => gate.id === id)).filter((gate) => gate !== undefined),
      context,
    );
  });

  it('records a page for every cited URL, and nothing else (run record-seed-pages.ts when this fails)', () => {
    const index = JSON.parse(readFileSync(join(SEED_PAGES, 'index.json'), 'utf8')) as Record<string, FakeSourcePage>;
    expect(Object.keys(index).sort()).toEqual(citedUrls());
    for (const page of Object.values(index)) expect(page.status ?? 200).toBe(200);
  });

  it('checks every content file, the seed passages included', () => {
    const files = contentFiles();
    expect(files.filter((file) => file.startsWith('passages/')).length).toBeGreaterThanOrEqual(21);
    expect(result('schema').meta).toEqual({ files: files.length });
  });

  for (const id of ['schema', 'evidence', 'licence']) {
    it(`gate ${id}: no error, and no warning but print-source flags`, () => {
      const problems = result(id).items.filter(
        (item) =>
          !FIXED_ELSEWHERE.has(findingKey(item)) &&
          (item.severity === 'error' || (item.severity === 'warning' && !ALLOWED_WARNINGS.has(item.ruleId))),
      );
      expect(problems.map((item) => formatFinding(item, rules))).toEqual([]);
      if (!result(id).items.some((item) => FIXED_ELSEWHERE.has(findingKey(item))))
        expect(['pass', 'flag']).toContain(result(id).status);
    });
  }

  it('fetched every cited page from the recordings: no source went unchecked', () => {
    const evidence = result('evidence').items.filter((item) => item.ruleId === 'evidence/web-excerpt-found');
    const licence = result('licence').items.filter((item) => item.ruleId === 'licence/commentary-unchecked');
    expect([...evidence, ...licence]).toEqual([]);
  });

  it('gate 4 is skipped without API keys', () => {
    expect(result('verifiers').status).toBe('skipped');
    expect(skipReason(result('verifiers'))).toMatch(/API key missing/u);
  });

  it('gate 5 decides needs-review and labels the PR so, never auto-merge', () => {
    const outcome = decide({
      results: report.results,
      config: context.config,
      pr: factsFromChanges(context),
      claims: changedClaims(context),
    });
    const blockedElsewhere = report.results.some((entry) =>
      entry.items.some((item) => item.severity === 'error' && FIXED_ELSEWHERE.has(findingKey(item))),
    );
    expect(outcome.decision).toBe(blockedElsewhere ? 'blocked' : 'needs-review');
    expect(outcome.decision).not.toBe('auto-merge');
    expect(labelFor(outcome.decision, outcome.manualMerge === true)).toBe(
      blockedElsewhere ? 'gates-failed' : 'needs-review',
    );
  });
});
