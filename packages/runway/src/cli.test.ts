// cli.ts is wiring only: it builds the context from the environment and the working directory
// and hands argv and console to runRunway (logic and tests: ./run.test.ts). run.ts is mocked so
// importing the entry point does not load config, content and the gh provider on first use.
// That cold import took several seconds under coverage on a loaded machine and timed the test out.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { processContext, runRunway } = vi.hoisted(() => ({
  processContext: vi.fn<(...args: unknown[]) => unknown>(),
  runRunway: vi.fn<(...args: unknown[]) => Promise<number>>(),
}));
vi.mock('./run.ts', () => ({ processContext, runRunway }));

describe('runway entry point', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    processContext.mockReset();
    runRunway.mockReset();
    vi.resetModules();
  });

  it('runs runRunway with argv and the process context, and sets the exit code', async () => {
    process.argv = ['node', 'cli.ts', '--dry-run'];
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    const context = { marker: 'context' };
    processContext.mockReturnValue(context);
    runRunway.mockResolvedValue(2);
    await import('./cli.ts');
    expect(processContext).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(runRunway).toHaveBeenCalledWith(['--dry-run'], context, { out: console.log, err: console.error });
    expect(process.exitCode).toBe(2);
  });
});
