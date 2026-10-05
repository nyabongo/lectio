import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { ContentError } from './errors.ts';
import { nodeFs } from './files.ts';
import type { ContentFs } from './files.ts';
import { approvedOnly, isApproved, openRepo } from './repo.ts';
import type { ResolvedDay } from './repo.ts';

const REPO = fileURLToPath(new URL('fixtures/repo', import.meta.url));
const BROKEN = fileURLToPath(new URL('fixtures/broken', import.meta.url));

/** Node's fs, with some repository-relative paths answered (or failed) in memory. */
function overlayFs(root: string, files: Record<string, string | Error>): ContentFs {
  const lookup = (path: string) => files[path.slice(root.length + 1)];
  return {
    readFile(path) {
      const entry = lookup(path);
      if (entry instanceof Error) throw entry;
      return entry ?? nodeFs.readFile(path);
    },
    readdir(path) {
      const entry = lookup(path);
      if (entry instanceof Error) throw entry;
      return entry === undefined ? nodeFs.readdir(path) : entry.split('\n');
    },
  };
}

function contentError(fn: () => unknown): ContentError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContentError) return error;
    throw error;
  }
  throw new Error('expected a ContentError');
}

const readings = (day: ResolvedDay | null) =>
  (day?.masses ?? []).flatMap((mass) =>
    mass.readings.map(({ slot, key, approved, passage }) => ({ slot, key, approved, passage: passage?.key ?? null })),
  );

describe('openRepo: resolveDay', () => {
  const repo = openRepo(REPO);

  it('resolves every reading: approved, pending review and missing passages', () => {
    const day = repo.resolveDay('2026-09-20');
    expect(day?.date).toBe('2026-09-20');
    expect(day?.day.celebrations[0]?.colour).toBe('green');
    expect(day?.masses[0]?.id).toBe('day');
    expect(day?.masses[0]?.readings[3]).toMatchObject({
      slot: 'gospel',
      ref: 'Mt 20:1-16a',
      key: 'MT.20.1-16',
      linkout: 'https://www.drbo.org/chapter/47020.htm',
    });
    expect(readings(day)).toEqual([
      { slot: 'first-reading', key: 'IS.55.6-9', approved: false, passage: 'IS.55.6-9' },
      { slot: 'psalm', key: 'PS.145.2-3_145.8-9_145.17-18', approved: false, passage: null },
      { slot: 'second-reading', key: 'PHIL.1.20-24_1.27', approved: false, passage: null },
      { slot: 'gospel', key: 'MT.20.1-16', approved: true, passage: 'MT.20.1-16' },
    ]);
  });

  it('keeps a day without lectionary data, with no Masses', () => {
    const day = repo.resolveDay('2026-09-21');
    expect(day?.day.lectionaryMissing).toBe(true);
    expect(day?.masses).toEqual([]);
  });

  it('returns null for a date the calendar lacks or a year without a calendar file', () => {
    expect(repo.resolveDay('2026-09-22')).toBeNull();
    expect(repo.resolveDay('2031-01-01')).toBeNull();
  });

  it('rejects a malformed date', () => {
    expect(() => repo.resolveDay('2026-02-30')).toThrow(RangeError);
    expect(() => repo.resolveDay('today')).toThrow('date must be an ISO date (YYYY-MM-DD), got "today"');
  });
});

describe('openRepo: lazy, cached loading', () => {
  it('reads each file once and only when needed', () => {
    const readFile = vi.fn(nodeFs.readFile);
    const repo = openRepo(REPO, { fs: { ...nodeFs, readFile } });
    expect(readFile).not.toHaveBeenCalled();
    repo.resolveDay('2026-09-20');
    repo.resolveDay('2026-09-20');
    repo.resolveDay('2026-04-04');
    const read = readFile.mock.calls.map(([path]) => path.slice(REPO.length + 1));
    expect(read.filter((path) => path === 'calendar/2026.json')).toHaveLength(1);
    expect(read.filter((path) => path === 'passages/MT.20.1-16.json')).toHaveLength(1);
    expect(read.filter((path) => path === 'passages/PS.145.2-3_145.8-9_145.17-18.json')).toHaveLength(1);
    expect(read).not.toContain('calendar/2027.json');
  });

  it('exposes calendar years and passages directly', () => {
    const repo = openRepo(REPO);
    expect(repo.root).toBe(REPO);
    expect(repo.calendarYear(2026)?.region).toBe('kenya');
    expect(repo.calendarYear(2030)).toBeNull();
    expect(repo.years()).toEqual([2026, 2027]);
    expect(repo.passage('MT.20.1-16')?.review.status).toBe('approved');
    expect(repo.passage('ROM.6.3-11')).toBeNull();
    expect(repo.passageKeys()).toEqual(['IS.55.6-9', 'MT.20.1-16']);
  });

  it('refuses a key that could escape the passages directory', () => {
    expect(() => openRepo(REPO).passage('../calendar/2026')).toThrow('Not a passage key: "../calendar/2026"');
  });

  it('ignores non-year calendar files and non-JSON passage files, and treats missing directories as empty', () => {
    const repo = openRepo(REPO, {
      fs: overlayFs(REPO, {
        calendar: '2030.json\n2026.json\nREADME.md\n2027-draft.json',
        passages: 'MT.20.1-16.json\n.gitkeep\nnotes.json\nmt.20.1-16.json\n..json',
      }),
    });
    expect(repo.years()).toEqual([2026, 2030]);
    // 2030.json is listed but gone by the time it is read: skipped like any missing year.
    expect(repo.datesForPassage('MT.20.1-16')).toEqual(['2026-09-20']);
    expect(repo.passageKeys()).toEqual(['MT.20.1-16']);
    const empty = openRepo(join(REPO, 'nothing-here'));
    expect(empty.years()).toEqual([]);
    expect(empty.passageKeys()).toEqual([]);
    expect(empty.datesForPassage('MT.20.1-16')).toEqual([]);
  });
});

describe('openRepo: listDays', () => {
  const repo = openRepo(REPO);

  it('lists resolved days across years, in date order, skipping dates without a day', () => {
    const days = repo.listDays('2026-09-20', '2027-12-31');
    expect(days.map((day) => day.date)).toEqual(['2026-09-20', '2026-09-21', '2027-01-01', '2027-09-19']);
    expect(days[3]?.masses.map((mass) => mass.readings[0]?.approved)).toEqual([true, true]);
  });

  it('includes both ends, skips years without a file and is empty for a reversed range', () => {
    expect(repo.listDays('2026-04-04', '2026-04-04').map((day) => day.date)).toEqual(['2026-04-04']);
    expect(repo.listDays('2025-01-01', '2026-04-04').map((day) => day.date)).toEqual(['2026-04-04']);
    expect(repo.listDays('2027-01-01', '2026-01-01')).toEqual([]);
  });

  it('rejects malformed bounds', () => {
    expect(() => repo.listDays('2026-01-01', '2026-13-01')).toThrow('to must be an ISO date');
    expect(() => repo.listDays('x', '2026-01-01')).toThrow('from must be an ISO date');
  });
});

describe('openRepo: datesForPassage', () => {
  it('finds every date a passage is read, once per date, across years', () => {
    const repo = openRepo(REPO);
    expect(repo.datesForPassage('MT.20.1-16')).toEqual(['2026-09-20', '2027-09-19']);
    expect(repo.datesForPassage('ROM.6.3-11')).toEqual(['2026-04-04']);
    expect(repo.datesForPassage('JN.1.1-18')).toEqual([]);
  });

  it('returns a copy the caller may change', () => {
    const repo = openRepo(REPO);
    repo.datesForPassage('MT.20.1-16').push('2099-01-01');
    expect(repo.datesForPassage('MT.20.1-16')).toEqual(['2026-09-20', '2027-09-19']);
  });
});

describe('openRepo: invalid files', () => {
  const repo = openRepo(BROKEN);

  it('reports an invalid passage with its file and JSON pointer', () => {
    const error = contentError(() => repo.resolveDay('2026-09-20'));
    expect(error.file).toBe('passages/IS.55.6-9.json');
    expect(error.pointer).toBe('/key');
    expect(() => repo.passage('MT.20.1-16')).toThrow('passages/MT.20.1-16.json#/review: is required');
  });

  it('rejects a passage that stores reading text', () => {
    const error = contentError(() => repo.passage('PHIL.1.20-24_1.27'));
    expect(error.issues.filter((issue) => issue.pointer === '/text')).toEqual([
      { pointer: '/text', message: 'field name is not allowed' },
    ]);
  });

  it('reports an invalid calendar year with its file and JSON pointer', () => {
    const error = contentError(() => repo.resolveDay('2025-09-21'));
    expect(error.file).toBe('calendar/2025.json');
    expect(error.pointer).toBe('/days/0/celebrations/0/colour');
    expect(contentError(() => repo.calendarYear(2024)).pointer).toBe('/year');
    expect(contentError(() => repo.datesForPassage('MT.20.1-16')).file).toBe('calendar/2024.json');
    expect(contentError(() => repo.listDays('2025-01-01', '2025-12-31')).file).toBe('calendar/2025.json');
  });

  it('rejects a day whose date falls outside its file year, everywhere the year is read', () => {
    const calendar = JSON.parse(nodeFs.readFile(join(REPO, 'calendar/2026.json'))) as { days: { date: string }[] };
    const [first] = calendar.days;
    if (first === undefined) throw new Error('fixture day missing');
    first.date = '2027-09-19';
    const stray = openRepo(REPO, { fs: overlayFs(REPO, { 'calendar/2026.json': JSON.stringify(calendar) }) });
    const error = contentError(() => stray.resolveDay('2026-09-20'));
    expect(error).toMatchObject({ file: 'calendar/2026.json', pointer: '/days/0/date' });
    expect(error.message).toBe('calendar/2026.json#/days/0/date: must fall in 2026');
    expect(contentError(() => stray.listDays('2026-01-01', '2027-12-31')).pointer).toBe('/days/0/date');
    expect(contentError(() => stray.datesForPassage('MT.20.1-16')).pointer).toBe('/days/0/date');
  });

  it('reports malformed JSON and unreadable files against the whole file', () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const broken = openRepo(REPO, {
      fs: overlayFs(REPO, {
        'calendar/2026.json': '{ "year": 2026,',
        'passages/MT.20.1-16.json': denied,
        passages: denied,
        calendar: denied,
      }),
    });
    const malformed = contentError(() => broken.calendarYear(2026));
    expect(malformed).toMatchObject({ file: 'calendar/2026.json', pointer: '' });
    expect(malformed.message).toMatch(/not valid JSON/);
    expect(contentError(() => broken.passage('MT.20.1-16')).message).toBe(
      'passages/MT.20.1-16.json: cannot read file (EACCES: permission denied)',
    );
    expect(contentError(() => broken.passageKeys()).message).toBe(
      'passages: cannot list directory (EACCES: permission denied)',
    );
    expect(contentError(() => broken.years()).file).toBe('calendar');
  });
});

describe('isApproved and approvedOnly', () => {
  const repo = openRepo(REPO);

  it('treats only an approved review as approved', () => {
    expect(isApproved(repo.passage('MT.20.1-16'))).toBe(true);
    expect(isApproved(repo.passage('IS.55.6-9'))).toBe(false);
    expect(isApproved(null)).toBe(false);
    expect(isApproved(undefined)).toBe(false);
  });

  it('passes null through, so a missing day needs no check first', () => {
    expect(approvedOnly(repo.resolveDay('2026-09-22'))).toBeNull();
    const visible: ResolvedDay | null = approvedOnly(repo.resolveDay('2026-09-20'));
    expect(visible?.masses[0]?.readings[0]?.passage).toBeNull();
  });

  it('hides unapproved passages without changing the original day', () => {
    const day = repo.resolveDay('2026-09-20');
    if (day === null) throw new Error('fixture day missing');
    const visible = approvedOnly(day);
    expect(readings(visible)).toEqual([
      { slot: 'first-reading', key: 'IS.55.6-9', approved: false, passage: null },
      { slot: 'psalm', key: 'PS.145.2-3_145.8-9_145.17-18', approved: false, passage: null },
      { slot: 'second-reading', key: 'PHIL.1.20-24_1.27', approved: false, passage: null },
      { slot: 'gospel', key: 'MT.20.1-16', approved: true, passage: 'MT.20.1-16' },
    ]);
    expect(visible.day).toBe(day.day);
    expect(day.masses[0]?.readings[0]?.passage?.key).toBe('IS.55.6-9');
  });
});
