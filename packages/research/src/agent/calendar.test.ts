import { fileURLToPath } from 'node:url';

import { openRepo } from '@lectio/content';
import { describe, expect, it } from 'vitest';

import type { WorkItem } from '../plan/plan.ts';
import { calendarContext, formatCalendarContext } from './calendar.ts';

const repo = openRepo(fileURLToPath(new URL('../fixtures/repo', import.meta.url)));

const item = (key: string, ref: string, firstDate: string): WorkItem => ({
  key,
  ref,
  firstDate: firstDate as WorkItem['firstDate'],
  dates: [firstDate as WorkItem['firstDate']],
});

describe('calendarContext', () => {
  it('describes the day, the celebration, the Mass and the slot', () => {
    const context = calendarContext(repo, item('LK.10.1-12', 'Lk 10:1-12', '2026-10-01'));
    expect(context).toEqual({
      date: '2026-10-01',
      season: 'ordinary-time',
      seasonWeek: 26,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebration: { name: 'Saint Thérèse of the Child Jesus', rank: 'memorial', colour: 'white' },
      mass: 'Mass of the day',
      slot: 'gospel',
      readings: [
        { slot: 'first-reading', ref: 'Jb 19:21-27' },
        { slot: 'psalm', ref: 'Ps 27:7-8a, 8b-9abc, 13-14' },
        { slot: 'gospel', ref: 'Lk 10:1-12' },
      ],
      dates: ['2026-10-01'],
    });
  });

  it('is null when the calendar has no such day or the day does not read the passage', () => {
    expect(calendarContext(repo, item('LK.10.1-12', 'Lk 10:1-12', '2031-01-01'))).toBeNull();
    expect(calendarContext(repo, item('MT.20.1-16', 'Mt 20:1-16a', '2026-10-01'))).toBeNull();
  });
});

describe('formatCalendarContext', () => {
  it('prints references only', () => {
    const text = formatCalendarContext(calendarContext(repo, item('LK.10.1-12', 'Lk 10:1-12', '2026-10-01')));
    expect(text).toContain('- Celebration: Saint Thérèse of the Child Jesus (memorial, white)');
    expect(text).toContain('- Season: ordinary-time, week 26; Sunday cycle A, weekday cycle II');
    expect(text).toContain('first-reading Jb 19:21-27; psalm Ps 27:7-8a, 8b-9abc, 13-14; gospel Lk 10:1-12');
  });

  it('says when there is no context', () => {
    expect(formatCalendarContext(null)).toBe('No calendar context is available for this passage.');
  });
});
