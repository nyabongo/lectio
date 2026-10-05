import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { MAX_BACKOFF_MS, MAX_RETRY_AFTER_MS, retryDelayMs, toProviderError } from './errors.ts';

function apiError(
  status: number | undefined,
  type: string | null,
  headers: Record<string, string> = {},
): InstanceType<typeof Anthropic.APIError> {
  const body = type ? { type: 'error', error: { type, message: 'm' } } : undefined;
  return status === undefined
    ? new Anthropic.APIError(undefined, body, 'm', new Headers(headers), type as never)
    : Anthropic.APIError.generate(status, body, 'm', new Headers(headers));
}

describe('toProviderError', () => {
  it('passes ProviderErrors through', () => {
    const error = new ProviderError('conflict', 'x');
    expect(toProviderError(error)).toBe(error);
  });

  it('maps HTTP statuses and stream error types', () => {
    const cases: [number | undefined, string | null, string, boolean][] = [
      [400, 'invalid_request_error', 'invalid-request', false],
      [403, 'permission_error', 'invalid-request', false],
      [404, 'not_found_error', 'not-found', false],
      [408, null, 'timeout', true],
      [409, null, 'conflict', true],
      [413, 'request_too_large', 'invalid-request', false],
      [429, 'rate_limit_error', 'rate-limited', true],
      [500, 'api_error', 'unavailable', true],
      [503, null, 'unavailable', true],
      [529, 'overloaded_error', 'unavailable', true],
      [504, 'timeout_error', 'timeout', true],
      [undefined, 'overloaded_error', 'unavailable', true],
      [undefined, 'something_new', 'unavailable', true],
      [undefined, null, 'unavailable', true],
    ];
    for (const [status, type, code, retryable] of cases) {
      const mapped = toProviderError(apiError(status, type));
      expect([status, type, mapped.code, mapped.retryable]).toEqual([status, type, code, retryable]);
    }
    expect(toProviderError(apiError(undefined, 'overloaded_error')).message).toContain('stream error');
    expect(toProviderError(apiError(429, null)).message).toContain('HTTP 429');
  });

  it('maps connection failures and anything else', () => {
    expect(toProviderError(new Anthropic.APIConnectionTimeoutError()).code).toBe('timeout');
    expect(toProviderError(new Anthropic.APIConnectionError({ message: 'reset' })).code).toBe('unavailable');
    const other = toProviderError(new Error('bad'));
    expect([other.code, other.retryable, other.message]).toEqual([
      'invalid-request',
      false,
      'Anthropic client error: bad',
    ]);
    expect(toProviderError('weird').message).toBe('Anthropic client error: weird');
  });
});

describe('retryDelayMs', () => {
  it('honours retry-after-ms, then retry-after, capped', () => {
    expect(retryDelayMs(apiError(429, null, { 'retry-after-ms': '250', 'retry-after': '9' }), 0)).toBe(250);
    expect(retryDelayMs(apiError(429, null, { 'retry-after': '3' }), 0)).toBe(3000);
    expect(retryDelayMs(apiError(429, null, { 'retry-after': '3600' }), 0)).toBe(MAX_RETRY_AFTER_MS);
  });

  it('backs off exponentially without a usable header', () => {
    expect(retryDelayMs(apiError(529, null, { 'retry-after': 'soon' }), 0)).toBe(1000);
    expect(retryDelayMs(apiError(529, null), 2)).toBe(4000);
    expect(retryDelayMs(new Anthropic.APIConnectionError({ message: 'x' }), 10)).toBe(MAX_BACKOFF_MS);
    expect(retryDelayMs(new Error('x'), 1)).toBe(2000);
  });
});
