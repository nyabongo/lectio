import { NoSuchBucket, NoSuchKey, NotFound, S3ServiceException } from '@aws-sdk/client-s3';
import { ProviderError } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { isMissingObject, toProviderError } from './errors.ts';

const meta = (httpStatusCode?: number) => ({ httpStatusCode, attempts: 1, totalRetryDelay: 0 });

function serviceError(name: string, status?: number): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'server', message: `${name} message`, $metadata: meta(status) });
}

describe('isMissingObject', () => {
  it('recognises missing keys', () => {
    expect(isMissingObject(new NoSuchKey({ message: 'gone', $metadata: meta(404) }))).toBe(true);
    expect(isMissingObject(new NotFound({ message: 'gone', $metadata: meta(404) }))).toBe(true);
    expect(isMissingObject(serviceError('UnknownError', 404))).toBe(true);
  });

  it('does not treat a missing bucket or other failures as a missing key', () => {
    expect(isMissingObject(new NoSuchBucket({ message: 'no bucket', $metadata: meta(404) }))).toBe(false);
    expect(isMissingObject(serviceError('AccessDenied', 403))).toBe(false);
    expect(isMissingObject(new Error('boom'))).toBe(false);
    expect(isMissingObject('NoSuchKey')).toBe(false);
    expect(isMissingObject(null)).toBe(false);
  });
});

describe('toProviderError', () => {
  it.each([
    [serviceError('TimeoutError'), 'timeout', true],
    [serviceError('RequestTimeout', 400), 'timeout', true],
    [serviceError('Whatever', 408), 'timeout', true],
    [Object.assign(new Error('socket'), { code: 'ETIMEDOUT' }), 'timeout', true],
    [serviceError('SlowDown', 503), 'rate-limited', true],
    [serviceError('TooManyRequests', 429), 'rate-limited', true],
    [serviceError('InternalError', 500), 'unavailable', true],
    [serviceError('ServiceUnavailable', 503), 'unavailable', true],
    [serviceError('NotImplemented', 501), 'unsupported', false],
    [new NoSuchBucket({ message: 'no bucket', $metadata: meta(404) }), 'not-found', false],
    [serviceError('PreconditionFailed', 412), 'conflict', false],
    [serviceError('OperationAborted', 409), 'conflict', false],
    [serviceError('AccessDenied', 403), 'invalid-request', false],
    [serviceError('InvalidArgument', 400), 'invalid-request', false],
    [Object.assign(new Error('reset'), { code: 'ECONNRESET' }), 'unavailable', true],
    ['plain string', 'unavailable', true],
  ])('maps %s to %s', (error, code, retryable) => {
    const mapped = toProviderError('put', 'audio/a.wav', error);
    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped.code).toBe(code);
    expect(mapped.retryable).toBe(retryable);
    expect(mapped.cause).toBe(error);
    expect(mapped.message).toContain('s3 put "audio/a.wav" failed');
  });

  it('describes errors without a message by their string form', () => {
    expect(toProviderError('get', 'k', 'plain string').message).toBe('s3 get "k" failed: Error: plain string');
    expect(toProviderError('get', 'k', { name: 'Odd', message: '' }).message).toBe(
      's3 get "k" failed: Odd: [object Object]',
    );
  });

  it('passes ProviderErrors through unchanged', () => {
    const original = new ProviderError('malformed-output', 'bad');
    expect(toProviderError('head', 'k', original)).toBe(original);
  });
});
