import { ProviderError } from '@lectio/providers';
import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { describe, expect, it } from 'vitest';

import { LlmRefusalError, toProviderError } from './errors.ts';

describe('toProviderError', () => {
  it('passes a ProviderError through', () => {
    const original = new ProviderError('conflict', 'x');
    expect(toProviderError(original)).toBe(original);
  });

  it('maps SDK connection errors', () => {
    expect(toProviderError(new APIConnectionTimeoutError())).toMatchObject({ code: 'timeout', retryable: true });
    expect(toProviderError(new APIConnectionError({ message: 'reset' }))).toMatchObject({
      code: 'unavailable',
      retryable: true,
    });
    expect(toProviderError(new APIUserAbortError())).toMatchObject({ code: 'timeout', retryable: false });
  });

  it('keeps the original error as the cause', () => {
    const cause = new Error('socket hang up');
    const mapped = toProviderError(cause);
    expect(mapped).toMatchObject({ code: 'unavailable', message: 'openai: socket hang up' });
    expect(mapped.cause).toBe(cause);
  });

  it('maps a thrown non-Error value', () => {
    expect(toProviderError('weird').message).toBe('openai: weird');
  });
});

describe('LlmRefusalError', () => {
  it('is a non-retryable malformed-output error carrying the refusal', () => {
    const error = new LlmRefusalError('No.');
    expect(error).toMatchObject({
      code: 'malformed-output',
      retryable: false,
      rawText: 'No.',
      name: 'LlmRefusalError',
    });
    expect(error.message).toContain('refused');
  });
});
