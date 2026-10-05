import { describe, expect, it } from 'vitest';

import type { CelebrationDetail, DetailedDay } from '../map.ts';
import { PROPER_PRECEDENCE, addedCelebration, applyOverrides } from './apply.ts';
import type { ApplyContext, ApplyResult } from './apply.ts';
import type { OverrideEntry, RegionalOverrides } from './schema.ts';

const source = { title: 'Test source', url: 'https://example.org/ordo', accessed: '2026-10-05' };

function cel(
  id: string,
  rank: CelebrationDetail['rank'],
  precedence: string,
  extra: Partial<CelebrationDetail> = {},
): CelebrationDetail {
  const colours = extra.colours ?? ['white'];
  return {
    id,
    name: id,
    rank,
    colour: colours[0] as CelebrationDetail['colour'],
    romcalId: id.replaceAll('-', '_'),
    colours,
    precedence,
    optional: rank === 'optional-memorial' || rank === 'commemoration',
    holyDayOfObligation: false,
    properCycle: rank === 'weekday' || rank === 'sunday' ? 'proper-of-time' : 'proper-of-saints',
    ...extra,
  };
}

const weekday = (id: string, colour: CelebrationDetail['colour'] = 'green'): CelebrationDetail =>
  cel(id, 'weekday', 'WEEKDAY_13', { colours: [colour] });
const lentWeekday = (id: string): CelebrationDetail =>
  cel(id, 'weekday', 'PRIVILEGED_WEEKDAY_9', { colours: ['violet'] });
const otSunday = (id: string): CelebrationDetail => cel(id, 'sunday', 'UNPRIVILEGED_SUNDAY_6', { colours: ['green'] });
const lentSunday = (id: string): CelebrationDetail => cel(id, 'sunday', 'PRIVILEGED_SUNDAY_2', { colours: ['violet'] });
const memorial = (id: string, weekdayId?: string): CelebrationDetail =>
  cel(id, 'memorial', 'GENERAL_MEMORIAL_10', weekdayId ? { weekdayId } : {});
const option = (id: string, weekdayId?: string): CelebrationDetail =>
  cel(id, 'optional-memorial', 'OPTIONAL_MEMORIAL_12', weekdayId ? { weekdayId } : {});

/** A year of days from `date → celebrations`; base days are the weekdays and Sundays given in `bases`. */
function setup(spec: Record<string, CelebrationDetail[]>, bases: Record<string, CelebrationDetail> = {}) {
  const days: DetailedDay[] = Object.entries(spec).map(([date, celebrations]) => ({
    date,
    season: 'ordinary-time',
    seasonWeek: 1,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations,
    masses: [],
    lectionaryMissing: true,
  }));
  const baseMap = new Map(Object.entries(bases));
  for (const day of days) {
    const own = day.celebrations.find((c) => c.rank === 'weekday' || c.rank === 'sunday');
    if (own && !baseMap.has(day.date)) baseMap.set(day.date, own);
  }
  const base: ApplyContext = { baseDay: (date: string) => baseMap.get(date) };
  return { days, base };
}

function overrides(...entries: OverrideEntry[]): RegionalOverrides {
  return { region: 'test', description: 'Test overrides', transfers: {}, entries };
}

const add = (
  id: string,
  date: string,
  rank: Extract<OverrideEntry, { action: 'add' }>['rank'],
  colours: Extract<OverrideEntry, { action: 'add' }>['colours'] = ['white'],
): OverrideEntry => ({ action: 'add', id, name: `Saint ${id}`, date, rank, colours, source, confidence: 'probable' });

function ids(result: ApplyResult, date: string): [string, string, boolean][] {
  const day = result.days.find((d) => d.date === date);
  if (!day) throw new Error(`no ${date}`);
  return day.celebrations.map((c) => [c.id, c.rank, c.optional]);
}

function celebration(result: ApplyResult, date: string, id: string): CelebrationDetail {
  const found = result.days.find((d) => d.date === date)?.celebrations.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id} on ${date}`);
  return found;
}

describe('addedCelebration', () => {
  it('builds a proper-of-saints celebration with the proper precedence for its rank', () => {
    const entry = add('x', '05-01', 'memorial', ['red', 'white']);
    if (entry.action !== 'add') throw new Error('add');
    expect(addedCelebration(entry)).toEqual({
      id: 'x',
      name: 'Saint x',
      rank: 'memorial',
      colour: 'red',
      romcalId: '',
      colours: ['red', 'white'],
      precedence: 'PROPER_MEMORIAL_11B',
      optional: false,
      holyDayOfObligation: false,
      properCycle: 'proper-of-saints',
    });
    expect(addedCelebration({ ...entry, holyDayOfObligation: true }).holyDayOfObligation).toBe(true);
  });

  it('has a proper precedence for every rank', () => {
    expect(Object.keys(PROPER_PRECEDENCE)).toEqual(['solemnity', 'feast', 'memorial', 'optional-memorial']);
  });
});

describe('applyOverrides: add', () => {
  it('adds an optional memorial on a weekday as an option', () => {
    const { days, base } = setup({ '2026-07-28': [weekday('ot-17-tue')] });
    const result = applyOverrides(days, overrides(add('victor', '07-28', 'optional-memorial', ['red'])), base);
    expect(ids(result, '2026-07-28')).toEqual([
      ['ot-17-tue', 'weekday', false],
      ['victor', 'optional-memorial', true],
    ]);
    expect(celebration(result, '2026-07-28', 'victor')).toMatchObject({ colour: 'red', weekdayId: 'ot-17-tue' });
    expect(result.events).toEqual([{ id: 'victor', outcome: 'added', date: '2026-07-28' }]);
  });

  it('adds an optional memorial next to others, without a weekday id when there is no base day', () => {
    const { days } = setup({ '2026-07-28': [option('other')] });
    const result = applyOverrides(days, overrides(add('victor', '07-28', 'optional-memorial')), {
      baseDay: () => undefined,
    });
    expect(ids(result, '2026-07-28')).toEqual([
      ['other', 'optional-memorial', true],
      ['victor', 'optional-memorial', true],
    ]);
    expect(celebration(result, '2026-07-28', 'victor').weekdayId).toBeUndefined();
  });

  it('an obligatory memorial takes a weekday and drops its optional memorials', () => {
    const { days, base } = setup({ '2026-10-10': [weekday('ot-27-sat'), option('bvm-saturday', 'ot-27-sat')] });
    const result = applyOverrides(days, overrides(add('comboni', '10-10', 'memorial')), base);
    expect(ids(result, '2026-10-10')).toEqual([['comboni', 'memorial', false]]);
    expect(celebration(result, '2026-10-10', 'comboni')).toMatchObject({
      precedence: 'PROPER_MEMORIAL_11B',
      weekdayId: 'ot-27-sat',
    });
    expect(result.events).toEqual([
      { id: 'bvm-saturday', outcome: 'displaced', date: '2026-10-10' },
      { id: 'comboni', outcome: 'added', date: '2026-10-10' },
    ]);
  });

  it('an optional memorial yields to an obligatory memorial', () => {
    const { days, base } = setup(
      { '2026-06-03': [memorial('lwanga', 'ot-9-wed')] },
      { '2026-06-03': weekday('ot-9-wed') },
    );
    const result = applyOverrides(days, overrides(add('x', '06-03', 'optional-memorial')), base);
    expect(ids(result, '2026-06-03')).toEqual([['lwanga', 'memorial', false]]);
    expect(result.events).toEqual([{ id: 'x', outcome: 'impeded', date: '2026-06-03' }]);
  });

  it('applies the coinciding-memorials rule when an added memorial meets an obligatory one', () => {
    const { days, base } = setup(
      { '2026-06-03': [memorial('lwanga', 'ot-9-wed')] },
      { '2026-06-03': weekday('ot-9-wed') },
    );
    const result = applyOverrides(days, overrides(add('x', '06-03', 'memorial')), base);
    expect(ids(result, '2026-06-03')).toEqual([
      ['ot-9-wed', 'weekday', false],
      ['lwanga', 'optional-memorial', true],
      ['x', 'optional-memorial', true],
    ]);
    // Demoted memorials get the optional-memorial precedence (level 12).
    expect(celebration(result, '2026-06-03', 'lwanga')).toMatchObject({
      precedence: 'OPTIONAL_MEMORIAL_12',
      weekdayId: 'ot-9-wed',
    });
    expect(celebration(result, '2026-06-03', 'x').precedence).toBe('OPTIONAL_MEMORIAL_12');
    expect(result.events.map((e) => e.outcome)).toEqual(['demoted', 'demoted']);
  });

  it('joins memorials already demoted by the coinciding rule', () => {
    const { days, base } = setup({
      '2026-06-13': [
        weekday('ot-10-sat'),
        cel('immaculate-heart', 'optional-memorial', 'GENERAL_MEMORIAL_10', { optional: true }),
        cel('anthony', 'optional-memorial', 'GENERAL_MEMORIAL_10', { optional: true }),
      ],
    });
    const result = applyOverrides(days, overrides(add('x', '06-13', 'memorial')), base);
    expect(ids(result, '2026-06-13')).toEqual([
      ['ot-10-sat', 'weekday', false],
      ['immaculate-heart', 'optional-memorial', true],
      ['anthony', 'optional-memorial', true],
      ['x', 'optional-memorial', true],
    ]);
  });

  it('throws when a memorial must be demoted but the day has no Proper of Time day', () => {
    const { days } = setup({ '2026-06-03': [memorial('lwanga')] });
    expect(() => applyOverrides(days, overrides(add('x', '06-03', 'memorial')), { baseDay: () => undefined })).toThrow(
      'No Proper of Time day under x on 2026-06-03',
    );
  });

  it('a memorial on a privileged weekday (Lent) is a commemoration in the weekday colour', () => {
    const { days, base } = setup({ '2026-02-26': [lentWeekday('lent-1-thu')] });
    const result = applyOverrides(days, overrides(add('alexander', '02-26', 'memorial')), base);
    expect(ids(result, '2026-02-26')).toEqual([
      ['lent-1-thu', 'weekday', false],
      ['alexander', 'commemoration', true],
    ]);
    expect(celebration(result, '2026-02-26', 'alexander')).toMatchObject({
      colour: 'violet',
      colours: ['violet'],
      weekdayId: 'lent-1-thu',
    });
    expect(result.events).toEqual([{ id: 'alexander', outcome: 'commemorated', date: '2026-02-26' }]);
  });

  it('memorials and feasts colliding with a Sunday are omitted', () => {
    const { days, base } = setup({ '2026-10-11': [otSunday('ot-28-sun')] });
    const result = applyOverrides(
      days,
      overrides(add('m', '10-11', 'memorial'), add('o', '10-11', 'optional-memorial'), add('f', '10-11', 'feast')),
      base,
    );
    expect(ids(result, '2026-10-11')).toEqual([['ot-28-sun', 'sunday', false]]);
    expect(result.events.map((e) => [e.id, e.outcome])).toEqual([
      ['f', 'impeded'],
      ['m', 'impeded'],
      ['o', 'impeded'],
    ]);
  });

  it('a memorial colliding with a solemnity is omitted', () => {
    const { days, base } = setup({ '2026-03-19': [cel('joseph', 'solemnity', 'GENERAL_SOLEMNITY_3')] });
    const result = applyOverrides(days, overrides(add('m', '03-19', 'memorial')), base);
    expect(ids(result, '2026-03-19')).toEqual([['joseph', 'solemnity', false]]);
    expect(result.events).toEqual([{ id: 'm', outcome: 'impeded', date: '2026-03-19' }]);
  });

  it('a feast colliding with a solemnity is omitted', () => {
    const { days, base } = setup({ '2026-03-19': [cel('joseph', 'solemnity', 'GENERAL_SOLEMNITY_3')] });
    const result = applyOverrides(days, overrides(add('f', '03-19', 'feast')), base);
    expect(ids(result, '2026-03-19')).toEqual([['joseph', 'solemnity', false]]);
    expect(result.events).toEqual([{ id: 'f', outcome: 'impeded', date: '2026-03-19' }]);
  });

  it('a feast takes a weekday, displacing its memorial and options, and keeps the weekday id', () => {
    const { days, base } = setup(
      { '2026-04-30': [memorial('m', 'easter-4-thu'), option('o', 'easter-4-thu')] },
      { '2026-04-30': weekday('easter-4-thu', 'white') },
    );
    const result = applyOverrides(days, overrides(add('africa', '04-30', 'feast')), base);
    expect(ids(result, '2026-04-30')).toEqual([['africa', 'feast', false]]);
    expect(celebration(result, '2026-04-30', 'africa')).toMatchObject({
      precedence: 'PROPER_FEAST_8F',
      weekdayId: 'easter-4-thu',
    });
    expect(result.events.map((e) => [e.id, e.outcome])).toEqual([
      ['m', 'displaced'],
      ['o', 'displaced'],
      ['africa', 'added'],
    ]);
  });

  it('a feast beats a privileged weekday', () => {
    const { days, base } = setup({ '2026-03-03': [lentWeekday('lent-2-tue')] });
    const result = applyOverrides(days, overrides(add('f', '03-03', 'feast')), base);
    expect(ids(result, '2026-03-03')).toEqual([['f', 'feast', false]]);
    expect(celebration(result, '2026-03-03', 'f').weekdayId).toBe('lent-2-tue');
  });

  it('a solemnity takes an Ordinary Time Sunday', () => {
    const { days, base } = setup({ '2026-10-11': [otSunday('ot-28-sun')] });
    const result = applyOverrides(days, overrides(add('patron', '10-11', 'solemnity')), base);
    expect(ids(result, '2026-10-11')).toEqual([['patron', 'solemnity', false]]);
    expect(celebration(result, '2026-10-11', 'patron')).toMatchObject({
      precedence: 'PROPER_SOLEMNITY__PRINCIPAL_PATRON_4A',
      weekdayId: 'ot-28-sun',
    });
    expect(result.events).toEqual([{ id: 'patron', outcome: 'added', date: '2026-10-11' }]);
  });

  it('a solemnity impeded by a Sunday of Lent moves to the next day outside levels 1-8', () => {
    const { days, base } = setup({
      '2026-03-22': [lentSunday('lent-5-sun')],
      '2026-03-23': [cel('other-solemnity', 'solemnity', 'GENERAL_SOLEMNITY_3')],
      '2026-03-24': [lentWeekday('lent-5-tue'), cel('c', 'commemoration', 'OPTIONAL_MEMORIAL_12')],
    });
    const result = applyOverrides(days, overrides(add('patron', '03-22', 'solemnity')), base);
    expect(ids(result, '2026-03-22')).toEqual([['lent-5-sun', 'sunday', false]]);
    expect(ids(result, '2026-03-23')).toEqual([['other-solemnity', 'solemnity', false]]);
    expect(ids(result, '2026-03-24')).toEqual([['patron', 'solemnity', false]]);
    expect(result.events).toEqual([
      { id: 'patron', outcome: 'transferred', date: '2026-03-24' },
      { id: 'c', outcome: 'displaced', date: '2026-03-24' },
      { id: 'patron', outcome: 'added', date: '2026-03-24' },
    ]);
  });

  it('fails loudly when a solemnity has no free day left in the year', () => {
    const { days, base } = setup({
      '2026-12-30': [cel('solemnity-a', 'solemnity', 'GENERAL_SOLEMNITY_3')],
      '2026-12-31': [cel('solemnity-b', 'solemnity', 'GENERAL_SOLEMNITY_3')],
    });
    expect(() => applyOverrides(days, overrides(add('patron', '12-30', 'solemnity')), base)).toThrow(
      'patron: the solemnity impeded on 2026-12-30 has no free day left in 2026; transfers into the next year are not supported',
    );
  });

  it('places higher-ranked celebrations first, so a memorial meets the feast added the same day', () => {
    const { days, base } = setup({ '2026-05-05': [weekday('easter-5-tue', 'white')] });
    const result = applyOverrides(days, overrides(add('m', '05-05', 'memorial'), add('f', '05-05', 'feast')), base);
    expect(ids(result, '2026-05-05')).toEqual([['f', 'feast', false]]);
    expect(result.events.map((e) => [e.id, e.outcome])).toEqual([
      ['f', 'added'],
      ['m', 'impeded'],
    ]);
  });

  it('skips a 29 February entry in a common year', () => {
    const { days, base } = setup({ '2026-02-28': [weekday('w')] });
    const result = applyOverrides(days, overrides(add('leap', '02-29', 'optional-memorial')), base);
    expect(result.events).toEqual([{ id: 'leap', outcome: 'skipped', date: '2026-02-29' }]);
  });

  it('a day without any obligatory celebration accepts a memorial', () => {
    const { days, base } = setup({ '2026-05-06': [option('o')] }, { '2026-05-06': weekday('w') });
    const result = applyOverrides(days, overrides(add('m', '05-06', 'memorial')), base);
    expect(ids(result, '2026-05-06')).toEqual([['m', 'memorial', false]]);
    expect(celebration(result, '2026-05-06', 'm').weekdayId).toBe('w');
  });

  it('takes a day without a weekday id when there is no base day', () => {
    const { days } = setup({ '2026-05-06': [option('o')] });
    const result = applyOverrides(days, overrides(add('m', '05-06', 'memorial')), { baseDay: () => undefined });
    expect(celebration(result, '2026-05-06', 'm').weekdayId).toBeUndefined();
  });
});

describe('applyOverrides: remove', () => {
  const remove = (id: string): OverrideEntry => ({ action: 'remove', id, source, confidence: 'probable' });

  it('removes an obligatory memorial and restores the weekday', () => {
    const { days, base } = setup(
      { '2026-06-03': [memorial('lwanga', 'ot-9-wed')] },
      { '2026-06-03': weekday('ot-9-wed') },
    );
    const result = applyOverrides(days, overrides(remove('lwanga')), base);
    expect(ids(result, '2026-06-03')).toEqual([['ot-9-wed', 'weekday', false]]);
    expect(result.events).toEqual([{ id: 'lwanga', outcome: 'removed', date: '2026-06-03' }]);
  });

  it('removes an optional memorial and leaves the day', () => {
    const { days, base } = setup({ '2026-07-28': [weekday('w'), option('o', 'w')] });
    const result = applyOverrides(days, overrides(remove('o')), base);
    expect(ids(result, '2026-07-28')).toEqual([['w', 'weekday', false]]);
  });

  it('keeps a day with two obligatory celebrations in precedence order', () => {
    const { days, base } = setup({
      '2026-04-02': [
        lentWeekday('lent-weekday'),
        cel('lords-supper', 'weekday', 'TRIDUUM_1'),
        cel('o', 'commemoration', 'OPTIONAL_MEMORIAL_12'),
      ],
    });
    const result = applyOverrides(days, overrides(remove('o')), base);
    expect(ids(result, '2026-04-02')).toEqual([
      ['lords-supper', 'weekday', false],
      ['lent-weekday', 'weekday', false],
    ]);
  });

  it('removing one of two coinciding memorials restores the other as obligatory', () => {
    const { days, base } = setup({
      '2026-06-13': [
        weekday('ot-10-sat'),
        cel('immaculate-heart', 'optional-memorial', 'GENERAL_MEMORIAL_10', { weekdayId: 'ot-10-sat' }),
        cel('anthony', 'optional-memorial', 'GENERAL_MEMORIAL_10', { weekdayId: 'ot-10-sat' }),
      ],
    });
    const result = applyOverrides(days, overrides(remove('anthony')), base);
    expect(ids(result, '2026-06-13')).toEqual([['immaculate-heart', 'memorial', false]]);
    expect(celebration(result, '2026-06-13', 'immaculate-heart')).toMatchObject({
      precedence: 'GENERAL_MEMORIAL_10',
      weekdayId: 'ot-10-sat',
    });
    expect(result.events).toEqual([
      { id: 'immaculate-heart', outcome: 'restored', date: '2026-06-13' },
      { id: 'anthony', outcome: 'removed', date: '2026-06-13' },
    ]);
  });

  it('reports an id that is not in the year', () => {
    const { days, base } = setup({ '2026-06-03': [weekday('w')] });
    const result = applyOverrides(days, overrides(remove('absent')), base);
    expect(result.events).toEqual([{ id: 'absent', outcome: 'not-found' }]);
    expect(result.days).toEqual(days);
  });

  it('refuses to remove a day of the Proper of Time', () => {
    const { days, base } = setup({ '2026-06-03': [weekday('w')] });
    expect(() => applyOverrides(days, overrides(remove('w')), base)).toThrow(
      'w on 2026-06-03 is a day of the Proper of Time; overrides change celebrations only',
    );
  });

  it('throws when the removed celebration leaves the day empty and there is no base day', () => {
    const { days } = setup({ '2026-06-03': [memorial('lwanga')] });
    expect(() => applyOverrides(days, overrides(remove('lwanga')), { baseDay: () => undefined })).toThrow(
      'No Proper of Time day under lwanga on 2026-06-03',
    );
  });

  it('keeps the other obligatory celebration when the removed one was first (Holy Thursday style)', () => {
    const { days, base } = setup({
      '2026-04-02': [cel('feast-x', 'feast', 'PROPER_FEAST_8F'), lentWeekday('lent-weekday')],
    });
    const result = applyOverrides(days, overrides(remove('feast-x')), base);
    expect(ids(result, '2026-04-02')).toEqual([['lent-weekday', 'weekday', false]]);
  });
});

describe('applyOverrides: rank change', () => {
  const rank = (
    id: string,
    newRank: Extract<OverrideEntry, { action: 'rank' }>['rank'],
    colours?: Extract<OverrideEntry, { action: 'rank' }>['colours'],
  ): OverrideEntry => ({
    action: 'rank',
    id,
    rank: newRank,
    ...(colours ? { colours } : {}),
    source,
    confidence: 'probable',
  });

  it('raises a memorial to a proper feast on its own day', () => {
    const { days, base } = setup(
      { '2026-06-03': [cel('lwanga', 'memorial', 'GENERAL_MEMORIAL_10', { colours: ['red'], weekdayId: 'w' })] },
      { '2026-06-03': weekday('w') },
    );
    const result = applyOverrides(days, overrides(rank('lwanga', 'feast')), base);
    expect(ids(result, '2026-06-03')).toEqual([['lwanga', 'feast', false]]);
    expect(celebration(result, '2026-06-03', 'lwanga')).toMatchObject({
      precedence: 'PROPER_FEAST_8F',
      colour: 'red',
      weekdayId: 'w',
    });
  });

  it('lowers a memorial to an optional memorial', () => {
    const { days, base } = setup({ '2026-06-03': [memorial('lwanga', 'w')] }, { '2026-06-03': weekday('w') });
    const result = applyOverrides(days, overrides(rank('lwanga', 'optional-memorial')), base);
    expect(ids(result, '2026-06-03')).toEqual([
      ['w', 'weekday', false],
      ['lwanga', 'optional-memorial', true],
    ]);
    expect(celebration(result, '2026-06-03', 'lwanga').precedence).toBe('OPTIONAL_MEMORIAL_12');
  });

  it('a commemoration raised to a feast takes the day with the colours given', () => {
    const { days, base } = setup({
      '2026-03-07': [
        lentWeekday('lent-2-sat'),
        cel('perpetua', 'commemoration', 'GENERAL_MEMORIAL_10', { colours: ['violet'], weekdayId: 'lent-2-sat' }),
      ],
    });
    const result = applyOverrides(days, overrides(rank('perpetua', 'feast', ['red'])), base);
    expect(ids(result, '2026-03-07')).toEqual([['perpetua', 'feast', false]]);
    expect(celebration(result, '2026-03-07', 'perpetua')).toMatchObject({ colour: 'red', colours: ['red'] });
  });
});

describe('applyOverrides: move', () => {
  const move = (
    id: string,
    date: string,
    colours?: Extract<OverrideEntry, { action: 'move' }>['colours'],
  ): OverrideEntry => ({ action: 'move', id, date, ...(colours ? { colours } : {}), source, confidence: 'probable' });

  it('moves an optional memorial before a feast is added on its old date', () => {
    const { days, base } = setup({
      '2026-04-28': [weekday('easter-4-tue', 'white')],
      '2026-04-30': [weekday('easter-4-thu', 'white'), option('pius-v', 'easter-4-thu')],
    });
    const result = applyOverrides(days, overrides(add('africa', '04-30', 'feast'), move('pius-v', '04-28')), base);
    expect(ids(result, '2026-04-28')).toEqual([
      ['easter-4-tue', 'weekday', false],
      ['pius-v', 'optional-memorial', true],
    ]);
    expect(celebration(result, '2026-04-28', 'pius-v').weekdayId).toBe('easter-4-tue');
    expect(ids(result, '2026-04-30')).toEqual([['africa', 'feast', false]]);
  });

  it('moves an obligatory memorial, keeping its precedence, and restores the weekday it leaves', () => {
    const { days, base } = setup(
      { '2026-06-03': [memorial('lwanga', 'ot-9-wed')], '2026-06-04': [weekday('ot-9-thu')] },
      { '2026-06-03': weekday('ot-9-wed') },
    );
    const result = applyOverrides(days, overrides(move('lwanga', '06-04')), base);
    expect(ids(result, '2026-06-03')).toEqual([['ot-9-wed', 'weekday', false]]);
    expect(ids(result, '2026-06-04')).toEqual([['lwanga', 'memorial', false]]);
    expect(celebration(result, '2026-06-04', 'lwanga')).toMatchObject({
      precedence: 'GENERAL_MEMORIAL_10',
      weekdayId: 'ot-9-thu',
    });
  });

  it('a commemoration or demoted memorial moved out of the way gets its own rank back', () => {
    const { days, base } = setup({
      '2026-03-07': [
        lentWeekday('lent-2-sat'),
        cel('perpetua', 'commemoration', 'GENERAL_MEMORIAL_10', { colours: ['violet'] }),
        cel('canisius', 'commemoration', 'OPTIONAL_MEMORIAL_12', { colours: ['violet'] }),
      ],
      '2026-06-13': [
        weekday('ot-10-sat'),
        cel('immaculate-heart', 'optional-memorial', 'GENERAL_MEMORIAL_10'),
        cel('anthony', 'optional-memorial', 'GENERAL_MEMORIAL_10'),
      ],
      '2026-06-15': [weekday('ot-11-mon')],
      '2026-06-16': [weekday('ot-11-tue')],
      '2026-06-17': [weekday('ot-11-wed')],
    });
    const result = applyOverrides(
      days,
      overrides(move('perpetua', '06-15', ['red']), move('canisius', '06-16'), move('anthony', '06-17')),
      base,
    );
    expect(ids(result, '2026-06-15')).toEqual([['perpetua', 'memorial', false]]);
    expect(celebration(result, '2026-06-15', 'perpetua').colour).toBe('red');
    expect(ids(result, '2026-06-16')).toEqual([
      ['ot-11-tue', 'weekday', false],
      ['canisius', 'optional-memorial', true],
    ]);
    expect(ids(result, '2026-06-17')).toEqual([['anthony', 'memorial', false]]);
    expect(ids(result, '2026-06-13')).toEqual([['immaculate-heart', 'memorial', false]]);
  });

  it('reports a celebration romcal did not produce that year', () => {
    const { days, base } = setup({ '2026-04-28': [weekday('w')] });
    const result = applyOverrides(days, overrides(move('pius-v', '04-28')), base);
    expect(result.events).toEqual([{ id: 'pius-v', outcome: 'not-found' }]);
  });
});

describe('applyOverrides: general', () => {
  it('gives memorials demoted by romcal mapping the optional-memorial precedence', () => {
    const { days, base } = setup({
      '2026-06-13': [weekday('w'), cel('a', 'optional-memorial', 'GENERAL_MEMORIAL_10')],
    });
    const result = applyOverrides(days, overrides(), base);
    expect(celebration(result, '2026-06-13', 'a').precedence).toBe('OPTIONAL_MEMORIAL_12');
    expect(result.events).toEqual([]);
  });

  it('does not modify its input', () => {
    const { days, base } = setup({ '2026-06-03': [memorial('lwanga', 'w')] }, { '2026-06-03': weekday('w') });
    const snapshot = structuredClone(days);
    applyOverrides(days, overrides(add('x', '06-03', 'memorial')), base);
    expect(days).toEqual(snapshot);
  });

  it('accepts an empty year', () => {
    expect(applyOverrides([], overrides(add('x', '06-03', 'memorial')), { baseDay: () => undefined })).toEqual({
      days: [],
      events: [{ id: 'x', outcome: 'skipped', date: '-06-03' }],
    });
  });
});

describe('applyOverrides: celebrations romcal left out of the year', () => {
  const lwangaDefinition = {
    celebration: cel('lwanga', 'memorial', 'GENERAL_MEMORIAL_10', { colours: ['red'] }),
    date: '2029-06-03',
  };
  const piusDefinition = { celebration: option('pius-v'), date: '2028-04-30' };
  const definition = (id: string) =>
    ({ lwanga: lwangaDefinition, 'pius-v': piusDefinition })[id as 'lwanga' | 'pius-v'];

  it("moves an impeded optional memorial using romcal's definition", () => {
    const { days, base } = setup({
      '2028-04-28': [weekday('easter-3-fri', 'white')],
      '2028-04-30': [cel('easter-3-sun', 'sunday', 'PRIVILEGED_SUNDAY_2')],
    });
    const move: OverrideEntry = { action: 'move', id: 'pius-v', date: '04-28', source, confidence: 'probable' };
    const result = applyOverrides(days, overrides(move), { ...base, definition });
    expect(ids(result, '2028-04-28')).toEqual([
      ['easter-3-fri', 'weekday', false],
      ['pius-v', 'optional-memorial', true],
    ]);
    expect(result.events).toEqual([
      { id: 'pius-v', outcome: 'rebuilt', date: '2028-04-30' },
      { id: 'pius-v', outcome: 'added', date: '2028-04-28' },
    ]);
  });

  it('a memorial raised to a solemnity on a Sunday solemnity moves to Monday (UNLY 60)', () => {
    const { days, base } = setup({
      '2029-06-03': [cel('corpus-christi', 'solemnity', 'GENERAL_SOLEMNITY_3')],
      '2029-06-04': [weekday('ot-9-mon')],
    });
    const rank: OverrideEntry = { action: 'rank', id: 'lwanga', rank: 'solemnity', source, confidence: 'probable' };
    const result = applyOverrides(days, overrides(rank), { ...base, definition });
    expect(ids(result, '2029-06-03')).toEqual([['corpus-christi', 'solemnity', false]]);
    expect(ids(result, '2029-06-04')).toEqual([['lwanga', 'solemnity', false]]);
    expect(celebration(result, '2029-06-04', 'lwanga')).toMatchObject({ colour: 'red', weekdayId: 'ot-9-mon' });
    expect(result.events.map((e) => [e.outcome, e.date])).toEqual([
      ['rebuilt', '2029-06-03'],
      ['transferred', '2029-06-04'],
      ['added', '2029-06-04'],
    ]);
  });

  it('uses the entry fallback when romcal has no definition', () => {
    const { days, base } = setup({
      '2026-06-03': [otSunday('ot-9-sun')],
      '2026-06-04': [weekday('ot-9-mon')],
    });
    const rank: OverrideEntry = {
      action: 'rank',
      id: 'local-saint',
      rank: 'solemnity',
      fallback: { name: 'Saint Local', rank: 'memorial', colours: ['red'], date: '06-03' },
      source,
      confidence: 'probable',
    };
    const result = applyOverrides(days, overrides(rank), base);
    expect(ids(result, '2026-06-03')).toEqual([['local-saint', 'solemnity', false]]);
    expect(celebration(result, '2026-06-03', 'local-saint')).toMatchObject({
      name: 'Saint Local',
      colour: 'red',
      romcalId: '',
      precedence: 'PROPER_SOLEMNITY__PRINCIPAL_PATRON_4A',
    });
  });

  it('a moved fallback keeps its general rank', () => {
    const { days, base } = setup({ '2026-06-04': [weekday('ot-9-mon')] });
    const move: OverrideEntry = {
      action: 'move',
      id: 'local-saint',
      date: '06-04',
      fallback: { name: 'Saint Local', rank: 'optional-memorial', colours: ['white'], date: '06-03' },
      source,
      confidence: 'probable',
    };
    const result = applyOverrides(days, overrides(move), base);
    expect(ids(result, '2026-06-04')).toEqual([
      ['ot-9-mon', 'weekday', false],
      ['local-saint', 'optional-memorial', true],
    ]);
    expect(celebration(result, '2026-06-04', 'local-saint').precedence).toBe('OPTIONAL_MEMORIAL_12');
  });

  it('removing a celebration romcal left out is reported as absent', () => {
    const { days, base } = setup({ '2029-06-04': [weekday('w')] });
    const remove: OverrideEntry = { action: 'remove', id: 'lwanga', source, confidence: 'probable' };
    const result = applyOverrides(days, overrides(remove), { ...base, definition });
    expect(result.events).toEqual([{ id: 'lwanga', outcome: 'absent' }]);
  });

  it('removing an obligatory memorial restores the optional memorials romcal suppressed under it', () => {
    const { days, base } = setup(
      { '2029-06-09': [memorial('immaculate-heart', 'ot-9-sat')] },
      { '2029-06-09': weekday('ot-9-sat') },
    );
    const remove: OverrideEntry = { action: 'remove', id: 'immaculate-heart', source, confidence: 'probable' };
    const suppressed = (date: string) =>
      date === '2029-06-09' ? [option('ephrem', 'stale'), weekday('ot-9-sat')] : [];
    const result = applyOverrides(days, overrides(remove), { ...base, suppressed });
    expect(ids(result, '2029-06-09')).toEqual([
      ['ot-9-sat', 'weekday', false],
      ['ephrem', 'optional-memorial', true],
    ]);
    expect(celebration(result, '2029-06-09', 'ephrem').weekdayId).toBe('ot-9-sat');
  });

  it('moves run before additions, so an added memorial meets the day the move left', () => {
    const { days, base } = setup(
      {
        '2026-06-03': [memorial('lwanga', 'ot-9-wed')],
        '2026-06-04': [weekday('ot-9-thu')],
      },
      { '2026-06-03': weekday('ot-9-wed') },
    );
    const result = applyOverrides(
      days,
      overrides(add('x', '06-03', 'memorial'), {
        action: 'move',
        id: 'lwanga',
        date: '06-04',
        source,
        confidence: 'probable',
      }),
      base,
    );
    // The move runs first, so x meets an empty day and takes it.
    expect(ids(result, '2026-06-03')).toEqual([['x', 'memorial', false]]);
    expect(ids(result, '2026-06-04')).toEqual([['lwanga', 'memorial', false]]);
  });
});
