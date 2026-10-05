/**
 * Test helper: loads the fixtures of one schema. Layout: `fixtures/<schema>/{valid,invalid}/<name>.json`.
 * Valid fixtures must pass their validator; each invalid fixture breaks exactly one rule.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

/** Fixture name (file stem) → parsed JSON, sorted by name. */
export function loadFixtures(schema: string, kind: 'valid' | 'invalid'): Map<string, unknown> {
  const dir = join(FIXTURES_DIR, schema, kind);
  return new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => [file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown]),
  );
}

/** One fixture by name. */
export function loadFixture(schema: string, kind: 'valid' | 'invalid', name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, schema, kind, `${name}.json`), 'utf8')) as unknown;
}
