// render.ts is wiring only: it hands argv, the working directory, the environment and console
// to runRender (logic and tests: ./run.test.ts). runRender is mocked so importing the entry point
// does not load config, content and providers on first use. That cold import took several
// seconds under coverage on a loaded machine and timed the test out.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runRender } = vi.hoisted(() => ({ runRender: vi.fn<(...args: unknown[]) => Promise<number>>() }));
vi.mock('./run.ts', () => ({ runRender }));

describe('audio:render entry point', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runRender.mockReset();
    vi.resetModules();
  });

  it('runs relative to INIT_CWD and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', '/from/init-cwd');
    process.argv = ['node', 'render.ts', '--storage', 'memory'];
    runRender.mockResolvedValue(0);
    await import('./render.ts');
    expect(runRender).toHaveBeenCalledWith(['--storage', 'memory'], {
      cwd: '/from/init-cwd',
      env: process.env,
      io: { out: console.log, err: console.error },
    });
    expect(process.exitCode).toBe(0);
  });

  it('falls back to the working directory and passes the exit code through', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    process.argv = ['node', 'render.ts', '--bogus'];
    runRender.mockResolvedValue(2);
    await import('./render.ts');
    expect(runRender).toHaveBeenCalledWith(['--bogus'], expect.objectContaining({ cwd: '/from/cwd' }));
    expect(process.exitCode).toBe(2);
  });
});
