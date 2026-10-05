import { describe, expect, it } from 'vitest';

import { audioKey, buildSegments, packageName, passagesOf, speakable } from './index.ts';

describe('@lectio/audio', () => {
  it('exports its package name and the narration script builder', () => {
    expect(packageName).toBe('@lectio/audio');
    expect([audioKey, buildSegments, passagesOf, speakable].every((fn) => typeof fn === 'function')).toBe(true);
  });
});
