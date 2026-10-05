import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CLI entry points', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('build.ts runs runBuild with argv (usage error, so nothing is written)', async () => {
    process.argv = ['node', 'build.ts'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./build.ts');
    expect(error.mock.calls[0]?.[0]).toMatch(/^usage: calendar:build/);
    expect(process.exitCode).toBe(2);
  });

  it('check.ts runs runCheck with argv (usage error, so nothing is built)', async () => {
    process.argv = ['node', 'check.ts', '--bogus'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./check.ts');
    expect(error.mock.calls[0]?.[0]).toMatch(/^unexpected argument "--bogus"\nusage: calendar:check/);
    expect(process.exitCode).toBe(2);
  });
});
