import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';

describe('@lectio/calendar placeholder', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/calendar');
  });
});
