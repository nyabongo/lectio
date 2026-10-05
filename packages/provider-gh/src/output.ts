/**
 * Reading gh output: JSON with checked field access, and failures mapped onto
 * `ProviderError` codes.
 */
import { ProviderError } from '@lectio/providers';
import type { ProviderErrorCode } from '@lectio/providers';

import type { ExecResult } from './exec.ts';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

function malformed(message: string): ProviderError {
  return new ProviderError('malformed-output', `gh output: ${message}`);
}

export function parseJson(text: string, what: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch (error) {
    throw new ProviderError('malformed-output', `gh output for ${what} is not JSON`, { cause: error });
  }
}

export function asObject(value: Json | undefined, what: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw malformed(`${what} is not an object`);
  return value as JsonObject;
}

export function asArray(value: Json | undefined, what: string): readonly Json[] {
  if (!Array.isArray(value)) throw malformed(`${what} is not an array`);
  return value as readonly Json[];
}

/** `gh api --paginate --slurp` prints one array per page. */
export function flattenPages(value: Json, what: string): readonly Json[] {
  return asArray(value, what).flatMap((page) => asArray(page, `${what} page`));
}

export function str(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== 'string') throw malformed(`"${key}" is not a string`);
  return value;
}

export function optStr(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return value === null || value === undefined ? undefined : str(object, key);
}

export function num(object: JsonObject, key: string): number {
  const value = object[key];
  if (typeof value !== 'number') throw malformed(`"${key}" is not a number`);
  return value;
}

export function bool(object: JsonObject, key: string): boolean {
  const value = object[key];
  if (typeof value !== 'boolean') throw malformed(`"${key}" is not a boolean`);
  return value;
}

export function obj(object: JsonObject, key: string): JsonObject {
  return asObject(object[key], `"${key}"`);
}

/** The object at `key`, or `undefined` when it is null or missing. */
export function optObj(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return value === null || value === undefined ? undefined : obj(object, key);
}

export function arr(object: JsonObject, key: string): readonly Json[] {
  return asArray(object[key], `"${key}"`);
}

/** `login` of a user object (`author`, `user`, `actor`), or `ghost` for a deleted account. */
export function login(object: JsonObject, key: string): string {
  const user = optObj(object, key);
  return user ? str(user, 'login') : 'ghost';
}

/** Names of a `labels` array (`[{ name }]`). */
export function labelNames(value: Json | undefined): string[] {
  return asArray(value, 'labels').map((label) => str(asObject(label, 'label'), 'name'));
}

const STATUS_CODES: readonly [RegExp, ProviderErrorCode][] = [
  [/HTTP 404|Not Found|Could not resolve to|could not find|no pull requests? found|not found/i, 'not-found'],
  [/HTTP 409/, 'conflict'],
  [/rate limit|HTTP 429/i, 'rate-limited'],
  [/HTTP 5\d\d|timeout|timed out|connect|EOF|network/i, 'unavailable'],
];

/** The `ProviderError` for a failed gh command, from what it printed. */
export function ghError(args: readonly string[], result: ExecResult, code?: ProviderErrorCode): ProviderError {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  const mapped = code ?? STATUS_CODES.find(([pattern]) => pattern.test(output))?.[1] ?? 'invalid-request';
  const command = args.slice(0, 2).join(' ');
  return new ProviderError(mapped, `gh ${command} failed (exit ${result.exitCode}): ${output.slice(0, 500)}`);
}
