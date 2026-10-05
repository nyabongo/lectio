/** The committed block ot-weekdays-01-17 (L-066): complete, every rule holds, and the cross-check is current. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { checkLectionary } from './check.ts';
import { blockRows, crosscheckBlock, parseCrosscheckFile, renderDisputes } from './crosscheck.ts';
import type { CrosscheckResult, Row } from './crosscheck.ts';
import { DATA_ROOT } from './fixtures/data.ts';
import { loadLectionary } from './load.ts';
import type { LoadResult } from './load.ts';
import { splitSource } from './sources.ts';

const BLOCK = 'ot-weekdays-01-17';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);
/** Every weekday Mass: a first reading and a psalm for each year, and one gospel shared by both. */
const SHAPE = ['first-reading (I)', 'first-reading (II)', 'psalm (I)', 'psalm (II)', 'gospel'];

/** OLM 1981 numbers the OT weekdays from 305 (week 1, Monday), one number per day for both years. */
const olmNumber = (week: number, day: number): number => 305 + (week - 1) * 6 + day;

describe(`block ${BLOCK}`, () => {
  let loaded: LoadResult;
  let rows: Row[];
  let result: CrosscheckResult;
  beforeAll(async () => {
    loaded = await loadLectionary(DATA_ROOT, [BLOCK]);
    rows = blockRows(loaded.files);
    const json: unknown = JSON.parse(await readFile(join(DATA_ROOT, 'crosscheck', `${BLOCK}.json`), 'utf8'));
    const { data, problems } = parseCrosscheckFile(json, `crosscheck/${BLOCK}.json`);
    expect(problems).toEqual([]);
    result = crosscheckBlock(BLOCK, loaded.files, data as never, loaded.registry);
  });

  it('passes lectionary:check, and every reading is provisional with a source', () => {
    expect(loaded.problems).toEqual([]);
    expect(checkLectionary(loaded.files, loaded.registry).problems).toEqual([]);
    expect(rows.every((row) => row.reading.status === 'provisional')).toBe(true);
  });

  it('is complete: Monday to Saturday of weeks 1-17, each with both years and a shared gospel, and nothing else', () => {
    const expected = WEEKS.flatMap((week) => DAYS.map((day) => `ot-weekday-${week}-${day}`));
    expect(loaded.files.flatMap((file) => file.data.entries.map((entry) => entry.key))).toEqual(expected);
    for (const key of expected) {
      const slots = rows
        .filter((row) => row.key === key)
        .map((row) => row.id.slice(row.id.indexOf(' day ') + 5))
        .sort();
      expect(slots, key).toEqual([...SHAPE].sort());
    }
    expect(rows).toHaveLength(102 * 5);
  });

  it('imports Year II weeks 1-11 from LitCal (except 8-sat) and fills the rest from OLM 1981 by lectionary number', () => {
    for (const row of rows) {
      const [, week, day] = /^ot-weekday-(\d+)-(\w+)$/.exec(row.key) as unknown as [string, string, string];
      const w = Number(week);
      const source = splitSource(row.reading.source);
      const fromLitcal = w <= 11 && row.key !== 'ot-weekday-8-sat' && row.reading.cycle !== 'I';
      if (fromLitcal) {
        expect(source?.id, row.id).toBe('litcal');
        expect(row.reading.printed, row.id).toBeDefined();
      } else {
        expect(row.reading.source, row.id).toBe(`olm-1981 p?#${olmNumber(w, DAYS.indexOf(day as never))}`);
      }
    }
  });

  it('compares every LitCal reading with OLM 1981, and names the LitCal leaves consulted for the rest', () => {
    expect(result.compared).toBe(196);
    expect(result.singleSource).toHaveLength(510 - 196);
    expect(result.singleSource.every((single) => single.consulted.length > 0)).toBe(true);
    expect(result.disagreements.map((d) => d.id)).toEqual([
      'proper-of-time:ot-weekday-4-tue day first-reading (II)',
      'proper-of-time:ot-weekday-6-fri day gospel',
      'proper-of-time:ot-weekday-9-sat day psalm (II)',
    ]);
  });

  it('has a current disputes file', async () => {
    const committed = await readFile(join(DATA_ROOT, 'disputes', `${BLOCK}.md`), 'utf8');
    expect(committed).toBe(renderDisputes(result));
  });
});
