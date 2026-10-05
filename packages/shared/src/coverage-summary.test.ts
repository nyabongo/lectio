import { describe, expect, it } from 'vitest';

import { renderCoverageSummary } from './coverage-summary.ts';

const metric = (covered: number, total: number, pct: number | 'Unknown') => ({ covered, total, pct, skipped: 0 });

describe('renderCoverageSummary', () => {
  it('renders the totals as a Markdown table with floor status', () => {
    const summary = {
      total: {
        lines: metric(99, 100, 99),
        branches: metric(19, 20, 95),
        functions: metric(0, 0, 'Unknown'),
        statements: metric(100, 100, 100),
      },
    };
    expect(renderCoverageSummary(summary)).toBe(
      [
        '### Unit coverage (floor 96%)',
        '',
        '| Metric | Coverage | Covered/Total | ≥ floor |',
        '| --- | ---: | ---: | :---: |',
        '| Lines | 99.00% | 99/100 | ✅ |',
        '| Branches | 95.00% | 19/20 | ❌ |',
        '| Functions | 100.00% | 0/0 | ✅ |',
        '| Statements | 100.00% | 100/100 | ✅ |',
        '',
      ].join('\n'),
    );
  });

  it('throws without totals', () => {
    expect(() => renderCoverageSummary({})).toThrow('no "total" block');
    expect(() => renderCoverageSummary(null)).toThrow('no "total" block');
    expect(() => renderCoverageSummary({ total: { lines: metric(1, 1, 100) } })).toThrow('no "branches" totals');
    expect(() => renderCoverageSummary({ total: { lines: 'x' } })).toThrow('no "lines" totals');
  });
});
