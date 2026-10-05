import { describe, expect, it } from 'vitest';

import { DUMMY_RULES, dummyGate } from './fixtures/dummy-gate.ts';
import { COMMENT_MARKER_LINE, renderComment } from './markdown.ts';
import { finding, resultFromFindings, skippedResult } from './result.ts';
import type { GateResult } from './result.ts';
import { createRuleBook, defineRule } from './rules.ts';
import type { GateReport } from './runner.ts';
import { overallStatus } from './runner.ts';

function report(results: GateResult[], changedFiles: string[] = ['passages/A.1.json']): GateReport {
  return { reportVersion: 1, status: overallStatus(results), base: 'origin/main', head: 'HEAD', changedFiles, results };
}

const rules = createRuleBook(Object.values(DUMMY_RULES));
const gates = [dummyGate];

describe('renderComment', () => {
  it('starts with the hidden marker and says when there are no findings', () => {
    const text = renderComment(
      report([resultFromFindings('dummy', []), skippedResult('later', 'not implemented (L-099)')], []),
      {
        gates,
        rules,
      },
    );
    expect(text.startsWith(`${COMMENT_MARKER_LINE}\n## Lectio gates: all gates passed\n`)).toBe(true);
    expect(text).toContain('| Dummy gate (`dummy`) | Pass | no findings |');
    expect(text).toContain('| later (`later`) | Skipped | not implemented (L-099) |');
    expect(text).toContain('No findings.');
    expect(text).toContain('0 changed files');
    expect(text.endsWith('</sub>\n')).toBe(true);
  });

  it('shows skipped gates without a reason and an empty run', () => {
    const skipped: GateResult = { gate: 'x', status: 'skipped', items: [], meta: {} };
    expect(renderComment(report([skipped]), { gates, rules })).toContain('| x (`x`) | Skipped |  |');
    expect(renderComment(report([]), { gates, rules })).toContain('## Lectio gates: no gate ran');
  });

  it('groups by file then claim, orders severities and escapes text', () => {
    const other = defineRule('other/rule', 'Other <rule> holds.', 'Fix | it.');
    const result = resultFromFindings('dummy', [
      finding(DUMMY_RULES.claimCited, { file: 'passages/B.json', claimId: 'c10', message: 'ten' }),
      finding(DUMMY_RULES.claimCited, { file: 'passages/B.json', claimId: 'c2', message: 'two' }),
      finding(DUMMY_RULES.summaryShort, { file: 'passages/B.json', severity: 'info', message: 'note' }),
      finding(DUMMY_RULES.summaryShort, { file: 'passages/B.json', pointer: '/b', severity: 'warning', message: 'w' }),
      finding(DUMMY_RULES.summaryShort, { file: 'passages/B.json', pointer: '/a', severity: 'warning', message: 'w' }),
      finding(DUMMY_RULES.fileCount, { message: 'whole <!-- lectio-gates --> PR\nsecond line' }),
      finding(DUMMY_RULES.claimCited, { file: 'passages/A.json', pointer: '/x`y', claimId: 'c1', message: 'a & b' }),
      finding(DUMMY_RULES.summaryShort, { file: 'passages/A.json', pointer: '/x`y', claimId: 'c1', message: 'z' }),
      finding(DUMMY_RULES.fileCount, { file: 'passages/A.json', pointer: '/x`y', claimId: 'c1', message: 'y' }),
    ]);
    const flagged = resultFromFindings('other', [
      finding(other, { file: 'passages/B.json', claimId: 'c2', severity: 'warning', message: 'm|n' }),
      finding(DUMMY_RULES.claimCited, { file: 'passages/B.json', claimId: 'c2', message: 'same claim, later gate' }),
    ]);
    const text = renderComment(report([result, flagged]), { gates, rules: createRuleBook([...rules.values(), other]) });
    expect(text).toMatchSnapshot();
    expect(text.match(/<!-- lectio-gates -->/g)).toHaveLength(1);
  });

  it('falls back to the rule id when a rule is unknown', () => {
    const unknown = defineRule('mystery/rule', 'S.', 'F.');
    const text = renderComment(
      report([resultFromFindings('mystery', [finding(unknown, { file: 'a.json', message: 'm' })])]),
      {
        gates,
        rules,
      },
    );
    expect(text).toContain('- **error** · `mystery/rule` (mystery): m');
    expect(text).not.toContain('Rule:');
  });

  it('stays under the size limit and says how many findings it left out', () => {
    const items = Array.from({ length: 40 }, (_, index) =>
      finding(DUMMY_RULES.claimCited, {
        file: `passages/F${String(index % 4)}.json`,
        claimId: `c${String(index)}`,
        message: 'x'.repeat(100),
      }),
    );
    const maxLength = 3_000;
    const text = renderComment(report([resultFromFindings('dummy', items)]), { gates, rules, maxLength });
    expect(text.length).toBeLessThanOrEqual(maxLength);
    const shown = text.split('\n').filter((line) => line.startsWith('- **error**')).length;
    expect(shown).toBeGreaterThan(0);
    expect(text).toContain(
      `_${String(40 - shown)} more findings not shown (comment size limit); see the gates.json artifact._`,
    );
    expect(text).not.toMatch(/#### `[^`]+`\n\n#### /);
  });

  it('says "1 more finding" in the singular', () => {
    const items = [
      finding(DUMMY_RULES.claimCited, { file: 'a.json', claimId: 'c1', message: 'short' }),
      finding(DUMMY_RULES.claimCited, { file: 'b.json', claimId: 'c1', message: 'y'.repeat(2_000) }),
    ];
    const text = renderComment(report([resultFromFindings('dummy', items)]), { gates, rules, maxLength: 1_500 });
    expect(text).toContain('_1 more finding not shown');
    expect(text).toContain('#### `a.json`');
    expect(text).not.toContain('#### `b.json`');
  });
});
