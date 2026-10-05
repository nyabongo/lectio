// The entry point runs in-process (no subprocess): importing it runs its top-level await, which
// finishes before `import()` resolves. Its argument is a usage error, so nothing is read or resolved.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const TIMEOUT = 60_000;

describe('calendar:report entry point', () => {
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
    'cli.ts runs runReport with argv (usage error, so nothing is reported)',
    async () => {
      process.argv = ['node', 'cli.ts', '--bogus'];
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await import('./cli.ts');
      expect(error.mock.calls[0]?.[0]).toMatch(/^unexpected argument "--bogus"\nusage: calendar:report/);
      expect(process.exitCode).toBe(2);
    },
    TIMEOUT,
  );
});
