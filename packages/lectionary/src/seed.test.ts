/**
 * The committed seed block (L-016, completed by L-048): Sundays 25-26 in Years A, B and C and the weekdays of OT
 * weeks 24-25 in Years I and II. Every rule holds and the cross-check is clean.
 */
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
    expect(rows).toHaveLength(87);
    expect(rows.every((row) => row.reading.status === 'provisional')).toBe(true);
  });

  it('has every slot of Sundays 25-26 in each Sunday cycle and of each weekday in Years I and II', () => {
    const entries = loaded.files.flatMap((f) => f.data.entries).filter((e) => e.key.startsWith('ot-'));
    expect(entries).toHaveLength(14);
    for (const entry of entries) {
      const readings = entry.masses[0]?.readings ?? [];
      const sunday = entry.key.startsWith('ot-sunday-');
      const slots = sunday
        ? (['first-reading', 'psalm', 'second-reading', 'gospel'] as const)
        : (['first-reading', 'psalm', 'gospel'] as const);
      for (const cycle of sunday ? (['A', 'B', 'C'] as const) : (['I', 'II'] as const)) {
        for (const slot of slots) {
          const found = readings.filter((r) => r.slot === slot && (r.cycle === cycle || r.cycle === undefined));
          expect(found, `${entry.key} ${slot} (${cycle})`).toHaveLength(1);
        }
      }
    }
    // Year I of the weekdays is OLM #443-454, the number of the day (as for Year II and the gospel).
    for (const row of blockRows(loaded.files).filter((r) => r.reading.cycle === 'I')) {
      const day = /^ot-weekday-(\d+)-([a-z]{3})$/.exec(row.key) as RegExpExecArray;
      const number =
        443 + (Number(day[1]) - 24) * 6 + ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(day[2] as string);
      expect(row.reading.source).toBe(`olm-1981 p?#${String(number)}`);
    }
  });

  it('imports Year A of the Sundays from LitCal and fills Years B and C, the weekdays and St Matthew from OLM 1981', () => {
    const bySource = (id: string) =>
      blockRows(loaded.files).filter((row) => splitSource(row.reading.source)?.id === id);
    expect(new Set(bySource('litcal').map((row) => row.key))).toEqual(new Set(['ot-sunday-25', 'ot-sunday-26']));
    const olm = new Set(bySource('olm-1981').map((row) => row.key));
    expect(olm.size).toBe(15);
    expect(olm.has('matthew-apostle')).toBe(true);
  });

  it('has no disagreements; every LitCal reading agrees with OLM 1981, and the rest name the LitCal leaf consulted', () => {
    expect(result.disagreements).toEqual([]);
    expect(result.agreements).toBe(8);
    expect(result.singleSource).toHaveLength(79);
    expect(result.singleSource.every((single) => single.consulted.length === 1)).toBe(true);
  });
});
