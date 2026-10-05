// find.ts and licences.ts are wiring only: they resolve the corpus root from the environment and the
// working directory and hand argv and console to the run functions (logic and tests: ./run.test.ts).
// run.ts is mocked so importing an entry point does not load the corpus readers on first use. That cold
// import could take seconds under coverage on a loaded machine and time the test out.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveCorpusRoot: vi.fn<(...args: unknown[]) => string>(),
  runFind: vi.fn<(...args: unknown[]) => Promise<number>>(),
  runLicences: vi.fn<(...args: unknown[]) => Promise<number>>(),
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

  it('find.ts runs runFind with argv and the resolved corpus root, and sets the exit code', async () => {
    process.argv = ['node', 'find.ts', 'grc-test', 'MT', '20', '15', 'πονηρός'];
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    mocks.resolveCorpusRoot.mockReturnValue('/corpus/root');
    mocks.runFind.mockResolvedValue(1);
    await import('./find.ts');
    expect(mocks.resolveCorpusRoot).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runFind).toHaveBeenCalledWith(['grc-test', 'MT', '20', '15', 'πονηρός'], '/corpus/root', io);
    expect(process.exitCode).toBe(1);
  });

  it('licences.ts runs runLicences on the resolved corpus root and sets the exit code', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/from/cwd');
    mocks.resolveCorpusRoot.mockReturnValue('/corpus/root');
    mocks.runLicences.mockResolvedValue(0);
    await import('./licences.ts');
    expect(mocks.resolveCorpusRoot).toHaveBeenCalledWith(process.env, '/from/cwd');
    expect(mocks.runLicences).toHaveBeenCalledWith('/corpus/root', io);
    expect(process.exitCode).toBe(0);
  });
});
