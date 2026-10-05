import { describe, expect, expectTypeOf, it } from 'vitest';

import { loadFixtures } from '../../fixtures/load.ts';
import { formatErrors } from '../common/index.ts';
import { JSON_POINTER_PATTERN, RULE_ID_PATTERN, validateGateResult } from './index.ts';
import type { GateResult } from './index.ts';

const EXPECTED_FAILURES: Record<string, [instancePath: string, keyword: string]> = {
  'absolute-file': ['/items/0/file', 'pattern'],
  'bad-pointer': ['/items/0/pointer', 'pattern'],
  'bad-rule-id': ['/items/0/ruleId', 'pattern'],
  'dotted-rule-id': ['/items/0/ruleId', 'pattern'],
  'fail-without-error': ['/items', 'contains'],
  'flag-without-items': ['/items', 'minItems'],
  'missing-meta': ['', 'required'],
  'pass-with-error': ['/items', 'not'],
  'unknown-status': ['/status', 'enum'],
};

describe('gate-result fixtures', () => {
  const valid = loadFixtures('gate-result', 'valid');
  const invalid = loadFixtures('gate-result', 'invalid');

  it.each([...valid])('valid/%s passes', (_name, data) => {
    const ok = validateGateResult(data);
    expect(formatErrors(ok ? [] : validateGateResult.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it.each([...invalid])('invalid/%s fails for the expected reason', (name, data) => {
    expect(validateGateResult(data)).toBe(false);
    const errors = (validateGateResult.errors ?? []).map((error) => [error.instancePath, error.keyword]);
    expect(errors).toContainEqual(EXPECTED_FAILURES[name]);
  });

  it('has an expectation for every invalid fixture and a fixture for every expectation', () => {
    expect([...invalid.keys()].sort()).toEqual(Object.keys(EXPECTED_FAILURES).sort());
  });

  it('covers every status', () => {
    const statuses = new Set([...valid.values()].map((data) => (data as GateResult).status));
    expect([...statuses].sort()).toEqual(['fail', 'flag', 'pass', 'skipped']);
  });
});

describe('patterns', () => {
  it.each(['', '/text', '/claims/0', '/a~1b', '/m~0n', '/'])('accepts the JSON pointer %j', (pointer) => {
    expect(new RegExp(JSON_POINTER_PATTERN, 'u').test(pointer)).toBe(true);
  });

  it.each(['claims/0', '/a~2', '/~'])('rejects the JSON pointer %j', (pointer) => {
    expect(new RegExp(JSON_POINTER_PATTERN, 'u').test(pointer)).toBe(false);
  });

  it.each([
    ['schema/valid-passage', true],
    ['schema/sentence-cites-claim', true],
    ['licence/quoted-english-run', true],
    ['merge-rule/protected-path', true],
    ['schema', false],
    ['schema.valid-passage', false],
    ['schema/valid/passage', false],
    ['Schema/valid-passage', false],
    ['schema/', false],
    ['/valid-passage', false],
  ] as const)('rule id %j valid: %s', (ruleId, ok) => {
    expect(new RegExp(RULE_ID_PATTERN, 'u').test(ruleId)).toBe(ok);
  });

  it('derives types from the schema', () => {
    expectTypeOf<GateResult['status']>().toEqualTypeOf<'pass' | 'fail' | 'flag' | 'skipped'>();
    expectTypeOf<GateResult['items'][number]['claimId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<GateResult['items'][number]['file']>().toEqualTypeOf<string | undefined>();
  });
});
