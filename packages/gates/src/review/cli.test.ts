import { afterEach, describe, expect, it, vi } from 'vitest';

describe('review:approve entry point', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.doUnmock('./run.ts');
    vi.resetModules();
  });

  it.each([
    ['/from/npm', '/from/npm'],
    [undefined, process.cwd()],
  ])('passes argv and INIT_CWD=%s and sets the exit code', async (initCwd, cwd) => {
    vi.resetModules();
    vi.stubEnv('INIT_CWD', initCwd);
    const runApprove = vi.fn((_args: readonly string[], options: { now: () => Date }) => {
      expect(options.now()).toBeInstanceOf(Date);
      return Promise.resolve(1);
    });
    vi.doMock('./run.ts', () => ({ runApprove }));
    process.argv = ['node', 'cli.ts', 'passages/A.1.json', '--reviewer', 'x'];
    await import('./cli.ts');
    expect(runApprove).toHaveBeenCalledWith(['passages/A.1.json', '--reviewer', 'x'], expect.objectContaining({ cwd }));
    expect(process.exitCode).toBe(1);
  });
});
