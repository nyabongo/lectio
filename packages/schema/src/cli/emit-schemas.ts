/**
 * Logic behind `npm run schema:emit`: renders every content schema to
 * `packages/schema/json/<name>.schema.json` (committed, so non-TypeScript consumers such as
 * editors, the Flutter app or other tools can use them). A unit test fails when the committed
 * files drift from the TypeScript sources.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { API_SCHEMAS } from '../api/index.ts';
import { calendarYearSchema } from '../calendar/index.ts';
import { gateResultSchema } from '../gate-result/index.ts';
import { passageSchema } from '../passage/index.ts';
import { translatedPassageSchema } from '../translated-passage/index.ts';

/** Every emitted schema, by file stem. A new schema directory adds one line here. */
export const SCHEMAS = {
  passage: passageSchema,
  'calendar-year': calendarYearSchema,
  'gate-result': gateResultSchema,
  'translated-passage': translatedPassageSchema,
  ...API_SCHEMAS,
} as const;

/** `packages/schema/json`, where the emitted files live. */
export const JSON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../json');

/** File name for a schema stem. */
export function schemaFileName(name: string): string {
  return `${name}.schema.json`;
}

/** The exact text written for `schema`, formatted with the repository's Prettier config. */
export async function renderSchema(schema: object, filePath: string): Promise<string> {
  const config = await resolveConfig(filePath);
  return format(JSON.stringify(schema), { ...config, filepath: filePath });
}

/** Every file `schema:emit` writes, as absolute path → contents. */
export async function renderAll(dir: string = JSON_DIR): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const filePath = join(dir, schemaFileName(name));
    files.set(filePath, await renderSchema(schema, filePath));
  }
  return files;
}

/** Writes every schema into `dir` and returns the paths written. */
export async function emitSchemas(dir: string = JSON_DIR): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const files = await renderAll(dir);
  for (const [filePath, contents] of files) writeFileSync(filePath, contents);
  return [...files.keys()];
}
