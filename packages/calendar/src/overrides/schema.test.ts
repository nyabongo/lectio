import { describe, expect, it } from 'vitest';

import * as overridesModule from './index.ts';
import { OverridesError, isMonthDay, parseOverrides, pendingSignOff } from './schema.ts';
import type { RegionalOverrides } from './schema.ts';

const source = { title: 'Test source', url: 'https://example.org/ordo', accessed: '2026-10-05' };

function valid(): Record<string, unknown> {
  return {
    region: 'test',
    description: 'Test overrides',
    transfers: {
      epiphanyOnSunday: { value: true, source, confidence: 'confirmed' },
      ascensionOnSunday: { value: true, source, confidence: 'probable', notes: 'Seen on a secondary source.' },
    },
    entries: [
      {
        action: 'add',
        id: 'our-lady-mother-of-africa',
        name: 'Our Lady Mother of Africa',
        date: '04-30',
        rank: 'feast',
        colours: ['white'],
        holyDayOfObligation: false,
        source,
        confidence: 'uncertain',
      },
      { action: 'remove', id: 'some-memorial', source, confidence: 'confirmed' },
      { action: 'rank', id: 'charles-lwanga', rank: 'feast', colours: ['red'], source, confidence: 'probable' },
      { action: 'move', id: 'pius-v-pope', date: '04-28', source, confidence: 'probable' },
    ],
  };
}

function problems(value: unknown): readonly string[] {
  try {
    parseOverrides(value);
  } catch (error) {
    if (error instanceof OverridesError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseOverrides', () => {
  it('accepts every action and the transfer flags', () => {
    const parsed = parseOverrides(valid());
    expect(parsed.entries.map((e) => e.action)).toEqual(['add', 'remove', 'rank', 'move']);
    expect(parsed.transfers.epiphanyOnSunday?.value).toBe(true);
  });

  it('requires a source and a confidence on every entry and transfer', () => {
    const value = valid();
    const entries = value['entries'] as Record<string, unknown>[];
    delete entries[1]?.['source'];
    delete entries[2]?.['confidence'];
    const transfers = value['transfers'] as Record<string, Record<string, unknown>>;
    delete transfers['epiphanyOnSunday']?.['source'];
    expect(problems(value).length).toBeGreaterThan(0);
    expect(problems(value).join('\n')).toContain("must have required property 'source'");
  });

  it('requires the source to be cited with a title, an http(s) url and an access date', () => {
    const value = valid();
    const entries = value['entries'] as Record<string, unknown>[];
    (entries[0] as Record<string, unknown>)['source'] = {
      title: 'x',
      url: 'ftp://example.org',
      accessed: '2026-13-01',
    };
    expect(problems(value).length).toBeGreaterThan(0);
  });

  it('rejects unknown actions, ranks, colours, flags and properties', () => {
    for (const mutate of [
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[1] = { action: 'rename' }),
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[2]!['rank'] = 'commemoration'),
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[0]!['colours'] = ['blue']),
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[0]!['colours'] = []),
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[1]!['date'] = '01-01'),
      (v: Record<string, unknown>) => ((v['transfers'] as Record<string, unknown>)['pentecostOnMonday'] = {}),
      (v: Record<string, unknown>) => (v['extra'] = true),
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[3]!['date'] = '4-28'),
      (v: Record<string, unknown>) => ((v['entries'] as Record<string, unknown>[])[0]!['id'] = 'Not A Slug'),
    ]) {
      const value = valid();
      mutate(value);
      expect(problems(value).length).toBeGreaterThan(0);
    }
  });

  it('rejects a date that does not exist and two entries for one id', () => {
    const value = valid();
    const entries = value['entries'] as Record<string, unknown>[];
    entries[0]!['date'] = '02-30';
    entries[3]!['date'] = '04-31';
    entries.push({ action: 'remove', id: 'pius-v-pope', source, confidence: 'probable' });
    expect(problems(value)).toEqual([
      '/entries/0/date 02-30 is not a day of the year',
      '/entries/3/date 04-31 is not a day of the year',
      '/entries/4 more than one entry for pius-v-pope',
    ]);
  });

  it('describes every problem in the error message', () => {
    expect(() => parseOverrides({})).toThrow(/Invalid regional overrides:\n {2}\/ must have required property/);
    expect(() => parseOverrides({})).toThrow(OverridesError);
  });
});

describe('isMonthDay', () => {
  it('accepts real days, including 29 February', () => {
    expect(isMonthDay('02-29')).toBe(true);
    expect(isMonthDay('12-31')).toBe(true);
    expect(isMonthDay('06-31')).toBe(false);
  });
});

describe('pendingSignOff', () => {
  it('lists every transfer and entry that is not confirmed', () => {
    expect(pendingSignOff(parseOverrides(valid()) as RegionalOverrides)).toEqual([
      'transfer ascensionOnSunday',
      'add our-lady-mother-of-africa',
      'rank charles-lwanga',
      'move pius-v-pope',
    ]);
  });
});

describe('overrides index', () => {
  it('re-exports the public API', () => {
    expect(Object.keys(overridesModule).sort()).toEqual(
      [
        'CONFIDENCE_LEVELS',
        'OVERRIDE_ACTIONS',
        'OVERRIDE_RANKS',
        'OverridesError',
        'PROPER_PRECEDENCE',
        'TRANSFER_FLAGS',
        'addedCelebration',
        'applyOverrides',
        'baseDays',
        'generateRegionalDays',
        'isMonthDay',
        'loadOverrides',
        'overridesPath',
        'parseOverrides',
        'pendingSignOff',
        'regionalOverridesSchema',
        'transferOptions',
      ].sort(),
    );
  });
});
