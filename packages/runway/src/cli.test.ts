import { afterEach, describe, expect, it, vi } from 'vitest';

describe('runway entry point', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('runs runRunway with argv (a usage error, so GitHub is never called)', async () => {
    process.argv = ['node', 'cli.ts', '--bogus'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./cli.ts');
    expect(error.mock.calls[0]?.[0]).toMatch(/^unexpected argument "--bogus"\nusage: runway/);
    expect(process.exitCode).toBe(2);
  });
});
