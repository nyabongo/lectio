// check.ts, crosscheck.ts and import-litcal.ts are wiring only: they resolve the data directory from the
// environment and the working directory and hand argv and console to the run functions (logic and tests:
// ./run.test.ts). run.ts is mocked so importing an entry point does not load the lectionary data, refs and
// schemas on first use. That cold import took several seconds under coverage on a loaded machine and could
// time the test out.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpFetcher: vi.fn<(...args: unknown[]) => unknown>(),
  invocationDir: vi.fn<(...args: unknown[]) => string>(),
  resolveLectionaryRoot: vi.fn<(...args: unknown[]) => string>(),
  runCheck: vi.fn<(...args: unknown[]) => Promise<number>>(),
  runCrosscheck: vi.fn<(...args: unknown[]) => Promise<number>>(),
  runImportLitcal: vi.fn<(...args: unknown[]) => Promise<number>>(),
}));
vi.mock('./run.ts', () => mocks);

const io = { out: console.log, err: console.error };

describe('CLI entry points', () => {
  const argv = process.argv;

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
    mocks.resolveLectionaryRoot.mockReturnValue('/data/root');
  }

  it('check.ts runs runCheck on the resolved data directory from the invocation directory, and sets the exit code', async () => {
    setUp('check.ts', ['--block', 'advent']);
    mocks.invocationDir.mockReturnValue('/invoked/here');
    mocks.runCheck.mockResolvedValue(1);
    await import('./check.ts');
    expect(mocks.resolveLectionaryRoot).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.invocationDir).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runCheck).toHaveBeenCalledWith(['--block', 'advent'], '/data/root', io, '/invoked/here');
    expect(process.exitCode).toBe(1);
  });

  it('crosscheck.ts runs runCrosscheck with argv and sets the exit code', async () => {
    setUp('crosscheck.ts', ['--block', 'lent']);
    mocks.runCrosscheck.mockResolvedValue(2);
    await import('./crosscheck.ts');
    expect(mocks.resolveLectionaryRoot).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runCrosscheck).toHaveBeenCalledWith(['--block', 'lent'], '/data/root', io);
    expect(process.exitCode).toBe(2);
  });

  it('import-litcal.ts runs runImportLitcal with argv and the HTTP fetcher, and sets the exit code', async () => {
    setUp('import-litcal.ts', ['manifest.json']);
    const fetcher = { marker: 'fetcher' };
    mocks.httpFetcher.mockReturnValue(fetcher);
    mocks.runImportLitcal.mockResolvedValue(0);
    await import('./import-litcal.ts');
    expect(mocks.httpFetcher).toHaveBeenCalledWith();
    expect(mocks.resolveLectionaryRoot).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runImportLitcal).toHaveBeenCalledWith(['manifest.json'], '/data/root', io, fetcher);
    expect(process.exitCode).toBe(0);
  });
});
