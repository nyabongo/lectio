import { describe, expect, it } from 'vitest';

import * as publish from './index.ts';

describe('publish exports', () => {
  it('exposes the publishing API for the CLI (L-038)', () => {
    expect(typeof publish.publishPassage).toBe('function');
    expect(typeof publish.publishAll).toBe('function');
    expect(typeof publish.formatJson).toBe('function');
    expect(publish.RESEARCH_LABEL).toBe('research');
    expect(publish.RESEARCH_TRAILER).toBe('Lectio-Research');
    expect(publish.GATE_SLUGS).toEqual(['schema', 'evidence', 'licence', 'verifiers', 'merge-rule']);
  });
});
