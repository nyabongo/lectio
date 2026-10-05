import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';

describe('@lectio/schema placeholder', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/schema');
  });
});
