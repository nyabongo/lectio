import { describe, expect, it } from 'vitest';

import * as textguard from './index.ts';

describe('@lectio/textguard entry point', () => {
  it('exports its package name and the public API', () => {
    expect(textguard.packageName).toBe('@lectio/textguard');
    for (const name of ['buildIndex', 'loadIndex', 'longestRun', 'tokenise', 'runGuardBuild'] as const) {
      expect(typeof textguard[name]).toBe('function');
    }
    expect(textguard.DEFAULT_SHINGLE_SIZE).toBe(8);
  });
});
