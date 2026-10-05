import { describe, expect, it } from 'vitest';

import { RUNNER_RULES, createRuleBook, defineRule, gateOfRule } from './rules.ts';

describe('defineRule', () => {
  it('returns a frozen rule with trimmed texts', () => {
    const rule = defineRule('schema/claim-has-source', ' Every claim cites a source. ', ' Add one. ');
    expect(rule).toEqual({ id: 'schema/claim-has-source', statement: 'Every claim cites a source.', fix: 'Add one.' });
    expect(Object.isFrozen(rule)).toBe(true);
  });

  it.each(['claim-has-source', 'Schema/x', 'schema/', 'schema/a_b', 'a/b/c'])('rejects the id %j', (id) => {
    expect(() => defineRule(id, 'statement', 'fix')).toThrow(/<gate>\/<rule>/);
  });

  it('requires a statement and a fix', () => {
    expect(() => defineRule('a/b', ' ', 'fix')).toThrow('rule a/b needs a statement');
    expect(() => defineRule('a/b', 'statement', '')).toThrow('rule a/b needs a "how to fix" text');
  });
});

describe('gateOfRule', () => {
  it('returns the prefix', () => {
    expect(gateOfRule('merge-rule/protected-path')).toBe('merge-rule');
  });
});

describe('createRuleBook', () => {
  const a = defineRule('schema/a', 'A holds.', 'Fix A.');
  const b = defineRule('evidence/b', 'B holds.', 'Fix B.');

  it('indexes rules by id', () => {
    const book = createRuleBook([a, b]);
    expect([...book.keys()]).toEqual(['schema/a', 'evidence/b']);
    expect(book.get('evidence/b')).toBe(b);
  });

  it('rejects duplicate ids', () => {
    expect(() => createRuleBook([a, a])).toThrow('duplicate rule id schema/a');
  });

  it('rejects a rule outside its owners', () => {
    expect(() => createRuleBook([a, b], new Set(['schema']))).toThrow(
      'rule evidence/b does not belong to any of: schema',
    );
  });

  it('declares the runner rules under the runner prefix', () => {
    expect(Object.values(RUNNER_RULES).map((rule) => gateOfRule(rule.id))).toEqual(['runner', 'runner', 'runner']);
  });
});
