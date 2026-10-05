/**
 * Package shape: subpath exports only, no barrel. Imports go through the package name, exactly
 * as another workspace (`@lectio/content`, `@lectio/gates`, …) would write them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports: Record<string, string> };

describe('@lectio/schema exports', () => {
  it('has no src/index.ts barrel and no root export', () => {
    expect(existsSync(join(pkgDir, 'src/index.ts'))).toBe(false);
    expect(pkg.exports['.']).toBeUndefined();
    expect(pkg.exports['./*']).toBe('./src/*/index.ts');
    expect(pkg.exports['./json/*']).toBe('./json/*');
  });

  it('exposes api, passage, translated-passage, calendar, gate-result and common as subpaths', () => {
    const subpaths = readdirSync(join(pkgDir, 'src'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(pkgDir, 'src', entry.name, 'index.ts')))
      .map((entry) => entry.name)
      .sort();
    expect(subpaths).toEqual(['api', 'calendar', 'common', 'gate-result', 'passage', 'translated-passage']);
  });

  it('resolves @lectio/schema/<name> through the package exports', async () => {
    const passage = await import('@lectio/schema/passage');
    const calendar = await import('@lectio/schema/calendar');
    const gateResult = await import('@lectio/schema/gate-result');
    const common = await import('@lectio/schema/common');
    const api = await import('@lectio/schema/api');
    expect(typeof passage.validatePassage).toBe('function');
    expect(typeof calendar.validateCalendarYear).toBe('function');
    expect(typeof gateResult.validateGateResult).toBe('function');
    expect(typeof common.createAjv).toBe('function');
    expect(typeof api.validateApiDay).toBe('function');
  });

  it('resolves the emitted JSON through @lectio/schema/json/*', () => {
    // Resolve from another workspace, as a consumer would.
    const require = createRequire(join(pkgDir, '../content/package.json'));
    const resolved = require.resolve('@lectio/schema/json/passage.schema.json');
    expect(resolved).toBe(join(pkgDir, 'json/passage.schema.json'));
    const schema = JSON.parse(readFileSync(resolved, 'utf8')) as { title: string };
    expect(schema.title).toBe('Lectio passage');
  });
});
