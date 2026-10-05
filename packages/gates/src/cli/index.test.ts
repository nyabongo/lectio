import { afterEach, describe, expect, it, vi } from 'vitest';

describe('lectio-gates entry point', () => {
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
    const runGatesCli = vi.fn(() => Promise.resolve(2));
    vi.doMock('./run.ts', () => ({ runGatesCli }));
    process.argv = ['node', 'index.ts', 'run', '--gates', 'schema'];
    await import('./index.ts');
    expect(runGatesCli).toHaveBeenCalledWith(['run', '--gates', 'schema'], expect.objectContaining({ cwd }));
    expect(process.exitCode).toBe(2);
  });
});
