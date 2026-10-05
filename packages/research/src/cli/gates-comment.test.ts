import { COMMENT_MARKER_LINE, GATES, allRules, renderComment, statusOf } from '@lectio/gates';
import type { GateReport, GateResultItem } from '@lectio/gates';
import type { IssueComment } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import {
  FIXUP_RULES,
  GATES_BOT,
  GateOutputError,
  fixupFindings,
  latestGatesComment,
  parseGatesComment,
  parseGatesReport,
  ranOnHead,
} from './gates-comment.ts';

const PATH = 'passages/MT.20.1-16.json';

const ITEMS: GateResultItem[] = [
  {
    ruleId: 'verifiers/claim-not-refuted',
    severity: 'error',
    file: PATH,
    pointer: '/claims/1',
    claimId: 'c2',
    message: 'c2 “An <evil> eye & more”: refuted',
  },
  {
    ruleId: 'verifiers/claim-supported',
    severity: 'warning',
    file: PATH,
    pointer: '/claims/0',
    claimId: 'c1',
    message: 'c1: support 0.6',
  },
  {
    ruleId: 'verifiers/claim-not-sensitive',
    severity: 'warning',
    file: PATH,
    pointer: '/claims/2',
    claimId: 'c3',
    message: 'sensitive',
  },
  {
    ruleId: 'schema/no-fake-provenance',
    severity: 'error',
    file: PATH,
    pointer: '/provenance/generator',
    message: 'fake',
  },
  { ruleId: 'merge-rule/needs-review', severity: 'info', pointer: '', message: 'waits for a person' },
];

function report(items: GateResultItem[] = ITEMS, head = 'abcdef1234567'): GateReport {
  const byGate = (gate: string): GateResultItem[] => items.filter((item) => item.ruleId.startsWith(`${gate}/`));
  return {
    reportVersion: 1,
    status: 'fail',
    base: 'main',
    head,
    changedFiles: [PATH],
    results: ['schema', 'verifiers', 'merge-rule'].map((gate) => ({
      gate,
      status: statusOf(byGate(gate)),
      items: byGate(gate),
      meta: {},
    })),
  } as GateReport;
}

const comment = (id: number, author: string, body: string, updatedAt: string): IssueComment => ({
  id,
  author,
  body,
  createdAt: '2026-10-05T08:00:00Z',
  updatedAt,
});

describe('latestGatesComment', () => {
  it('takes the bot comment with the marker line, latest update first, and ignores everyone else', () => {
    const body = `${COMMENT_MARKER_LINE}\n## Lectio gates`;
    const comments = [
      comment(1, GATES_BOT, body, '2026-10-05T08:00:00Z'),
      comment(2, 'mallory', body, '2026-10-05T10:00:00Z'),
      comment(3, GATES_BOT, `quoted ${COMMENT_MARKER_LINE}`, '2026-10-05T11:00:00Z'),
      comment(4, GATES_BOT, body, '2026-10-05T09:00:00Z'),
    ];
    expect(latestGatesComment(comments)?.id).toBe(4);
    expect(latestGatesComment(comments.slice(1, 3))).toBeUndefined();
    expect(latestGatesComment(comments, 'mallory')?.id).toBe(2);
  });
});

describe('parseGatesComment', () => {
  it('reads every finding of a rendered comment back, with file, claim and head', () => {
    const parsed = parseGatesComment(renderComment(report(), { gates: GATES, rules: allRules() }));
    expect(parsed.head).toBe('abcdef1234567');
    expect(parsed.truncated).toBe(false);
    expect(parsed.findings).toHaveLength(ITEMS.length);
    for (const item of ITEMS) expect(parsed.findings).toContainEqual(item);
  });

  it('notices a comment cut at its size limit', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...(ITEMS[0] as GateResultItem),
      claimId: `c${String(index + 1)}`,
    }));
    const body = renderComment(report(many), { gates: GATES, rules: allRules(), maxLength: 3000 });
    const parsed = parseGatesComment(body);
    expect(parsed.truncated).toBe(true);
    expect(parsed.findings.length).toBeLessThan(40);
  });

  it('finds nothing in text that is not a gates comment', () => {
    expect(parseGatesComment('hello\n- **error** without a rule')).toEqual({
      head: null,
      findings: [],
      truncated: false,
    });
  });
});

describe('parseGatesReport', () => {
  it('reads the findings and the head of a gates.json artifact', () => {
    const parsed = parseGatesReport(JSON.stringify(report()), 'gates.json');
    expect(parsed).toMatchObject({ head: 'abcdef1234567', truncated: false });
    expect(parsed.findings).toHaveLength(ITEMS.length);
    expect(parsed.findings).toEqual(expect.arrayContaining(ITEMS));
    const noHead = parseGatesReport(JSON.stringify({ results: [] }), 'gates.json');
    expect(noHead.head).toBeNull();
  });

  it('refuses what is not a gate report', () => {
    expect(() => parseGatesReport('{', 'g.json')).toThrow(GateOutputError);
    expect(() => parseGatesReport('null', 'g.json')).toThrow('g.json: expected a gate report with a "results" array');
    expect(() => parseGatesReport('{"results":[{"gate":1}]}', 'g.json')).toThrow(
      'g.json: results/0 is not a valid gate result',
    );
  });
});

describe('fixupFindings', () => {
  it('keeps only refutations and low support on the PR passage', () => {
    const other = { ...(ITEMS[0] as GateResultItem), file: 'passages/OTHER.json' };
    expect(fixupFindings([...ITEMS, other], PATH)).toEqual([ITEMS[0], ITEMS[1]]);
    expect(FIXUP_RULES).toEqual(['verifiers/claim-not-refuted', 'verifiers/claim-supported']);
    expect(fixupFindings([{ ...(ITEMS[1] as GateResultItem), severity: 'info' }], PATH)).toEqual([]);
  });
});

describe('ranOnHead', () => {
  it('matches a sha or its prefix, and trusts output that names no sha', () => {
    expect(ranOnHead('abcdef1', 'abcdef1234')).toBe(true);
    expect(ranOnHead('1234567', 'abcdef1234')).toBe(false);
    expect(ranOnHead(null, 'abcdef1234')).toBe(true);
    expect(ranOnHead('HEAD', 'abcdef1234')).toBe(true);
  });
});
