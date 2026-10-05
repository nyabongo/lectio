// cli.ts is wiring only: it hands argv, the working directory, the environment, a clock and console to
// runApprove (logic and tests: ./run.test.ts). run.ts is mocked once for the file, so importing the
// entry point never loads the review pipeline on first use.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runApprove } = vi.hoisted(() => ({ runApprove: vi.fn<(...args: unknown[]) => Promise<number>>() }));
vi.mock('./run.ts', () => ({ runApprove }));

describe('review:approve entry point', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runApprove.mockReset();
    vi.resetModules();
  });

  it('runs relative to INIT_CWD with the system clock and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', '/from/init-cwd');
    process.argv = ['node', 'cli.ts', 'passages/A.1.json', '--reviewer', 'x'];
    runApprove.mockResolvedValue(1);
    await import('./cli.ts');
    expect(runApprove).toHaveBeenCalledWith(['passages/A.1.json', '--reviewer', 'x'], {
      cwd: '/from/init-cwd',
      env: process.env,
      now: expect.any(Function) as unknown,
      log: console.log,
      error: console.error,
    });
    const [, options] = runApprove.mock.calls[0] as [unknown, { now: () => Date }];
    expect(options.now()).toBeInstanceOf(Date);
    expect(process.exitCode).toBe(1);
  });

  it('falls back to the working directory and passes the exit code through', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    process.argv = ['node', 'cli.ts', 'passages/A.1.json'];
    runApprove.mockResolvedValue(0);
    await import('./cli.ts');
    expect(runApprove).toHaveBeenCalledWith(['passages/A.1.json'], expect.objectContaining({ cwd: '/from/cwd' }));
    expect(process.exitCode).toBe(0);
  });
});
