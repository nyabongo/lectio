/**
 * Maps `@anthropic-ai/sdk` failures onto the shared `ProviderError` codes and decides
 * how long to wait before retrying a transient one (429, 529 overloaded, 5xx, timeouts,
 * dropped connections).
 */
import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from '@lectio/providers';
import type { ProviderErrorCode } from '@lectio/providers';

/** Longest wait honoured from a `retry-after` header. */
export const MAX_RETRY_AFTER_MS = 60_000;
/** First backoff step when the API gives no `retry-after`; it doubles per attempt. */
export const BASE_BACKOFF_MS = 1_000;
/** Longest computed backoff. */
export const MAX_BACKOFF_MS = 30_000;

function codeForStatus(status: number): ProviderErrorCode {
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'unavailable';
  return 'invalid-request';
}

function codeForType(type: string | null | undefined): ProviderErrorCode | undefined {
  switch (type) {
    case 'rate_limit_error':
      return 'rate-limited';
    case 'overloaded_error':
    case 'api_error':
      return 'unavailable';
    case 'timeout_error':
      return 'timeout';
    default:
      return undefined;
  }
}

/** The shared error for anything the SDK (or this package) threw. `ProviderError`s pass through. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', `Anthropic request timed out: ${error.message}`, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('unavailable', `could not reach the Anthropic API: ${error.message}`, { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    // Errors sent inside a stream (for example `overloaded_error`) carry a type but no status.
    const code = codeForType(error.type) ?? (error.status === undefined ? 'unavailable' : codeForStatus(error.status));
    const status = error.status === undefined ? 'stream error' : `HTTP ${String(error.status)}`;
    // 409 is transient on the Anthropic API (the SDK's own policy retries it too).
    return new ProviderError(code, `Anthropic API ${status}: ${error.message}`, {
      cause: error,
      ...(code === 'conflict' ? { retryable: true } : {}),
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError('invalid-request', `Anthropic client error: ${message}`, {
    cause: error,
    retryable: false,
  });
}

function headerDelayMs(error: unknown): number | undefined {
  if (!(error instanceof Anthropic.APIError) || error.headers === undefined) return undefined;
  const ms = Number(error.headers.get('retry-after-ms') ?? Number.NaN);
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const seconds = Number(error.headers.get('retry-after') ?? Number.NaN);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

/** Milliseconds to wait before retry number `attempt + 1` (0-based) of a call that failed with `error`. */
export function retryDelayMs(error: unknown, attempt: number): number {
  const fromHeader = headerDelayMs(error);
  if (fromHeader !== undefined) return Math.min(fromHeader, MAX_RETRY_AFTER_MS);
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}
