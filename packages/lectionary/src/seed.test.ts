/** The committed seed block (L-016): every rule holds and the cross-check is clean. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { checkLectionary } from './check.ts';
import { blockRows, crosscheckBlock, parseCrosscheckFile } from './crosscheck.ts';
import type { CrosscheckResult } from './crosscheck.ts';
import { DATA_ROOT } from './fixtures/data.ts';
import { loadLectionary } from './load.ts';
import type { LoadResult } from './load.ts';
import { splitSource } from './sources.ts';

describe('seed block', () => {
  let loaded: LoadResult;
  let result: CrosscheckResult;
  beforeAll(async () => {
    loaded = await loadLectionary(DATA_ROOT, ['seed']);
    const json: unknown = JSON.parse(await readFile(join(DATA_ROOT, 'crosscheck', 'seed.json'), 'utf8'));
    const { data } = parseCrosscheckFile(json, 'crosscheck/seed.json');
    result = crosscheckBlock('seed', loaded.files, data as never, loaded.registry);
  });

  it('passes lectionary:check, and every reading is provisional with a source', () => {
    expect(loaded.problems).toEqual([]);
    expect(checkLectionary(loaded.files, loaded.registry).problems).toEqual([]);
    const rows = blockRows(loaded.files);
    expect(rows).toHaveLength(47);
    expect(rows.every((row) => row.reading.status === 'provisional')).toBe(true);
  });

  it('imports the Sundays from LitCal and fills the weekdays and St Matthew from OLM 1981', () => {
    const bySource = (id: string) =>
      blockRows(loaded.files).filter((row) => splitSource(row.reading.source)?.id === id);
    expect(new Set(bySource('litcal').map((row) => row.key))).toEqual(new Set(['ot-sunday-25', 'ot-sunday-26']));
    const olm = new Set(bySource('olm-1981').map((row) => row.key));
    expect(olm.size).toBe(13);
    expect(olm.has('matthew-apostle')).toBe(true);
  });

  it('has no disagreements; every LitCal reading agrees with OLM 1981, and the rest name the LitCal leaf consulted', () => {
    expect(result.disagreements).toEqual([]);
    expect(result.agreements).toBe(8);
    expect(result.singleSource).toHaveLength(39);
    expect(result.singleSource.every((single) => single.consulted.length === 1)).toBe(true);
  });
});
