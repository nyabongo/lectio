import { describe, expect, it } from 'vitest';

import { validateGateResult } from '@lectio/schema/gate-result';

import { finding, formatFinding, resultFromFindings, skipReason, skippedResult, statusOf } from './result.ts';
import { createRuleBook, defineRule } from './rules.ts';

const rule = defineRule('schema/claim-has-source', 'Every claim cites a source.', 'Add a source id.');

describe('finding', () => {
  it('defaults to an error on the whole file', () => {
    expect(finding(rule, { file: 'passages/A.1.json', message: ' no source ' })).toEqual({
      ruleId: 'schema/claim-has-source',
      severity: 'error',
      pointer: '',
      file: 'passages/A.1.json',
      message: 'no source',
    });
  });

  it('keeps pointer, claim and severity; omits a missing file', () => {
    expect(finding(rule, { pointer: '/claims/0', claimId: 'c1', severity: 'warning', message: 'm' })).toEqual({
      ruleId: 'schema/claim-has-source',
      severity: 'warning',
      pointer: '/claims/0',
      claimId: 'c1',
      message: 'm',
    });
  });
});

describe('statusOf and resultFromFindings', () => {
  const error = finding(rule, { message: 'e' });
  const warning = finding(rule, { message: 'w', severity: 'warning' });
  const info = finding(rule, { message: 'i', severity: 'info' });

  it.each([
    [[], 'pass'],
    [[info], 'pass'],
    [[info, warning], 'flag'],
    [[warning, error], 'fail'],
  ] as const)('derives the status from %j', (items, status) => {
    expect(statusOf(items)).toBe(status);
    const result = resultFromFindings('schema', items, { n: 1 });
    expect(result).toEqual({ gate: 'schema', status, items, meta: { n: 1 } });
    expect(validateGateResult(result)).toBe(true);
  });

  it('defaults meta to an empty object', () => {
    expect(resultFromFindings('schema', []).meta).toEqual({});
  });
});

describe('skippedResult', () => {
  it('records the reason in meta and validates', () => {
    const result = skippedResult('verifiers', 'no API keys', { model: 'x' });
    expect(result).toEqual({
      gate: 'verifiers',
      status: 'skipped',
      items: [],
      meta: { model: 'x', reason: 'no API keys' },
    });
    expect(validateGateResult(result)).toBe(true);
    expect(skipReason(result)).toBe('no API keys');
    expect(skippedResult('a', 'r').meta).toEqual({ reason: 'r' });
  });

  it('skipReason is undefined without a string reason', () => {
    expect(skipReason(resultFromFindings('schema', [], { reason: 3 }))).toBeUndefined();
  });
});

describe('formatFinding', () => {
  const rules = createRuleBook([rule]);

  it('names the place, claim, rule, statement and fix', () => {
    const item = finding(rule, {
      file: 'passages/A.1.json',
      pointer: '/claims/0',
      claimId: 'c1',
      message: 'no source',
    });
    expect(formatFinding(item, rules)).toBe(
      [
        'passages/A.1.json#/claims/0 [c1] schema/claim-has-source (error): no source',
        '  Rule: Every claim cites a source.',
        '  Fix: Add a source id.',
      ].join('\n'),
    );
  });

  it('handles whole-file, whole-PR and unknown-rule findings', () => {
    expect(formatFinding(finding(rule, { file: 'a.json', message: 'm' }), new Map())).toBe(
      'a.json schema/claim-has-source (error): m',
    );
    expect(formatFinding(finding(rule, { message: 'm', severity: 'info' }), new Map())).toBe(
      '(pull request) schema/claim-has-source (info): m',
    );
  });
});
