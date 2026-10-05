/**
 * @lectio/provider-s3: `ObjectStorage` on an S3-compatible bucket (Cloudflare R2 by
 * default) through `@aws-sdk/client-s3`. Not registered in `createProviders`; the deploy
 * pipeline (L-082) injects {@link s3StorageProvider} when the secrets are present.
 */
export const packageName = '@lectio/provider-s3';

export { IMMUTABLE_CACHE_CONTROL, NO_CACHE_CONTROL, defaultCacheControl } from './cache-control.ts';
export { S3_ENV, hasS3Secrets, s3OptionsFromEnv, s3StorageProvider } from './env.ts';
export { isMissingObject, toProviderError } from './errors.ts';
export {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_LIST_CONCURRENCY,
  S3ObjectStorage,
  isS3ObjectStorage,
  publicUrlFor,
  r2Endpoint,
} from './s3-storage.ts';
export type { S3Credentials, S3ObjectStorageOptions } from './s3-storage.ts';
