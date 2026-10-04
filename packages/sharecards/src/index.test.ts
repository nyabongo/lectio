import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';

describe('@lectio/sharecards placeholder', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/sharecards');
  });
});
