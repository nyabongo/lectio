import { describe, expect, it } from 'vitest';

import {
  arr,
  asArray,
  asObject,
  bool,
  flattenPages,
  ghError,
  labelNames,
  login,
  num,
  obj,
  optObj,
  optStr,
  parseJson,
  str,
} from './output.ts';

const malformed = expect.objectContaining({ code: 'malformed-output' });

describe('JSON access', () => {
  it('parses JSON or reports malformed output', () => {
    expect(parseJson('{"a":1}', 'x')).toEqual({ a: 1 });
    expect(() => parseJson('nope', 'x')).toThrow(malformed);
  });

  it('checks shapes', () => {
    const value = { s: 's', n: 1, b: true, o: { login: 'me' }, a: [1], nil: null };
    expect([str(value, 's'), num(value, 'n'), bool(value, 'b'), obj(value, 'o'), arr(value, 'a')]).toEqual([
      's',
      1,
      true,
      { login: 'me' },
      [1],
    ]);
    expect([optStr(value, 'nil'), optStr(value, 'missing'), optStr(value, 's')]).toEqual([undefined, undefined, 's']);
    expect([optObj(value, 'nil'), login(value, 'o'), login(value, 'nil')]).toEqual([undefined, 'me', 'ghost']);
    for (const read of [
      () => str(value, 'n'),
      () => num(value, 's'),
      () => bool(value, 's'),
      () => obj(value, 'a'),
      () => asObject(null, 'x'),
      () => arr(value, 'o'),
      () => asArray('x', 'x'),
      () => flattenPages([[1], 2], 'x'),
    ]) {
      expect(read).toThrow(malformed);
    }
    expect(flattenPages([[1], [2, 3]], 'x')).toEqual([1, 2, 3]);
    expect(labelNames([{ name: 'a' }, { name: 'b' }])).toEqual(['a', 'b']);
  });
});

describe('ghError', () => {
  const result = (stderr: string, stdout = '') => ({ exitCode: 1, stdout, stderr });

  it.each([
    ['gh: Not Found (HTTP 404)', 'not-found'],
    ['GraphQL: Could not resolve to a PullRequest with the number of 9.', 'not-found'],
    ['could not find any workflows named x.yml', 'not-found'],
    ['gh: Conflict (HTTP 409)', 'conflict'],
    ['gh: API rate limit exceeded for installation (HTTP 403)', 'rate-limited'],
    ['gh: Server Error (HTTP 503)', 'unavailable'],
    ['error connecting to api.github.com', 'unavailable'],
    ['HTTP 401: Bad credentials', 'invalid-request'],
  ])('%s → %s', (stderr, code) => {
    expect(ghError(['api', 'x'], result(stderr)).code).toBe(code);
  });

  it('honours an explicit code and names the command', () => {
    const error = ghError(['pr', 'merge', '1'], result('', '{"message":"x"}'), 'conflict');
    expect(error.code).toBe('conflict');
    expect(error.message).toBe('gh pr merge failed (exit 1): {"message":"x"}');
  });
});
