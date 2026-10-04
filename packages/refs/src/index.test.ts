import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';

describe('@lectio/refs placeholder', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/refs');
  });
});
