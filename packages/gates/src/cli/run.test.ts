import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { validateGateResult } from '@lectio/schema/gate-result';

import { DUMMY_DIFF, DUMMY_FILES, dummyGate, passingGate } from '../core/fixtures/dummy-gate.ts';
import { COMMENT_MARKER_LINE } from '../core/markdown.ts';
import type * as MergeRule from '../merge-rule/index.ts';
import { GATES, GATE_IDS } from '../registry.ts';
import { USAGE, runGatesCli } from './run.ts';
import type { GatesCliOptions } from './run.ts';

let dir: string;
let logs: string[];
let errors: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lectio-gates-cli-'));
  mkdirSync(join(dir, 'passages'));
  for (const [path, text] of Object.entries(DUMMY_FILES)) writeFileSync(join(dir, path), text);
  logs = [];
  errors = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<GatesCliOptions> = {}): GatesCliOptions {
  return {
    cwd: dir,
    env: {},
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    gates: [passingGate, dummyGate],
    gitExec: () => DUMMY_DIFF,
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

const read = (path: string): string => readFileSync(join(dir, path), 'utf8');

describe('lectio-gates run', () => {
  it('runs a dummy gate end to end: exit code, log, JSON report and PR comment', async () => {
    const code = await runGatesCli(
      ['run', '--root', '.', '--base', 'origin/main', '--json', 'out/gates.json', '--markdown', 'out/comment.md'],
      options(),
    );
    expect(code).toBe(1);
    expect(errors).toEqual([]);
    expect(logs[0]).toBe('always-pass: pass');
    expect(logs[1]).toBe('dummy: fail (4 findings)');
    expect(logs).toContain(
      [
        '  passages/MT.20.1-16.json#/claims/1/sourceIds [c2] dummy/claim-cites-source (error): claim c2 cites no source',
        '    Rule: Every claim cites at least one source.',
        '    Fix: Add the id of a supporting source to the claim’s sourceIds.',
      ].join('\n'),
    );
    expect(logs.at(-1)).toBe('lectio-gates: fail');

    const json = read('out/gates.json');
    const report = JSON.parse(json) as { results: unknown[] };
    for (const result of report.results) expect(validateGateResult(result)).toBe(true);
    expect(json).toMatchSnapshot('gates.json');

    const comment = read('out/comment.md');
    expect(comment.startsWith(COMMENT_MARKER_LINE)).toBe(true);
    expect(comment).toMatchSnapshot('comment.md');
  });

  it('exits 0 when nothing fails and writes nothing without --json/--markdown', async () => {
    expect(await runGatesCli(['--', 'run', '--gates', 'always-pass'], options())).toBe(0);
    expect(logs).toEqual(['always-pass: pass', 'lectio-gates: pass']);
  });

  it('exits 0 for a flag (needs review is not a failure)', async () => {
    const code = await runGatesCli(['run'], options({ gates: [{ ...dummyGate, run: () => flagLike() }] }));
    expect(code).toBe(0);
    expect(logs.at(-1)).toBe('lectio-gates: flag');
  });

  it('defaults to the five registry gates', async () => {
    expect(await runGatesCli(['run', '--gates', 'nope'], options({ gates: undefined }))).toBe(2);
    expect(errors[0]).toBe(`lectio-gates: unknown gate nope (known: ${GATE_IDS.join(', ')})`);
    expect(errors[1]).toBe(USAGE);
  });

  it('loads config and providers itself when not injected', async () => {
    const code = await runGatesCli(['run', '--gates', 'always-pass'], options({ config: undefined }));
    expect(code).toBe(0);
  });

  // The gates still on their L-023 stub; each of L-024 to L-028 drops out of this list when it lands.
  const stubs = GATES.filter((gate) => gate.rules.length === 0);
  it.skipIf(stubs.length === 0)('runs the stubs from the real registry', async () => {
    const list = stubs.map((gate) => gate.id).join(' , ');
    const code = await runGatesCli(['run', '--gates', list], options({ gates: undefined }));
    expect(code).toBe(0);
    expect(logs).toHaveLength(stubs.length + 1);
    stubs.forEach((gate, i) => {
      expect(logs[i]).toMatch(new RegExp(`^${gate.id}: skipped \\(not implemented \\(L-02[4-8]\\)\\)$`));
    });
    expect(logs.at(-1)).toBe('lectio-gates: skipped');
  });

  it('refuses a --head that is not checked out at --root, and accepts one that is', async () => {
    const gitExec = (args: readonly string[]): string => {
      if (args[0] !== 'rev-parse') return DUMMY_DIFF;
      return args.at(-1) === 'HEAD^{commit}' ? 'aaa\n' : args.at(-1) === 'pr-head^{commit}' ? 'aaa\n' : 'bbb\n';
    };
    expect(await runGatesCli(['run', '--head', 'other', '--gates', 'always-pass'], options({ gitExec }))).toBe(2);
    expect(errors[0]).toBe(`lectio-gates: --head other is not the commit checked out at ${dir}; check it out first`);
    expect(await runGatesCli(['run', '--head', 'pr-head', '--gates', 'always-pass'], options({ gitExec }))).toBe(0);
  });

  it('rejects unknown flags', async () => {
    expect(await runGatesCli(['run', '--nope'], options())).toBe(2);
    expect(errors[0]).toMatch(/^lectio-gates: Unknown option '--nope'/);
  });

  it('lets other errors through (here: real git outside a repository)', async () => {
    await expect(runGatesCli(['run'], options({ gitExec: undefined }))).rejects.toThrow(/git/);
  });
});

function flagLike(): ReturnType<typeof dummyGate.run> {
  return {
    gate: 'dummy',
    status: 'flag',
    items: [{ ruleId: 'dummy/summary-short', severity: 'warning', pointer: '', message: 'long' }],
    meta: {},
  };
}

describe('lectio-gates decide', () => {
  async function writeReport(): Promise<void> {
    await runGatesCli(['run', '--json', 'gates.json'], options());
    logs = [];
  }

  it('passes the results to the merge rule and exits 1 unless approved', async () => {
    await writeReport();
    const pr = {
      number: 7,
      files: ['config/lectio.config.json'],
      reviewEdits: [],
      approval: null,
      approvalCommit: null,
      lastContentCommitAt: null,
      fork: false,
    };
    writeFileSync(join(dir, 'pr.json'), JSON.stringify(pr));
    const code = await runGatesCli(
      ['decide', '--results', 'gates.json', '--pr', 'pr.json', '--json', 'out/decision.json'],
      options(),
    );
    expect(code).toBe(1);
    expect(logs[0]).toBe('decision: blocked');
    expect(JSON.parse(read('out/decision.json'))).toMatchObject({ decision: 'blocked' });
  });

  it('builds the PR facts from git when --pr is missing', async () => {
    await writeReport();
    const seen: string[][] = [];
    const gitExec = (args: readonly string[]): string => {
      seen.push([...args]);
      return DUMMY_DIFF;
    };
    expect(await runGatesCli(['decide', '--results', 'gates.json', '--base', 'main'], options({ gitExec }))).toBe(1);
    expect(seen).toEqual([['diff', '--name-status', '-z', 'main...HEAD']]);
    expect(logs).toEqual(['decision: blocked', '  - the dummy gate failed']);
  });

  it('without --pr, checks review blocks set to approved and the old paths of renames', async () => {
    writeFileSync(join(dir, 'gates.json'), JSON.stringify({ results: [] }));
    const rename = ['R100', 'config/old.json', 'passages/NEW.json', ''].join('\0');
    const gitExec = (args: readonly string[]): string => (args[0] === 'diff' ? rename : '');
    const passage = (status: string) => JSON.stringify({ claims: [{ id: 'c1' }], review: { status } });

    writeFileSync(join(dir, 'passages/NEW.json'), passage('approved'));
    expect(await runGatesCli(['decide', '--results', 'gates.json'], options({ gitExec }))).toBe(1);
    expect(logs).toContain(
      '  - passages/NEW.json sets its review block to approved without a verified approval or a valid approval commit',
    );

    logs = [];
    writeFileSync(join(dir, 'passages/NEW.json'), passage('pending'));
    expect(await runGatesCli(['decide', '--results', 'gates.json'], options({ gitExec }))).toBe(1);
    expect(logs).toContain('  - config/old.json is under config/** (never auto-merged)');
  });

  it('decide refuses a --head that is not checked out', async () => {
    await writeReport();
    const gitExec = (args: readonly string[]): string => (args.at(-1) === 'HEAD^{commit}' ? 'aaa' : 'bbb');
    expect(await runGatesCli(['decide', '--results', 'gates.json', '--head', 'feature'], options({ gitExec }))).toBe(2);
    expect(errors[0]).toMatch(/--head feature is not the commit checked out/);
  });

  it('exits 0 for a green decision and passes --pr-number into the facts', async () => {
    await writeReport();
    vi.resetModules();
    const inputs: unknown[] = [];
    vi.doMock('../merge-rule/index.ts', async (importOriginal) => ({
      ...(await importOriginal<typeof MergeRule>()),
      decide: (input: unknown) => {
        inputs.push(input);
        return { decision: 'auto-merge', reasons: [] };
      },
    }));
    const cli = await import('./run.ts');
    expect(await cli.runGatesCli(['decide', '--results', 'gates.json', '--pr-number', '42'], options())).toBe(0);
    expect(logs).toEqual(['decision: auto-merge']);
    expect(inputs[0]).toMatchObject({
      pr: { number: 42, files: expect.arrayContaining(['docs/notes.md']) as unknown, approval: null },
    });
    vi.doUnmock('../merge-rule/index.ts');
    vi.resetModules();
  });

  it.each([
    [[], 'decide needs --results <gates.json>'],
    [['--results', 'bad.json'], 'bad.json: not valid JSON'],
    [['--results', 'empty.json'], 'empty.json: expected a gate report with a "results" array'],
    [['--results', 'null.json'], 'null.json: expected a gate report with a "results" array'],
    [['--results', 'invalid.json'], 'invalid.json: results/0 is not a valid gate result'],
    [['--results', 'gates.json', '--pr', 'bad.json'], 'bad.json: not valid JSON'],
    [
      ['--results', 'gates.json', '--pr', 'gates.json'],
      'gates.json: not valid pull request facts: number: missing or of the wrong type',
    ],
  ])('rejects bad input %j without a stack trace', async (args, message) => {
    await writeReport();
    writeFileSync(join(dir, 'bad.json'), '{');
    writeFileSync(join(dir, 'empty.json'), '{}');
    writeFileSync(join(dir, 'null.json'), 'null');
    writeFileSync(join(dir, 'invalid.json'), '{"results":[{"gate":"x"}]}');
    expect(await runGatesCli(['decide', ...args], options())).toBe(2);
    expect(errors[0]?.startsWith(`lectio-gates: ${message}`)).toBe(true);
  });
});

describe('lectio-gates usage', () => {
  it('prints usage for help and exits 2 without a command', async () => {
    expect(await runGatesCli(['--help'], options())).toBe(0);
    expect(await runGatesCli(['help'], options())).toBe(0);
    expect(await runGatesCli(['-h'], options())).toBe(0);
    expect(await runGatesCli([], options())).toBe(2);
    expect(logs).toEqual([USAGE, USAGE, USAGE, USAGE]);
  });

  it('rejects an unknown command', async () => {
    expect(await runGatesCli(['merge'], options())).toBe(2);
    expect(errors).toEqual(['lectio-gates: unknown command "merge"', USAGE]);
  });
});
