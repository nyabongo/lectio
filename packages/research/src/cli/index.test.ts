// index.ts is wiring only: it builds the context from the environment and the working directory and
// hands argv and console to main (logic and tests: ./main.test.ts). main.ts is mocked so importing the
// entry point does not load the providers and the gates on first use.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processContext: vi.fn<(...args: unknown[]) => unknown>(),
  main: vi.fn<(...args: unknown[]) => Promise<number>>(),
}));
vi.mock('./main.ts', () => mocks);

describe('CLI entry point', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('runs main with argv and the process context, and sets the exit code', async () => {
    process.argv = ['node', 'index.ts', 'plan', '--days', '7'];
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    const context = { marker: 'context' };
    mocks.processContext.mockReturnValue(context);
    mocks.main.mockResolvedValue(2);
    await import('./index.ts');
    expect(mocks.processContext).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.main).toHaveBeenCalledWith(['plan', '--days', '7'], context, { out: console.log, err: console.error });
    expect(process.exitCode).toBe(2);
  });
});
