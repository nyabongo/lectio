import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtureRoot = fileURLToPath(new URL('../fixtures/corpus', import.meta.url));

describe('CLI entry points', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('find.ts runs runFind with argv and the resolved corpus root', async () => {
    vi.stubEnv('LECTIO_CORPUS_ROOT', fixtureRoot);
    process.argv = ['node', 'find.ts', 'grc-test', 'MT', '20', '15', 'πονηρός'];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./find.ts');
    expect(log).toHaveBeenCalledWith('grc-test MT 20:15: "πονηρός" found (match: either)');
    expect(process.exitCode).toBe(0);
  });

  it('licences.ts prints the attribution list', async () => {
    vi.stubEnv('LECTIO_CORPUS_ROOT', fixtureRoot);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./licences.ts');
    expect(log.mock.calls[0]?.[0]).toMatch(/^grc-test: /);
    expect(process.exitCode).toBe(0);
  });
});
