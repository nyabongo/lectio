import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { DEFAULT_CONFIG } from './defaults.ts';
import { deepFreeze, deepMerge, isPlainObject } from './merge.ts';
import type { LectioConfig } from './types.ts';
import { ConfigError, validateConfig } from './validate.ts';

/** The repository's config file, relative to the repository root. */
export const DEFAULT_CONFIG_FILE = 'config/lectio.config.json';

/** Environment variable that points at an alternative config file (repo-relative or absolute). */
export const CONFIG_ENV_VAR = 'LECTIO_CONFIG';

export interface LoadConfigOptions {
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where relative paths start and the repo-root search begins. Defaults to `INIT_CWD`, then `process.cwd()`. */
  readonly cwd?: string;
}

/** The nearest directory at or above `start` whose package.json declares npm workspaces; `start` if none. */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && hasWorkspaces(manifest)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function hasWorkspaces(manifest: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    return isPlainObject(parsed) && parsed.workspaces !== undefined;
  } catch {
    return false;
  }
}

function startDir(options: LoadConfigOptions): string {
  const env = options.env ?? process.env;
  return resolve(options.cwd ?? env.INIT_CWD ?? process.cwd());
}

export interface ResolvedConfigPath {
  /** Absolute path of the file to read. */
  readonly path: string;
  /** `false` for the repository default, which may be absent; `true` when the caller or env asked for it. */
  readonly required: boolean;
}

/**
 * Which file `loadConfig` reads: the explicit `path` (relative to the working
 * directory), else `$LECTIO_CONFIG` (relative to the repository root), else
 * `config/lectio.config.json` in the repository root.
 */
export function resolveConfigPath(path?: string, options: LoadConfigOptions = {}): ResolvedConfigPath {
  const env = options.env ?? process.env;
  const cwd = startDir(options);
  if (path !== undefined && path !== '') return { path: resolve(cwd, path), required: true };
  const root = findRepoRoot(cwd);
  const fromEnv = env[CONFIG_ENV_VAR];
  if (fromEnv !== undefined && fromEnv !== '') {
    return { path: isAbsolute(fromEnv) ? fromEnv : resolve(root, fromEnv), required: true };
  }
  return { path: join(root, DEFAULT_CONFIG_FILE), required: false };
}

function readConfigFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(path, [{ pointer: '', message: `cannot read file (${(error as Error).message})` }]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConfigError(path, [{ pointer: '', message: `not valid JSON (${(error as Error).message})` }]);
  }
}

/**
 * Loads the Lectio config: reads the file chosen by `resolveConfigPath`,
 * deep-merges it over the built-in defaults (objects merge, arrays replace),
 * validates the result and returns it deeply frozen. With no file present the
 * defaults are returned. Throws `ConfigError` (with JSON pointers) on any problem.
 */
export function loadConfig(path?: string, options: LoadConfigOptions = {}): LectioConfig {
  const resolved = resolveConfigPath(path, options);
  if (!resolved.required && !existsSync(resolved.path)) {
    return deepFreeze(validateConfig(deepMerge(DEFAULT_CONFIG, undefined)));
  }
  const overrides = readConfigFile(resolved.path);
  return deepFreeze(validateConfig(deepMerge(DEFAULT_CONFIG, overrides), resolved.path));
}
