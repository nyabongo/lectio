import { ProviderError } from '@lectio/providers';
import type { ProviderContext } from '@lectio/providers';

import { S3ObjectStorage, r2Endpoint } from './s3-storage.ts';
import type { S3ObjectStorageOptions } from './s3-storage.ts';

/** Environment variables (CI secrets) that configure the bucket. */
export const S3_ENV = {
  /** Bucket name. Required. */
  bucket: 'S3_BUCKET',
  /** Access key id (an R2 API token's access key). Required. */
  accessKeyId: 'S3_ACCESS_KEY_ID',
  /** Secret access key. Required. */
  secretAccessKey: 'S3_SECRET_ACCESS_KEY',
  /** Full S3 endpoint URL; overrides `R2_ACCOUNT_ID`. */
  endpoint: 'S3_ENDPOINT',
  /** Cloudflare account id; the endpoint becomes `https://<id>.r2.cloudflarestorage.com`. */
  r2AccountId: 'R2_ACCOUNT_ID',
  /** Region (default `auto`, which R2 expects). */
  region: 'S3_REGION',
} as const;

type Env = Readonly<Record<string, string | undefined>>;

const read = (env: Env, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Client options from `env`, or `null` when a required secret is missing (bucket,
 * both keys, and either `S3_ENDPOINT` or `R2_ACCOUNT_ID`). Callers use `null` to fall
 * back to the fake storage, as `createProviders` expects.
 */
export function s3OptionsFromEnv(env: Env, publicBaseUrl = ''): S3ObjectStorageOptions | null {
  const bucket = read(env, S3_ENV.bucket);
  const accessKeyId = read(env, S3_ENV.accessKeyId);
  const secretAccessKey = read(env, S3_ENV.secretAccessKey);
  const accountId = read(env, S3_ENV.r2AccountId);
  const endpoint = read(env, S3_ENV.endpoint) ?? (accountId === undefined ? undefined : r2Endpoint(accountId));
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return {
    bucket,
    endpoint,
    region: read(env, S3_ENV.region) ?? 'auto',
    credentials: { accessKeyId, secretAccessKey },
    publicBaseUrl,
  };
}

/** True when `env` holds every secret {@link s3OptionsFromEnv} needs. */
export function hasS3Secrets(env: Env): boolean {
  return s3OptionsFromEnv(env) !== null;
}

/**
 * A `LiveProvider` factory for the `storage` slot of `createProviders`: reads the secrets
 * from `context.env` and the public base URL from `config.tts.storage.publicBaseUrl`.
 * Inject it only when {@link hasS3Secrets} is true; it throws otherwise.
 *
 * ```ts
 * createProviders(config, env, hasS3Secrets(env) ? { storage: s3StorageProvider } : {});
 * ```
 */
export function s3StorageProvider(context: Pick<ProviderContext, 'config' | 'env'>): S3ObjectStorage {
  const options = s3OptionsFromEnv(context.env, context.config.tts.storage.publicBaseUrl);
  if (!options) {
    const names = [
      S3_ENV.bucket,
      S3_ENV.accessKeyId,
      S3_ENV.secretAccessKey,
      `${S3_ENV.endpoint} or ${S3_ENV.r2AccountId}`,
    ];
    throw new ProviderError('invalid-request', `s3 storage needs ${names.join(', ')}`);
  }
  return new S3ObjectStorage(options);
}
