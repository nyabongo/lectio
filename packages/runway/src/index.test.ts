import { describe, expect, it } from 'vitest';

import * as runway from './index.ts';

describe('@lectio/runway entry point', () => {
  it('exports its name and the monitor API', () => {
    expect(runway.packageName).toBe('@lectio/runway');
    expect(runway.RUNWAY_MARKER).toBe('lectio-runway');
    expect(typeof runway.computeRunway).toBe('function');
    expect(typeof runway.runMonitor).toBe('function');
    expect(typeof runway.runRunway).toBe('function');
  });
});
