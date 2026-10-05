import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JSON_DIR, SCHEMAS, emitSchemas, renderAll, schemaFileName } from './emit-schemas.ts';

describe('committed json/*.schema.json', () => {
  it('is in sync with the TypeScript schemas (run `npm run schema:emit` if this fails)', async () => {
    for (const [filePath, contents] of await renderAll()) {
      expect(existsSync(filePath), `${basename(filePath)} is missing`).toBe(true);
      expect(readFileSync(filePath, 'utf8'), `${basename(filePath)} is stale`).toBe(contents);
    }
  });

  it('holds exactly the emitted schemas', () => {
    const expected = Object.keys(SCHEMAS).map(schemaFileName).sort();
    expect(readdirSync(JSON_DIR).sort()).toEqual(expected);
  });

  it('round-trips each schema unchanged', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      const emitted = JSON.parse(readFileSync(join(JSON_DIR, schemaFileName(name)), 'utf8')) as unknown;
      expect(emitted).toEqual(JSON.parse(JSON.stringify(schema)));
    }
  });
});

describe('emitSchemas', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes one file per schema, creating the directory', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'lectio-schema-'));
    dirs.push(parent);
    const dir = join(parent, 'json');
    const written = await emitSchemas(dir);
    expect(written.map((filePath) => basename(filePath)).sort()).toEqual(
      Object.keys(SCHEMAS).map(schemaFileName).sort(),
    );
    const passage = JSON.parse(readFileSync(join(dir, 'passage.schema.json'), 'utf8')) as { $id: string };
    expect(passage.$id).toMatch(/passage\.schema\.json$/);
  });
});
