import { ProviderError } from '@lectio/providers';
import type { ProviderContext } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { S3_ENV, hasS3Secrets, s3OptionsFromEnv, s3StorageProvider } from './env.ts';
import { S3ObjectStorage } from './s3-storage.ts';

const secrets = {
  [S3_ENV.bucket]: 'lectio-audio',
  [S3_ENV.accessKeyId]: 'key-id',
  [S3_ENV.secretAccessKey]: 'secret',
  [S3_ENV.r2AccountId]: 'abc123',
};

function context(
  env: Record<string, string | undefined>,
  publicBaseUrl = 'https://audio.example.org/',
): Pick<ProviderContext, 'config' | 'env'> {
  return { env, config: { tts: { storage: { provider: 's3', publicBaseUrl } } } as ProviderContext['config'] };
}

describe('s3OptionsFromEnv', () => {
  it('builds R2 options from the account id', () => {
    expect(s3OptionsFromEnv(secrets, 'https://audio.example.org/')).toEqual({
      bucket: 'lectio-audio',
      endpoint: 'https://abc123.r2.cloudflarestorage.com',
      region: 'auto',
      credentials: { accessKeyId: 'key-id', secretAccessKey: 'secret' },
      publicBaseUrl: 'https://audio.example.org/',
    });
  });

  it('prefers an explicit endpoint and region, trimming whitespace', () => {
    const options = s3OptionsFromEnv({
      ...secrets,
      [S3_ENV.endpoint]: ' https://s3.example.org ',
      [S3_ENV.region]: 'eu-west-1',
      [S3_ENV.r2AccountId]: undefined,
    });
    expect(options).toMatchObject({ endpoint: 'https://s3.example.org', region: 'eu-west-1', publicBaseUrl: '' });
  });

  it.each([S3_ENV.bucket, S3_ENV.accessKeyId, S3_ENV.secretAccessKey, S3_ENV.r2AccountId])(
    'returns null without %s',
    (name) => {
      expect(s3OptionsFromEnv({ ...secrets, [name]: '  ' })).toBeNull();
      expect(hasS3Secrets({ ...secrets, [name]: undefined })).toBe(false);
    },
  );

  it('rejects a malformed account id', () => {
    expect(() => s3OptionsFromEnv({ ...secrets, [S3_ENV.r2AccountId]: 'evil.example.org/x' })).toThrow(ProviderError);
  });

  it('reports complete secrets', () => {
    expect(hasS3Secrets(secrets)).toBe(true);
  });
});

describe('s3StorageProvider', () => {
  it('builds storage with the configured public base URL', () => {
    const storage = s3StorageProvider(context(secrets));
    expect(storage).toBeInstanceOf(S3ObjectStorage);
    expect(storage.bucket).toBe('lectio-audio');
    expect(storage.publicUrl('audio/a b.wav')).toBe('https://audio.example.org/audio/a%20b.wav');
  });

  it('names the missing secrets', () => {
    expect(() => s3StorageProvider(context({}))).toThrow(
      /S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT or R2_ACCOUNT_ID/,
    );
  });
});
