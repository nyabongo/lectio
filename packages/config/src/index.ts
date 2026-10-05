/**
 * @lectio/config: the single typed loader for `config/lectio.config.json`.
 *
 * `loadConfig()` deep-merges the file over `DEFAULT_CONFIG`, validates it
 * (JSON Schema plus cross-field rules) and returns a frozen `LectioConfig`.
 * `LECTIO_CONFIG` selects an alternative file.
 */
export const packageName = '@lectio/config';

export { DEFAULT_CONFIG } from './defaults.ts';
export { CONFIG_ENV_VAR, DEFAULT_CONFIG_FILE, findRepoRoot, loadConfig, resolveConfigPath } from './load.ts';
export type { LoadConfigOptions, ResolvedConfigPath } from './load.ts';
export { deepFreeze, deepMerge } from './merge.ts';
export { configSchema } from './schema.ts';
export { ConfigError, validateConfig } from './validate.ts';
export type { ConfigIssue } from './validate.ts';
export type * from './types.ts';
