import { LlmOutputError, ProviderError } from '@lectio/providers';
import type { ProviderErrorCode } from '@lectio/providers';
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';

/**
 * The model declined to answer (a `refusal` content part). It is an output failure,
 * so callers that handle {@link LlmOutputError} treat it the same way, but it is not
 * retried: asking again rarely changes a refusal.
 */
export class LlmRefusalError extends LlmOutputError {
  override readonly name: string = 'LlmRefusalError';

  constructor(refusal: string) {
    super(`openai: the model refused to answer: ${refusal}`, refusal);
  }
}

function codeForStatus(status: number): ProviderErrorCode {
  if (status === 404) return 'not-found';
  if (status === 408) return 'timeout';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'unavailable';
  return 'invalid-request';
}

/** Maps an `openai` SDK failure (after the SDK's own retries) onto the shared {@link ProviderError}. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof APIConnectionTimeoutError) {
    return new ProviderError('timeout', `openai: request timed out`, { cause: error });
  }
  if (error instanceof APIUserAbortError) {
    return new ProviderError('timeout', `openai: request aborted`, { cause: error, retryable: false });
  }
  if (error instanceof APIConnectionError) {
    return new ProviderError('unavailable', `openai: connection failed: ${error.message}`, { cause: error });
  }
  if (error instanceof APIError && typeof error.status === 'number') {
    const code = codeForStatus(error.status);
    // An exhausted quota answers 429 too, but waiting does not fix it.
    const retryable = code === 'rate-limited' && error.code === 'insufficient_quota' ? false : undefined;
    return new ProviderError(code, `openai: HTTP ${error.status}: ${error.message}`, { cause: error, retryable });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError('unavailable', `openai: ${message}`, { cause: error });
}
