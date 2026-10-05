import { describeObjectStorageContract } from '@lectio/providers/contracts';
import { describe } from 'vitest';

import { s3OptionsFromEnv } from './env.ts';
import { mockBucket } from './fixtures/mock-bucket.ts';
import { S3ObjectStorage } from './s3-storage.ts';

// Offline: the real client code against an in-memory bucket behind aws-sdk-client-mock.
describeObjectStorageContract(() => new S3ObjectStorage({ bucket: 'lectio-audio', client: mockBucket().client }), {
  name: 's3 (aws-sdk-client-mock)',
});

// Live (L-212): only with `npm run test:live` and the bucket secrets. Writes under a scratch prefix.
const liveOptions = process.env['LECTIO_LIVE'] === '1' ? s3OptionsFromEnv(process.env) : null;

describe.runIf(liveOptions !== null)('live', () => {
  describeObjectStorageContract(() => new S3ObjectStorage(liveOptions as NonNullable<typeof liveOptions>), {
    name: 's3 (live)',
    prefix: `contract/${Date.now().toString(36)}/`,
    timeoutMs: 30_000,
  });
});
