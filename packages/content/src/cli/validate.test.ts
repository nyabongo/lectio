// validate.ts is wiring only: it hands argv, the working directory, the environment and console to
// runValidate (logic and tests: ../validate-files.test.ts). validate-files.ts is mocked so importing the
// entry point does not load the schemas and validators on first use. That cold import took several
// hundred milliseconds even unloaded and could time the test out under coverage on a loaded machine.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runValidate } = vi.hoisted(() => ({ runValidate: vi.fn<(...args: unknown[]) => number>() }));
vi.mock('../validate-files.ts', () => ({ runValidate }));

describe('content:validate entry point', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runValidate.mockReset();
    vi.resetModules();
  });

  it('validates argv relative to INIT_CWD and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', '/from/init-cwd');
    process.argv = ['node', 'validate.ts', 'calendar/2026.json'];
    runValidate.mockReturnValue(0);
    await import('./validate.ts');
    expect(runValidate).toHaveBeenCalledWith(['calendar/2026.json'], {
      cwd: '/from/init-cwd',
      env: process.env,
      log: console.log,
      error: console.error,
    });
    expect(process.exitCode).toBe(0);
  });

  it('falls back to the working directory without INIT_CWD and passes the exit code through', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    process.argv = ['node', 'validate.ts', 'calendar/2024.json'];
    runValidate.mockReturnValue(1);
    await import('./validate.ts');
    expect(runValidate).toHaveBeenCalledWith(['calendar/2024.json'], expect.objectContaining({ cwd: '/from/cwd' }));
    expect(process.exitCode).toBe(1);
  });
});
