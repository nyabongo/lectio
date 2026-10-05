/**
 * JSON text for a content file, laid out the way Prettier (the repo's `format:check`) prints it,
 * so a research PR never fails formatting. The research package does not depend on Prettier, so
 * this reproduces the subset of its JSON layout that passage files use:
 *
 * - two-space indent, one key per line, a final newline;
 * - a non-empty object is always expanded (Prettier keeps an object expanded once it is);
 * - an array goes on one line when it fits in the print width (trailing comma included) and holds
 *   no non-empty object, otherwise one element per line; an array of two or more arrays that each
 *   have two or more elements always breaks, as in Prettier; a broken array of numbers puts as many
 *   per line as fit (Prettier's `fill`).
 *
 * Strings are printed as `JSON.stringify` writes them. The test file checks the output against
 * Prettier itself.
 */

/** Prettier's `printWidth` in `.prettierrc`. */
export const PRINT_WIDTH = 120;

/** Display width as Prettier measures it: combining accents count 0, wide East Asian characters and emoji 2. */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text.replace(/\p{Extended_Pictographic}️?/gu, '  ')) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x300 && code <= 0x36f)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

function isWide(code: number): boolean {
  return WIDE_RANGES.some(([from, to]) => code >= from && code <= to);
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json | undefined };

const isObject = (value: Json): value is { readonly [key: string]: Json | undefined } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The one-line form of a value, or `null` when it must span lines. */
function flat(value: Json): string | null {
  if (Array.isArray(value)) {
    const items = (value as readonly Json[]).map(flat);
    return items.every((item) => item !== null) ? `[${items.join(', ')}]` : null;
  }
  if (isObject(value)) return entries(value).length === 0 ? '{}' : null;
  return JSON.stringify(value);
}

function entries(value: { readonly [key: string]: Json | undefined }): [string, Json][] {
  return Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined);
}

function mustBreak(value: readonly Json[]): boolean {
  return value.length > 1 && value.every((item) => Array.isArray(item) && item.length > 1);
}

/** A broken array of numbers: as many per line as fit, as Prettier's `fill`. */
function fill(numbers: readonly number[], indent: string): string {
  const lines: string[] = [];
  let line = '';
  numbers.forEach((n, index) => {
    const piece = `${JSON.stringify(n)}${index < numbers.length - 1 ? ',' : ''}`;
    if (line !== '' && textWidth(`${line} ${piece}`) <= PRINT_WIDTH) line = `${line} ${piece}`;
    else {
      if (line !== '') lines.push(line);
      line = `${indent}${piece}`;
    }
  });
  return [...lines, line].join('\n');
}

/** `value` printed after `prefix` (indent plus key) and followed by `suffix` (a comma or nothing). */
function print(value: Json, indent: string, prefix: string, suffix: string): string {
  if (Array.isArray(value) || isObject(value)) {
    const list: [string, Json][] = Array.isArray(value)
      ? (value as readonly Json[]).map((item) => ['', item])
      : entries(value as { readonly [key: string]: Json | undefined });
    if (list.length === 0) return `${prefix}${Array.isArray(value) ? '[]' : '{}'}${suffix}`;
    if (Array.isArray(value) && !mustBreak(value)) {
      const line = flat(value);
      if (line !== null && textWidth(`${prefix}${line}${suffix}`) <= PRINT_WIDTH) return `${prefix}${line}${suffix}`;
    }
    const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
    const inner = `${indent}  `;
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return `${prefix}[\n${fill(value as readonly number[], inner)}\n${indent}]${suffix}`;
    }
    const lines = list.map(([key, item], index) =>
      print(item, inner, `${inner}${key === '' ? '' : `${JSON.stringify(key)}: `}`, index < list.length - 1 ? ',' : ''),
    );
    return `${prefix}${open}\n${lines.join('\n')}\n${indent}${close}${suffix}`;
  }
  return `${prefix}${JSON.stringify(value)}${suffix}`;
}

/** Prettier-compatible JSON text for `value`, ending in a newline. */
export function formatJson(value: unknown): string {
  return `${print(JSON.parse(JSON.stringify(value)) as Json, '', '', '')}\n`;
}
