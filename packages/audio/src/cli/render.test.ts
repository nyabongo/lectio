import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('audio:render entry point', () => {
  const argv = process.argv;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lectio-audio-entry-'));
    // An empty content root: nothing to render, but the whole pipeline runs.
    await writeFile(join(dir, 'lectio.config.json'), JSON.stringify({ content: { root: dir } }));
    vi.stubEnv('LECTIO_CONFIG', join(dir, 'lectio.config.json'));
  });

  afterEach(async () => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(dir, { recursive: true, force: true });
  });

  it('runs relative to INIT_CWD and sets the exit code', async () => {
    vi.stubEnv('INIT_CWD', dir);
    process.argv = ['node', 'render.ts', '--storage', 'memory'];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./render.ts');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^audio:render: 0 segments/));
    expect(process.exitCode).toBe(0);
  });

  it('falls back to the working directory and reports usage errors', async () => {
    vi.stubEnv('INIT_CWD', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    process.argv = ['node', 'render.ts', '--bogus'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./render.ts');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown or incomplete argument "--bogus"'));
    expect(process.exitCode).toBe(2);
  });
});
