import { describe, expect, it } from 'vitest';

import * as gates from './index.ts';

describe('@lectio/gates entry point', () => {
  it('exports its package name and the public API', () => {
    expect(gates.packageName).toBe('@lectio/gates');
    for (const name of [
      'runGates',
      'renderComment',
      'defineRule',
      'approveHuman',
      'approveAuto',
      'decide',
      'runGatesCli',
    ]) {
      expect(typeof gates[name as keyof typeof gates]).toBe('function');
    }
    expect(gates.GATE_IDS).toHaveLength(5);
    expect(gates.COMMENT_MARKER_LINE).toBe('<!-- lectio-gates -->');
  });
});
