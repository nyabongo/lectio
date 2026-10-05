/**
 * The committed seasonal-weekdays block (L-068): Advent, Christmas, Lent and Easter weekdays.
 * Completeness, sources, the cross-check and a few resolved days. Uses the package's public API only.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  Lectionary,
  blockRows,
  checkLectionary,
  crosscheckBlock,
  loadLectionary,
  parseCrosscheckFile,
  renderDisputes,
  resolveDay,
  splitSource,
} from './index.ts';
import type { CrosscheckResult, LectionaryDay, LoadResult } from './index.ts';

const DATA_ROOT = fileURLToPath(new URL('../../../calendar/lectionary', import.meta.url));
const ROMCAL_IDS = fileURLToPath(new URL('../../calendar/src/fixtures/romcal-ids.json', import.meta.url));
const BLOCK = 'seasonal-weekdays';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function weekdays(prefix: string, weeks: readonly number[], days: readonly string[] = DAYS): string[] {
  return weeks.flatMap((week) => days.map((day) => `${prefix}-weekday-${week}-${day}`));
}

/** Proper-of-time keys the block must define. */
const PROPER_OF_TIME = [
  ...weekdays('advent', [1, 2]),
  ...weekdays('advent', [3], ['mon', 'tue', 'wed', 'thu', 'fri']), // Saturday of week 3 always falls on 17-23 December
  ...weekdays('lent', [0], ['wed', 'thu', 'fri', 'sat']), // Ash Wednesday and the days after it
  ...weekdays('lent', [1, 2, 3, 4, 5]),
  ...weekdays('lent', [6], ['mon', 'tue', 'wed']), // Holy Week before the Triduum
  ...weekdays('easter', [2, 3, 4, 5, 6, 7]),
];

/** Celebration ids (from the calendar) of the weekdays whose readings follow the date or a fixed day. */
const DATED = [
  ...[17, 18, 19, 20, 21, 22, 23, 24].map((day) => `advent-december-${day}`),
  ...[5, 6, 7].map((day) => `christmas-octave-day-${day}`), // 29-31 December; 26-28 are feasts
  ...[2, 3, 4, 5, 6, 7].map((day) => `christmas-time-january-${day}`),
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => `${day}-after-epiphany`),
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => `easter-${day}`),
];

describe('seasonal-weekdays block', () => {
  let loaded: LoadResult;
  let result: CrosscheckResult;
  beforeAll(async () => {
    loaded = await loadLectionary(DATA_ROOT, [BLOCK]);
    const json: unknown = JSON.parse(await readFile(join(DATA_ROOT, 'crosscheck', `${BLOCK}.json`), 'utf8'));
    const { data, problems } = parseCrosscheckFile(json, `crosscheck/${BLOCK}.json`);
    expect(problems).toEqual([]);
    result = crosscheckBlock(BLOCK, loaded.files, data as never, loaded.registry);
  });

  it('passes lectionary:check, and every reading is provisional (but the Greek Esther one) with a LitCal or OLM 1981 source', () => {
    expect(loaded.problems).toEqual([]);
    expect(checkLectionary(loaded.files, loaded.registry).problems).toEqual([]);
    const rows = blockRows(loaded.files);
    expect(
      rows.filter((row) => row.reading.status !== 'provisional').map((row) => [row.id, row.reading.status]),
    ).toEqual([['proper-of-time:lent-weekday-1-thu day first-reading', 'disputed']]);
    expect(new Set(rows.map((row) => splitSource(row.reading.source)?.id))).toEqual(new Set(['litcal', 'olm-1981']));
  });

  it('defines no key another block defines', async () => {
    const all = await loadLectionary(DATA_ROOT);
    expect(checkLectionary(all.files, all.registry).problems.filter((p) => p.includes('already defined'))).toEqual([]);
  });

  it('is complete: every seasonal weekday has one Mass with a first reading, a psalm and a gospel', () => {
    const keys = (kind: string) =>
      loaded.files.filter((file) => file.data.kind === kind).flatMap((file) => file.data.entries.map((e) => e.key));
    expect(keys('proper-of-time')).toEqual(expect.arrayContaining(PROPER_OF_TIME));
    expect(keys('proper-of-time')).toHaveLength(PROPER_OF_TIME.length);
    expect(keys('celebrations').sort()).toEqual([...DATED].sort());
    for (const { data } of loaded.files) {
      for (const entry of data.entries) {
        expect(
          entry.masses.map((mass) => mass.id),
          entry.key,
        ).toEqual(['day']);
        const slots = entry.masses[0]?.readings.map((reading) => reading.slot);
        const expected =
          entry.key === 'lent-weekday-0-wed'
            ? ['first-reading', 'psalm', 'second-reading', 'gospel']
            : ['first-reading', 'psalm', 'gospel'];
        expect(slots, entry.key).toEqual(expected);
      }
    }
  });

  it('keys the dated weekdays by celebration ids the calendar actually produces', async () => {
    const ids = new Set(Object.values(JSON.parse(await readFile(ROMCAL_IDS, 'utf8')) as Record<string, string>));
    expect(DATED.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('compares every reading a second source covers, and the committed disputes file is up to date', async () => {
    const rows = blockRows(loaded.files);
    expect(result.compared + result.singleSource.length).toBe(rows.length);
    expect(result.singleSource.every((single) => single.consulted.length > 0)).toBe(true);
    expect(result.disagreements.map((d) => d.id)).toEqual([
      'proper-of-time:advent-weekday-1-mon day first-reading',
      'celebrations:advent-december-18 day gospel',
      'celebrations:christmas-time-january-5 day first-reading',
      'celebrations:christmas-time-january-5 day psalm',
      'celebrations:christmas-time-january-5 day gospel',
      'proper-of-time:lent-weekday-5-mon day gospel',
      'proper-of-time:easter-weekday-4-mon day gospel',
    ]);
    const committed = await readFile(join(DATA_ROOT, 'disputes', `${BLOCK}.md`), 'utf8');
    expect(committed).toBe(renderDisputes(result));
  });

  it('gives the OLM reading and its Sunday-cycle alternative where LitCal lacks or inverts it', () => {
    const find = (id: string) => blockRows(loaded.files).find((row) => row.id === id)?.reading;
    const summary = (id: string) => {
      const reading = find(id);
      return [reading?.ref, reading?.alternatives?.map((alt) => alt.ref), reading?.source];
    };
    expect(summary('proper-of-time:advent-weekday-1-mon day first-reading')).toEqual([
      'Is 2:1-5',
      ['Is 4:2-6'],
      'olm-1981 p?#175',
    ]);
    expect(summary('proper-of-time:lent-weekday-5-mon day gospel')).toEqual([
      'Jn 8:1-11',
      ['Jn 8:12-20'],
      'olm-1981 p?#251',
    ]);
    expect(summary('proper-of-time:easter-weekday-4-mon day gospel')).toEqual([
      'Jn 10:1-10',
      ['Jn 10:11-18'],
      'olm-1981 p?#279',
    ]);
  });

  it('resolves real days of each season', () => {
    const lectionary = new Lectionary(loaded.files);
    const day = (
      date: string,
      season: LectionaryDay['season'],
      seasonWeek: number,
      id: string,
      rank: 'weekday' | 'solemnity' = 'weekday',
    ): LectionaryDay => ({
      date: date as LectionaryDay['date'],
      season,
      seasonWeek,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [{ id, rank }],
    });
    const refs = (d: LectionaryDay) => resolveDay(d, lectionary).masses.map((m) => m.readings.map((r) => r.ref));
    expect(refs(day('2026-12-01', 'advent', 1, 'advent-1-tuesday'))).toEqual([
      ['Is 11:1-10', 'Ps 72:1-2, 7-8, 12-13, 17', 'Lk 10:21-24'],
    ]);
    expect(refs(day('2026-12-18', 'advent', 3, 'advent-december-18'))).toEqual([
      ['Jer 23:5-8', 'Ps 72:1-2, 12-13, 18-19', 'Mt 1:18-25'],
    ]);
    expect(refs(day('2026-12-30', 'christmas', 0, 'christmas-octave-day-6'))).toEqual([
      ['1 Jn 2:12-17', 'Ps 96:7-8, 8-9, 10', 'Lk 2:36-40'],
    ]);
    expect(refs(day('2027-02-10', 'lent', 0, 'ash-wednesday'))[0]).toEqual([
      'Jl 2:12-18',
      'Ps 51:3-4, 5-6, 12-13, 14, 17',
      '2 Cor 5:20-6:2',
      'Mt 6:1-6, 16-18',
    ]);
    expect(refs(day('2026-04-06', 'easter', 1, 'easter-monday', 'solemnity'))).toEqual([
      ['Acts 2:14, 22-33', 'Ps 16:1-2, 5, 7-8, 9-10, 11', 'Mt 28:8-15'],
    ]);
    expect(refs(day('2026-05-22', 'easter', 7, 'easter-time-7-friday'))).toEqual([
      ['Acts 25:13-21', 'Ps 103:1-2, 11-12, 19-20', 'Jn 21:15-19'],
    ]);
  });
});
