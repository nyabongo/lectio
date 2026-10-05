import { describe, expect, it } from 'vitest';

import * as content from './index.ts';

describe('@lectio/content entry point', () => {
  it('exports the loader, the resolver helpers and the validator', () => {
    expect(content.packageName).toBe('@lectio/content');
    expect(typeof content.openRepo).toBe('function');
    expect(typeof content.approvedOnly).toBe('function');
    expect(typeof content.isApproved).toBe('function');
    expect(typeof content.runValidate).toBe('function');
    expect(content.ContentError.prototype).toBeInstanceOf(Error);
    expect([content.CALENDAR_DIR, content.PASSAGES_DIR]).toEqual(['calendar', 'passages']);
  });
});
