import { describe, expect, it } from 'vitest';

import * as research from './index.ts';

describe('@lectio/research', () => {
  it('exports the planner API', () => {
    expect(research.packageName).toBe('@lectio/research');
    expect(typeof research.plan).toBe('function');
    expect(typeof research.parsePlanArgs).toBe('function');
    expect(typeof research.formatPlan).toBe('function');
    expect(research.researchBranch('MT.20.1-16')).toBe('research/MT.20.1-16');
    expect(research.RESEARCH_BRANCH_PREFIX).toBe('research/');
    expect(research.NEEDS_REVIEW_LABEL).toBe('needs-review');
  });
});
