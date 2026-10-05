import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import { PRINT_WIDTH, formatJson, textWidth } from './format-json.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PASSAGE_DIRS = ['packages/content/src/fixtures/repo/passages', 'packages/research/src/fixtures/repo/passages'];

/** What `prettier --check` would want for a passage file. */
async function prettier(text: string): Promise<string> {
  const filepath = `${REPO_ROOT}passages/X.1.json`;
  const config = await resolveConfig(filepath);
  return format(text, { ...config, filepath });
}

/** A string of `n` characters. */
const chars = (n: number, char = 'a'): string => char.repeat(n);

describe('formatJson', () => {
  it('reproduces the committed passage fixtures byte for byte', () => {
    for (const dir of PASSAGE_DIRS) {
      for (const name of readdirSync(`${REPO_ROOT}${dir}`)) {
        const text = readFileSync(`${REPO_ROOT}${dir}/${name}`, 'utf8');
        expect(formatJson(JSON.parse(text)), `${dir}/${name}`).toBe(text);
      }
    }
  });

  it('prints empty containers, scalars and nested objects', () => {
    expect(formatJson({ a: [], b: {}, c: null, d: true, e: 1.5, f: { g: 'h' }, i: undefined })).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": null,\n  "d": true,\n  "e": 1.5,\n  "f": {\n    "g": "h"\n  }\n}\n',
    );
    expect(formatJson({})).toBe('{}\n');
    expect(formatJson([{}, 1])).toBe('[{}, 1]\n');
  });

  it('breaks an array that holds an object, or two or more multi-element arrays', () => {
    expect(formatJson({ a: [{ b: 1 }] })).toBe('{\n  "a": [\n    {\n      "b": 1\n    }\n  ]\n}\n');
    expect(
      formatJson({
        a: [
          [1, 2],
          [3, 4],
        ],
      }),
    ).toBe('{\n  "a": [\n    [1, 2],\n    [3, 4]\n  ]\n}\n');
    expect(formatJson({ a: [[1], [2]] })).toBe('{\n  "a": [[1], [2]]\n}\n');
  });

  it('measures display width the way Prettier does', () => {
    expect(textWidth('abc')).toBe(3);
    expect(textWidth('ὀφθαλμός')).toBe(8);
    expect(textWidth('é')).toBe(1);
    expect(textWidth('\u0007\u0085x')).toBe(1);
    expect(textWidth('上帝')).toBe(4);
    expect(textWidth('🙏')).toBe(2);
    expect(textWidth('한')).toBe(2);
  });

  // Each case puts an array right at the print-width boundary, so an off-by-one shows up.
  const boundary = (extra: number, char = 'a'): unknown => {
    // `  "k": ["` + body + `"],` is 12 columns plus the body.
    const body = PRINT_WIDTH - 12 + extra;
    return { k: [chars(Math.ceil(body / (char === 'a' ? 1 : 2)), char)], z: 1 };
  };
  const cases: [string, unknown][] = [
    ['fits exactly', boundary(0)],
    ['one column over', boundary(1)],
    ['last key without comma, exactly fitting', { k: [chars(PRINT_WIDTH - 11)] }],
    ['last key without comma, one over', { k: [chars(PRINT_WIDTH - 10)] }],
    ['wide characters', boundary(0, '上')],
    ['wide characters over', boundary(2, '上')],
    ['Greek with accents', { k: [chars(PRINT_WIDTH - 12, 'ά')], z: 1 }],
    ['Hebrew with points', { k: ['בְּרֵאשִׁית'.repeat(10)], z: 1 }],
    [
      'several strings',
      { sourceIds: ['dt-15-9', 'lsj-ophthalmos', 'davies-allison'], deep: { deeper: { list: ['x'] } } },
    ],
    ['many strings over the width', { list: Array.from({ length: 20 }, (_, i) => `source-${String(i)}`) }],
    ['numbers', { n: [1, 2, 3], m: Array.from({ length: 50 }, (_, i) => i) }],
    ['numbers at the boundary', { m: Array.from({ length: 40 }, (_, i) => 100 + i) }],
    ['escapes', { s: ['quote " backslash \\ newline \n tab \t'] }],
  ];

  it.each(cases)('is stable under Prettier: %s', async (_name, value) => {
    const text = formatJson(value);
    expect(await prettier(text)).toBe(text);
  });
});
