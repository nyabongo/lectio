/** The committed block ot-weekdays-18-34 (L-067): complete, every rule holds and the cross-check is clean. */
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

const BLOCK = 'ot-weekdays-18-34';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Weeks 24 and 25 belong to the seed block (L-016). */
const SEED_WEEKS = [24, 25];
const WEEKS = Array.from({ length: 17 }, (_, i) => 18 + i);
const keysOf = (weeks: number[]): string[] => weeks.flatMap((w) => DAYS.map((d) => `ot-weekday-${w}-${d}`));

describe(`${BLOCK} block`, () => {
  let block: LoadResult;
  let all: LoadResult;
  let result: CrosscheckResult;
  beforeAll(async () => {
    block = await loadLectionary(DATA_ROOT, [BLOCK]);
    all = await loadLectionary(DATA_ROOT);
    const json: unknown = JSON.parse(await readFile(join(DATA_ROOT, 'crosscheck', `${BLOCK}.json`), 'utf8'));
    const { data } = parseCrosscheckFile(json, `crosscheck/${BLOCK}.json`);
    result = crosscheckBlock(BLOCK, block.files, data as never, block.registry);
  });

  it('passes lectionary:check on its own and together with every other block', () => {
    expect(block.problems).toEqual([]);
    expect(checkLectionary(block.files, block.registry).problems).toEqual([]);
    expect(all.problems).toEqual([]);
    expect(checkLectionary(all.files, all.registry).problems).toEqual([]);
  });

  it('has Monday to Saturday of weeks 18-34, with weeks 24-25 left to the seed block', () => {
    const ours = block.files.flatMap((f) => f.data.entries.map((e) => e.key));
    expect(ours).toEqual(keysOf(WEEKS.filter((w) => !SEED_WEEKS.includes(w))));
    const seed = all.files.filter((f) => f.block === 'seed').flatMap((f) => f.data.entries.map((e) => e.key));
    expect(seed).toEqual(expect.arrayContaining(keysOf(SEED_WEEKS)));
  });

  it('gives every day a first reading and psalm for both years and a gospel for both years', () => {
    for (const file of block.files) {
      for (const entry of file.data.entries) {
        expect(entry.masses.map((m) => m.id)).toEqual(['day']);
        const readings = entry.masses[0]?.readings ?? [];
        for (const cycle of ['I', 'II'] as const) {
          for (const slot of ['first-reading', 'psalm', 'gospel'] as const) {
            const found = readings.some((r) => r.slot === slot && (r.cycle === cycle || r.cycle === undefined));
            expect(found, `${entry.key} ${slot} (${cycle})`).toBe(true);
          }
        }
      }
    }
  });

  it('marks every reading provisional, citing LitCal for week 34 Year I and OLM 1981 for the rest', () => {
    const rows = blockRows(block.files);
    expect(rows).toHaveLength(456);
    expect(rows.every((row) => row.reading.status === 'provisional')).toBe(true);
    const litcal = rows.filter((row) => splitSource(row.reading.source)?.id === 'litcal');
    expect(litcal).toHaveLength(18);
    expect(litcal.every((row) => row.key.startsWith('ot-weekday-34-') && row.reading.cycle === 'I')).toBe(true);
    const olm = rows.filter((row) => splitSource(row.reading.source)?.id === 'olm-1981');
    expect(olm).toHaveLength(rows.length - litcal.length);
    for (const row of olm) {
      const [, week, day] = /^ot-weekday-(\d+)-([a-z]{3})$/.exec(row.key) as RegExpExecArray;
      const number = 305 + (Number(week) - 1) * 6 + DAYS.indexOf(day as string);
      expect(row.reading.source).toBe(`olm-1981 p?#${number}`);
    }
  });

  it('agrees with OLM 1981 on every LitCal reading; the OLM-filled readings name the LitCal leaf consulted', () => {
    expect(result.disagreements).toEqual([]);
    expect(result.compared).toBe(18);
    expect(result.agreements).toBe(18);
    expect(result.singleSource).toHaveLength(438);
    expect(result.singleSource.every((single) => single.consulted.length === 1)).toBe(true);
  });
});
