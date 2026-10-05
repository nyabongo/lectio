import { describe, expect, it } from 'vitest';

import * as lectionary from './index.ts';

describe('@lectio/lectionary entry point', () => {
  it('exports its package name and public API', () => {
    expect(lectionary.packageName).toBe('@lectio/lectionary');
    for (const name of [
      'resolveDay',
      'Lectionary',
      'checkLectionary',
      'crosscheckBlock',
      'importLitcal',
      'toCanonical',
    ]) {
      expect(lectionary).toHaveProperty(name);
    }
  });
});
