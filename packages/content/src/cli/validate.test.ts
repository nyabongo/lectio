import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url));

describe('content:validate entry point', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('validates argv relative to INIT_CWD and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', fixtures);
    process.argv = ['node', 'validate.ts', 'repo/calendar/2026.json'];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./validate.ts');
    expect(log).toHaveBeenCalledWith('content:validate: 1 files valid');
    expect(process.exitCode).toBe(0);
  });

  it('falls back to the working directory without INIT_CWD', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue(fixtures);
    process.argv = ['node', 'validate.ts', 'broken/calendar/2024.json'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./validate.ts');
    expect(error).toHaveBeenCalledWith('broken/calendar/2024.json#/year: must equal the file name year 2024');
    expect(process.exitCode).toBe(1);
  });
});
