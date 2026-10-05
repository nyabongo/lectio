import { ProviderError } from '@lectio/providers';
import type { ProviderErrorCode } from '@lectio/providers';

interface SdkErrorShape {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly code?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
}

const TIMEOUT_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'RequestTimeoutException']);
const THROTTLE_NAMES = new Set(['SlowDown', 'Throttling', 'ThrottlingException', 'TooManyRequestsException']);

function codeFor(error: SdkErrorShape): ProviderErrorCode {
  const name = typeof error.name === 'string' ? error.name : '';
  const status = typeof error.$metadata?.httpStatusCode === 'number' ? error.$metadata.httpStatusCode : undefined;
  // The caller cancelled through an AbortSignal: not a timeout, and retrying would defy the caller.
  if (name === 'AbortError') return 'invalid-request';
  if (TIMEOUT_NAMES.has(name) || error.code === 'ETIMEDOUT' || status === 408) return 'timeout';
  if (THROTTLE_NAMES.has(name) || status === 429) return 'rate-limited';
  if (status === 501) return 'unsupported';
  if (status === 404) return 'not-found';
  if (status === 409 || status === 412) return 'conflict';
  if (status !== undefined && status >= 400 && status < 500) return 'invalid-request';
  // 5xx, or no HTTP response at all (a network failure before the service answered).
  return 'unavailable';
}

/**
 * True when the SDK error says the key does not exist: `NoSuchKey` (GET) or `NotFound`
 * (the SDK's name for a bodiless HEAD 404). Other 404s, such as `NoSuchBucket`, are errors.
 *
 * A HEAD response has no body, so a 404 from a wrong bucket or a misconfigured endpoint
 * also arrives as `NotFound` and reads as a missing key. If `head` returns `null` for an
 * object that should exist, check `S3_BUCKET` and `S3_ENDPOINT` first.
 */
export function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, $metadata } = error as SdkErrorShape;
  return (name === 'NoSuchKey' || name === 'NotFound') && $metadata?.httpStatusCode === 404;
}

/** Maps an `@aws-sdk/client-s3` failure onto a {@link ProviderError}. */
export function toProviderError(operation: string, key: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const shape: SdkErrorShape = typeof error === 'object' && error !== null ? (error as SdkErrorShape) : {};
  const name = typeof shape.name === 'string' ? shape.name : 'Error';
  const detail = typeof shape.message === 'string' && shape.message !== '' ? shape.message : String(error);
  return new ProviderError(codeFor(shape), `s3 ${operation} "${key}" failed: ${name}: ${detail}`, { cause: error });
}
