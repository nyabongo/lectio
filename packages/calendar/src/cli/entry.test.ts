// build.ts and check.ts are wiring only: they build the context from the environment and the working
// directory and hand argv and console to runBuild and runCheck (logic and tests: ./run.test.ts). run.ts is
// mocked so importing an entry point does not load romcal, the lectionary and refs on first use. That cold
// import took seconds under coverage and used to need a preload with a 60 s timeout.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processContext: vi.fn<(...args: unknown[]) => unknown>(),
  runBuild: vi.fn<(...args: unknown[]) => Promise<number>>(),
  runCheck: vi.fn<(...args: unknown[]) => Promise<number>>(),
}));
vi.mock('./run.ts', () => mocks);

const io = { out: console.log, err: console.error };

describe('CLI entry points', () => {
  const argv = process.argv;
  const context = { marker: 'context' };

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.resetModules();
  });

  function setUp(entry: string, args: readonly string[]): void {
    process.argv = ['node', entry, ...args];
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    mocks.processContext.mockReturnValue(context);
  }

  it('build.ts runs runBuild with argv and the process context, and sets the exit code', async () => {
    setUp('build.ts', ['--year', '2026']);
    mocks.runBuild.mockResolvedValue(0);
    await import('./build.ts');
    expect(mocks.processContext).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runBuild).toHaveBeenCalledWith(['--year', '2026'], context, io);
    expect(process.exitCode).toBe(0);
  });

  it('check.ts runs runCheck with argv and the process context, and sets the exit code', async () => {
    setUp('check.ts', ['--bogus']);
    mocks.runCheck.mockResolvedValue(2);
    await import('./check.ts');
    expect(mocks.processContext).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runCheck).toHaveBeenCalledWith(['--bogus'], context, io);
    expect(process.exitCode).toBe(2);
  });
});
