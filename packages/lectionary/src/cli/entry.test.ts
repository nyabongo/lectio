import { afterEach, describe, expect, it, vi } from 'vitest';

import { DATA_ROOT } from '../fixtures/data.ts';
import { checkLectionary } from '../check.ts';
import { loadLectionary } from '../load.ts';

describe('CLI entry points', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('check.ts runs runCheck on the resolved data directory', async () => {
    vi.stubEnv('LECTIO_LECTIONARY_ROOT', DATA_ROOT);
    process.argv = ['node', 'check.ts'];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./check.ts');
    // The committed data, counted independently of the CLI.
    const { files, registry } = await loadLectionary(DATA_ROOT);
    const { stats } = checkLectionary(files, registry);
    expect(stats.files).toBeGreaterThanOrEqual(9);
    expect(log.mock.calls[0]?.[0]).toBe(
      `lectionary:check: ${String(stats.files)} files, ${String(stats.entries)} entries, ${String(stats.readings)} readings ` +
        `(${String(stats.byStatus.provisional)} provisional, 0 verified, 0 disputed)`,
    );
    expect(process.exitCode).toBe(0);
  });

  it('crosscheck.ts runs runCrosscheck with argv', async () => {
    vi.stubEnv('LECTIO_LECTIONARY_ROOT', DATA_ROOT);
    process.argv = ['node', 'crosscheck.ts'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./crosscheck.ts');
    expect(error).toHaveBeenCalledWith('usage: lectionary:crosscheck -- --block <name>');
    expect(process.exitCode).toBe(2);
  });

  it('import-litcal.ts runs runImportLitcal with argv (usage error, so nothing is fetched)', async () => {
    vi.stubEnv('LECTIO_LECTIONARY_ROOT', DATA_ROOT);
    process.argv = ['node', 'import-litcal.ts'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./import-litcal.ts');
    expect(error.mock.calls[0]?.[0]).toMatch(/^usage: import-litcal/);
    expect(process.exitCode).toBe(2);
  });
});
