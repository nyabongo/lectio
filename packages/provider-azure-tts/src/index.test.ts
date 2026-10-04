import { describe, expect, it } from 'vitest';

import { packageName } from './index.ts';

describe('@lectio/provider-azure-tts placeholder', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/provider-azure-tts');
  });
});
