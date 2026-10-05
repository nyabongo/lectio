import { describe, expect, it } from 'vitest';

import * as entry from './index.ts';

describe('@lectio/provider-s3 entry point', () => {
  it('exports the storage, env helpers and cache policy', () => {
    expect(entry.packageName).toBe('@lectio/provider-s3');
    expect(typeof entry.S3ObjectStorage).toBe('function');
    expect(typeof entry.s3StorageProvider).toBe('function');
    expect(entry.IMMUTABLE_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
    expect(entry.NO_CACHE_CONTROL).toBe('no-cache');
  });
});
