// index.ts is wiring only: it hands argv, the working directory, the environment and console to
// runGatesCli (logic and tests: ./run.test.ts). run.ts is mocked once for the file, so importing the
// entry point never loads the gates, providers and content on first use.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runGatesCli } = vi.hoisted(() => ({ runGatesCli: vi.fn<(...args: unknown[]) => Promise<number>>() }));
vi.mock('./run.ts', () => ({ runGatesCli }));

describe('lectio-gates entry point', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runGatesCli.mockReset();
    vi.resetModules();
  });

  it('runs relative to INIT_CWD and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', '/from/init-cwd');
    process.argv = ['node', 'index.ts', 'run', '--gates', 'schema'];
    runGatesCli.mockResolvedValue(2);
    await import('./index.ts');
    expect(runGatesCli).toHaveBeenCalledWith(['run', '--gates', 'schema'], {
      cwd: '/from/init-cwd',
      env: process.env,
      log: console.log,
      error: console.error,
    });
    expect(process.exitCode).toBe(2);
  });

  it('falls back to the working directory and passes the exit code through', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    process.argv = ['node', 'index.ts', 'decide'];
    runGatesCli.mockResolvedValue(0);
    await import('./index.ts');
    expect(runGatesCli).toHaveBeenCalledWith(['decide'], expect.objectContaining({ cwd: '/from/cwd' }));
    expect(process.exitCode).toBe(0);
  });
});
