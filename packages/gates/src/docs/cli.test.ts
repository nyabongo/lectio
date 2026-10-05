// cli.ts is wiring only: it hands argv, the working directory and console to runGatesDocs (logic and
// tests: ./run.test.ts). run.ts is mocked, so importing the entry point never writes a file.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runGatesDocs } = vi.hoisted(() => ({ runGatesDocs: vi.fn<(...args: unknown[]) => Promise<number>>() }));
vi.mock('./run.ts', () => ({ runGatesDocs }));

describe('gates:docs entry point', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runGatesDocs.mockReset();
    vi.resetModules();
  });

  it('runs from INIT_CWD and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', '/from/init-cwd');
    process.argv = ['node', 'cli.ts', '--check'];
    runGatesDocs.mockResolvedValue(1);
    await import('./cli.ts');
    expect(runGatesDocs).toHaveBeenCalledWith(['--check'], {
      cwd: '/from/init-cwd',
      log: console.log,
      error: console.error,
    });
    expect(process.exitCode).toBe(1);
  });

  it('falls back to the working directory', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    process.argv = ['node', 'cli.ts'];
    runGatesDocs.mockResolvedValue(0);
    await import('./cli.ts');
    expect(runGatesDocs).toHaveBeenCalledWith([], expect.objectContaining({ cwd: '/from/cwd' }));
    expect(process.exitCode).toBe(0);
  });
});
