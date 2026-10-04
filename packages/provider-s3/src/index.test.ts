import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';

describe('@lectio/provider-s3 placeholder', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/provider-s3');
  });
});
