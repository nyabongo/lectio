import { stripVrs } from './vrs.ts';

/**
 * The versification files Lectio embeds, by the name used in
 * `__generated__/vrs-data.ts`, and their file names in packages/refs/data.
 */
export const VRS_FILES = {
  org: 'org.vrs',
  vul: 'vul.vrs',
  lxx: 'lxx.vrs',
  eng: 'eng.vrs',
  vulSupplement: 'vul.supplement.vrs',
  lxxSupplement: 'lxx.supplement.vrs',
  engSupplement: 'eng.supplement.vrs',
} as const;

export type VrsName = keyof typeof VRS_FILES;

/**
 * Renders `__generated__/vrs-data.ts` from the texts of the files in
 * packages/refs/data, comments stripped. The module is plain data so the
 * package works in the browser without reading files at run time;
 * `embed.test.ts` fails when it drifts from the data files and rewrites it
 * when run with `UPDATE_VERSIFICATION=1`.
 */
export function renderVrsModule(texts: Readonly<Record<VrsName, string>>): string {
  const entries = (Object.keys(VRS_FILES) as VrsName[]).map((name) => {
    const body = stripVrs(texts[name]);
    if (/[`\\]|\$\{/.test(body)) throw new Error(`${VRS_FILES[name]} contains characters that cannot be embedded`);
    return `  ${name}: \`\n${body}\n\`,`;
  });
  return [
    '// Generated from packages/refs/data/*.vrs by packages/refs/src/versification/embed.test.ts. Do not edit:',
    '// change the data files and run `UPDATE_VERSIFICATION=1 npx vitest run packages/refs/src/versification/embed.test.ts`.',
    '// org/vul/lxx/eng: libpalaso, Copyright (c) 2007-2025 SIL Global, MIT licence (packages/refs/data/SOURCE.json).',
    '// *Supplement: maintained by Lectio.',
    'export const VRS_DATA = {',
    ...entries,
    '} as const;',
    '',
  ].join('\n');
}
