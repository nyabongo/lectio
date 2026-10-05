import { describe, expect, it } from 'vitest';

import { parseVrs, sourceKey, stripVrs } from './vrs.ts';

describe('parseVrs', () => {
  const text = [
    '# Versification  "Test"',
    'GEN 1:31 2:25',
    'PSA 1:6 2:12 3:9   ',
    '#! *GEN 1:22,-,a',
    '*JOS 9:2,-,a',
    '-GEN 2:4',
    '-PSA 3:2-3',
    '',
    'PSA 3:0-2 = PSA 3:1-3',
    'GEN 1:31 = GEN 2:1 # trailing comment',
  ].join('\n');

  it('reads book lines, exclusions and mappings', () => {
    const file = parseVrs(text);
    expect([...file.books]).toEqual([
      ['GEN', [31, 25]],
      ['PSA', [6, 12, 9]],
    ]);
    expect([...file.excluded]).toEqual(['GEN 2:4', 'PSA 3:2', 'PSA 3:3']);
    expect(file.skipped).toEqual([]);
  });

  it('expands ranges and drops verse 0', () => {
    expect(parseVrs(text).mappings).toEqual([
      { from: { book: 'PSA', c: 3, v: 1 }, to: { book: 'PSA', c: 3, v: 2 } },
      { from: { book: 'PSA', c: 3, v: 2 }, to: { book: 'PSA', c: 3, v: 3 } },
      { from: { book: 'GEN', c: 1, v: 31 }, to: { book: 'GEN', c: 2, v: 1 } },
    ]);
  });

  it('keeps unreadable lines instead of failing', () => {
    const bad = [
      'DAG 3:52-23 = S3Y 1:30-31',
      'DAG 13:1-63 = SUS 1:63',
      'ESG 1:1 = ESG 1:1a',
      'A = B = C',
      '-GEN',
      '6EZ 1:63 12:78',
      'GEN 1:31',
      'not a line',
    ];
    const file = parseVrs(['GEN 1:31', ...bad].join('\n'));
    expect(file.skipped).toEqual(bad);
    expect(file.mappings).toEqual([]);
    expect(file.books.get('GEN')).toEqual([31]);
  });
});

describe('sourceKey and stripVrs', () => {
  it('formats a verse key', () => {
    expect(sourceKey({ book: 'S3Y', c: 1, v: 29 })).toBe('S3Y 1:29');
  });

  it('drops comment and blank lines and trailing spaces', () => {
    expect(stripVrs('# a\nGEN 1:31  \n\n   # b\nEXO 1:22\n')).toBe('GEN 1:31\nEXO 1:22');
  });
});
