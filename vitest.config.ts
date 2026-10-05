/**
 * Root vitest config. Guarded by CODEOWNERS and by `npm run coverage:floor`
 * (scripts/check-coverage-floor.mjs → packages/shared/src/coverage-floor.ts).
 *
 * Never lower a threshold below 96 and never narrow `coverage.include`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import type { TestProjectConfiguration } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/** The hard floor: unit coverage never drops below 96% on any metric. */
const floor = { lines: 96, branches: 96, functions: 96, statements: 96 } as const;

/** Every file that must be unit-tested, whether or not a test imports it. */
const include = ['packages/*/src/**/*.{ts,tsx,mts}', 'apps/*/src/lib/**/*.{ts,tsx,mts}', 'apps/web/src/sw/**'];

/**
 * `packages/*`: one project per package directory, named after its package.json
 * (so `vitest --project @lectio/refs` works). Each inherits this file's options,
 * including the offline msw guard in vitest.setup.ts. A package that needs its
 * own settings adds `packages/<x>/vitest.config.ts`, which is then used instead
 * (and must list `../../vitest.setup.ts` in `setupFiles`). New packages are
 * picked up without editing this file.
 */
function packageProjects(dir: string): TestProjectConfiguration[] {
  const base = join(repoRoot, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'package.json')))
    .map((entry) => {
      const root = join(base, entry.name);
      if (existsSync(join(root, 'vitest.config.ts'))) return `${dir}/${entry.name}/vitest.config.ts`;
      const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
      return { extends: true, test: { name, root, include: ['src/**/*.test.{ts,tsx,mts}'] } };
    });
}

export default defineConfig({
  test: {
    // packages/* (expanded above), apps that ship their own vitest.config.ts
    // (apps without one, such as the Flutter app, are not picked up), and
    // tests/* for repo-level suites (content gates, docs link check) that are
    // excluded from coverage.
    projects: [...packageProjects('packages'), 'apps/*/vitest.config.ts', 'tests/*'],
    setupFiles: [join(repoRoot, 'vitest.setup.ts')],
    coverage: {
      provider: 'v8',
      include,
      exclude: ['**/*.d.ts', '**/*.test.*', '**/fixtures/**', '**/__generated__/**'],
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        ...floor,
        ...Object.fromEntries(include.map((glob) => [glob, floor])),
      },
    },
  },
});
