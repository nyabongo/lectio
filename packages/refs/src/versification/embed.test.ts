import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VRS_FILES, renderVrsModule } from './embed.ts';
import type { VrsName } from './embed.ts';

const dataDir = new URL('../../data/', import.meta.url);
const generated = fileURLToPath(new URL('./__generated__/vrs-data.ts', import.meta.url));

const read = (file: string): string => readFileSync(new URL(file, dataDir), 'utf8');
const texts = Object.fromEntries(
  (Object.keys(VRS_FILES) as VrsName[]).map((name) => [name, read(VRS_FILES[name])]),
) as Record<VrsName, string>;

interface SourceFile {
  readonly path: string;
  readonly upstream?: string;
  readonly sha256: string;
}
interface SourceJson {
  readonly sources: readonly { readonly id: string; readonly licence: string; readonly files: readonly SourceFile[] }[];
}

describe('generated versification module', () => {
  it('matches the data files (UPDATE_VERSIFICATION=1 rewrites it)', () => {
    const expected = renderVrsModule(texts);
    if (process.env.UPDATE_VERSIFICATION === '1') writeFileSync(generated, expected);
    expect(readFileSync(generated, 'utf8')).toBe(expected);
  });

  it('drops comments and refuses text that would break the template literal', () => {
    const module = renderVrsModule({ ...texts, org: '# comment\nGEN 1:31\n\n' });
    expect(module).toContain('org: `\nGEN 1:31\n`,');
    expect(() => renderVrsModule({ ...texts, eng: 'GEN 1:31 `' })).toThrow(/eng\.vrs/);
    expect(() => renderVrsModule({ ...texts, eng: 'GEN ${x}' })).toThrow(/cannot be embedded/);
  });
});

describe('SOURCE.json', () => {
  const source = JSON.parse(read('SOURCE.json')) as SourceJson;

  it('records a licence and a checksum for every embedded file', () => {
    const listed = source.sources.flatMap((entry) => entry.files);
    expect(listed.map((file) => file.path).sort()).toEqual(Object.values(VRS_FILES).sort());
    for (const entry of source.sources) expect(entry.licence).toMatch(/\S/);
    for (const file of listed) {
      expect(createHash('sha256').update(read(file.path)).digest('hex'), file.path).toBe(file.sha256);
    }
  });
});
