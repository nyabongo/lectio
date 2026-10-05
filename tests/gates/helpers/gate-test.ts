/**
 * `gateTest(ruleId)`: one named test per gate rule, run over the real repository content, so a
 * content suite reads as the list of rules it enforces:
 *
 *     gateTest('schema/claim-has-source');
 *     gateTest('evidence/print-source-flag', { allow: ['warning', 'info'] });
 *
 * The test is named `<rule id>: <rule statement>`. It runs the rule's gate once per suite over
 * every content file (`calendar/*.json`, `passages/*.json`) as if a PR had added them all, and
 * fails listing each finding with the rule and how to fix it. A rule whose gate is still an L-023
 * stub (it declares no rules yet) is registered as a skipped test.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { loadConfig } from '@lectio/config';
import { GATES, createContext, formatFinding, gateOfRule, ruleBookFor, runGates } from '@lectio/gates';
import type { ChangedFile, Gate, GateContext, GateResult, Git, Severity } from '@lectio/gates';
import { createProviders } from '@lectio/providers';

/** The repository root (two levels above tests/gates/helpers). */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface GateTestOptions {
  /** The gate to run; defaults to the registry gate named by the rule id's prefix. */
  readonly gate?: Gate;
  /** Severities that do not fail the test. Defaults to `['info']`. */
  readonly allow?: readonly Severity[];
  /** Repository-relative files to check; defaults to every content file. */
  readonly files?: readonly string[];
}

function listJson(root: string, dir: string): string[] {
  try {
    return readdirSync(join(root, dir))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
}

/** Every content file under the configured content root, repository-relative. */
export function contentFiles(root: string = REPO_ROOT): string[] {
  const content = loadConfig(undefined, { cwd: root })
    .content.root.replace(/^\.\/?/, '')
    .replace(/\/$/, '');
  const prefix = content === '' ? '' : `${content}/`;
  return [...listJson(root, `${prefix}calendar`), ...listJson(root, `${prefix}passages`)];
}

/** A gate context over the working tree: every given file counts as added; nothing exists on the base. */
export function contentContext(files: readonly string[] = contentFiles(), root: string = REPO_ROOT): GateContext {
  const changed: ChangedFile[] = files.map((path) => ({ path, status: 'added' }));
  const git: Git = { changedFiles: () => changed, show: () => null };
  const config = loadConfig(undefined, { cwd: root });
  return createContext({
    root,
    base: 'working-tree',
    head: 'working-tree',
    config,
    providers: createProviders(config, {}),
    git,
  });
}

const runs = new Map<string, Promise<GateResult>>();

/** The gate's result over `files`, computed once per gate and file list. */
export function gateResult(gate: Gate, files?: readonly string[]): Promise<GateResult> {
  const key = `${gate.id}\0${(files ?? []).join('\0')}`;
  let run = runs.get(key);
  if (run === undefined) {
    run = runGates([gate], contentContext(files)).then((report) => report.results[0] as GateResult);
    runs.set(key, run);
  }
  return run;
}

/** Registers the named test for `ruleId`. */
export function gateTest(ruleId: string, options: GateTestOptions = {}): void {
  const gate = options.gate ?? GATES.find((entry) => entry.id === gateOfRule(ruleId));
  if (gate === undefined) throw new Error(`gateTest: no gate "${gateOfRule(ruleId)}" for rule ${ruleId}`);
  const rule = gate.rules.find((entry) => entry.id === ruleId);
  if (rule === undefined) {
    if (gate.rules.length === 0) {
      it.skip(`${ruleId}: gate "${gate.id}" is not implemented yet`, () => undefined);
      return;
    }
    throw new Error(`gateTest: gate "${gate.id}" declares no rule ${ruleId}`);
  }
  const allow = new Set<Severity>(options.allow ?? ['info']);
  it(`${ruleId}: ${rule.statement}`, async () => {
    const result = await gateResult(gate, options.files);
    const rules = ruleBookFor([gate]);
    const runnerProblems = result.items.filter((item) => gateOfRule(item.ruleId) === 'runner');
    const findings = result.items.filter((item) => item.ruleId === ruleId && !allow.has(item.severity));
    expect([...runnerProblems, ...findings].map((item) => formatFinding(item, rules))).toEqual([]);
  });
}
