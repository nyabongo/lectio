import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { createProviders } from '@lectio/providers';

import { DUMMY_DIFF, DUMMY_FILES, dummyGate, passingGate } from './fixtures/dummy-gate.ts';
import type { Gate, GateContext } from './gate.ts';
import { createContext } from './gate.ts';
import { createGit } from './git.ts';
import { finding, resultFromFindings, skippedResult } from './result.ts';
import { RUNNER_RULES, defineRule } from './rules.ts';
import { REPORT_VERSION, overallStatus, runGates } from './runner.ts';

function context(): GateContext {
  return createContext({
    root: '/repo',
    base: 'origin/main',
    head: 'HEAD',
    config: DEFAULT_CONFIG,
    providers: createProviders(DEFAULT_CONFIG),
    git: createGit('/repo', () => DUMMY_DIFF),
    readText: (path) => DUMMY_FILES[path.slice('/repo/'.length)] ?? null,
  });
}

const gate = (id: string, run: Gate['run'], rules: Gate['rules'] = []): Gate => ({ id, title: id, rules, run });

describe('overallStatus', () => {
  it.each([
    [[], 'skipped'],
    [['skipped'], 'skipped'],
    [['skipped', 'pass'], 'pass'],
    [['pass', 'flag'], 'flag'],
    [['flag', 'fail', 'pass'], 'fail'],
  ] as const)('%j → %s', (statuses, expected) => {
    expect(overallStatus(statuses.map((status) => ({ gate: 'g', status, items: [], meta: {} }) as never))).toBe(
      expected,
    );
  });
});

describe('runGates', () => {
  it('runs gates in order and reports base, head, changed files and results', async () => {
    const report = await runGates([passingGate, dummyGate], context());
    expect(report).toMatchObject({
      reportVersion: REPORT_VERSION,
      status: 'fail',
      base: 'origin/main',
      head: 'HEAD',
      changedFiles: ['docs/notes.md', 'passages/IS.55.6-9.json', 'passages/MT.20.1-16.json', 'passages/OLD.json'],
    });
    expect(report.results.map((result) => [result.gate, result.status])).toEqual([
      ['always-pass', 'pass'],
      ['dummy', 'fail'],
    ]);
  });

  it('gives each gate the results of the gates before it', async () => {
    const seen: string[][] = [];
    const spy = gate('spy', (ctx) => {
      seen.push(ctx.results.map((result) => result.gate));
      return skippedResult('spy', 'r');
    });
    await runGates([passingGate, spy, { ...spy, id: 'spy2', run: (ctx) => spy.run(ctx) as never }], context());
    expect(seen).toEqual([['always-pass'], ['always-pass', 'spy']]);
  });

  it('turns a throwing gate into a fail and keeps going', async () => {
    const report = await runGates(
      [
        gate('boom', () => {
          throw new Error('cannot\n  parse');
        }),
        gate('reject', () => Promise.reject(new Error(''))),
        gate('odd', () => {
          throw 'plain string';
        }),
        passingGate,
      ],
      context(),
    );
    expect(report.status).toBe('fail');
    expect(report.results.map((result) => [result.gate, result.status, result.items[0]?.message])).toEqual([
      ['boom', 'fail', 'boom threw: cannot parse'],
      ['reject', 'fail', 'reject threw: (no message)'],
      ['odd', 'fail', 'odd threw: plain string'],
      ['always-pass', 'pass', undefined],
    ]);
    expect(report.results[0]).toMatchObject({ meta: { crashed: true }, items: [{ ruleId: RUNNER_RULES.crashed.id }] });
  });

  it('fails a gate whose result does not validate or names another gate', async () => {
    const report = await runGates(
      [
        gate('bad', () => ({ gate: 'bad', status: 'fail', items: [], meta: {} })),
        gate('other', () => resultFromFindings('someone-else', [])),
      ],
      context(),
    );
    expect(report.results.map((result) => result.items.map((item) => [item.ruleId, item.message]))).toEqual([
      [[RUNNER_RULES.invalidResult.id, expect.stringMatching(/^bad returned an invalid result: \/items /)]],
      [[RUNNER_RULES.invalidResult.id, 'other returned a result for "someone-else"']],
    ]);
  });

  it('fails a gate that reports an undeclared rule, once per rule', async () => {
    const declared = defineRule('strict/known', 'Known.', 'Fix.');
    const undeclared = defineRule('strict/unknown', 'Unknown.', 'Fix.');
    const strict = gate(
      'strict',
      () =>
        resultFromFindings('strict', [
          finding(declared, { message: 'a', severity: 'warning' }),
          finding(undeclared, { message: 'b', severity: 'info' }),
          finding(undeclared, { message: 'c', severity: 'info' }),
        ]),
      [declared],
    );
    const [result] = (await runGates([strict], context())).results;
    expect(result?.status).toBe('fail');
    expect(result?.items.map((item) => item.ruleId)).toEqual([
      'strict/known',
      'strict/unknown',
      'strict/unknown',
      RUNNER_RULES.unknownRule.id,
    ]);
    expect(result?.items.at(-1)?.message).toBe('strict reported undeclared rule strict/unknown');
  });
});
