// The entry points run in-process (no subprocess): importing one runs its top-level await,
// which finishes before `import()` resolves. Their arguments are usage errors, so nothing is
// built or written. The heavy imports (romcal, the lectionary, refs) are loaded once in
// `beforeAll` with a generous timeout, so the tests themselves only evaluate the entry module.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const TIMEOUT = 60_000;

describe('CLI entry points', () => {
  const argv = process.argv;

  beforeAll(async () => {
    await import('./run.ts');
  }, TIMEOUT);

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it(
    'build.ts runs runBuild with argv (usage error, so nothing is written)',
    async () => {
      process.argv = ['node', 'build.ts'];
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await import('./build.ts');
      expect(error.mock.calls[0]?.[0]).toMatch(/^usage: calendar:build/);
      expect(process.exitCode).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'check.ts runs runCheck with argv (usage error, so nothing is built)',
    async () => {
      process.argv = ['node', 'check.ts', '--bogus'];
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await import('./check.ts');
      expect(error.mock.calls[0]?.[0]).toMatch(/^unexpected argument "--bogus"\nusage: calendar:check/);
      expect(process.exitCode).toBe(2);
    },
    TIMEOUT,
  );
});
