import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { nodeFs } from './files.ts';
import type { ContentFs } from './files.ts';
import { contentFilesUnder, runValidate, validateContentFiles } from './validate-files.ts';

const FIXTURES = fileURLToPath(new URL('fixtures', import.meta.url));

function run(args: string[], config: string, fs?: ContentFs) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runValidate(args, {
    cwd: FIXTURES,
    env: { LECTIO_CONFIG: join(FIXTURES, config) },
    ...(fs === undefined ? {} : { fs }),
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, out, err };
}

describe('contentFilesUnder', () => {
  it('lists calendar then passage files, sorted', () => {
    expect(contentFilesUnder(join(FIXTURES, 'repo')).map((path) => path.slice(FIXTURES.length + 1))).toEqual([
      'repo/calendar/2026.json',
      'repo/calendar/2027.json',
      'repo/passages/IS.55.6-9.json',
      'repo/passages/MT.20.1-16.json',
    ]);
  });

  it('treats a missing directory as empty and rethrows other errors', () => {
    expect(contentFilesUnder(join(FIXTURES, 'other'))).toEqual([]);
    const denied: ContentFs = {
      ...nodeFs,
      readdir: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
    };
    expect(() => contentFilesUnder(FIXTURES, denied)).toThrow('EACCES');
  });
});

describe('validateContentFiles', () => {
  it('accepts valid files and reports each invalid one with its pointer', () => {
    const report = validateContentFiles(
      [
        'repo/calendar/2026.json',
        join(FIXTURES, 'repo/passages/MT.20.1-16.json'),
        'broken/calendar/2025.json',
        'broken/calendar/2024.json',
        'broken/passages/MT.20.1-16.json',
        'broken/passages/IS.55.6-9.json',
        'other/notes.json',
        'repo/passages/JN.1.1-18.json',
      ],
      FIXTURES,
    );
    expect(report.files).toEqual([
      'repo/calendar/2026.json',
      'repo/passages/MT.20.1-16.json',
      'broken/calendar/2025.json',
      'broken/calendar/2024.json',
      'broken/passages/MT.20.1-16.json',
      'broken/passages/IS.55.6-9.json',
      'other/notes.json',
      'repo/passages/JN.1.1-18.json',
    ]);
    expect(report.errors.map(({ file, pointer }) => `${file}#${pointer}`)).toEqual([
      'broken/calendar/2025.json#/days/0/celebrations/0/colour',
      'broken/calendar/2024.json#/year',
      'broken/passages/MT.20.1-16.json#/review',
      'broken/passages/IS.55.6-9.json#/key',
      'other/notes.json#',
      'repo/passages/JN.1.1-18.json#',
    ]);
    expect(report.errors[4]?.message).toMatch(/not a content file/);
    expect(report.errors[5]?.message).toMatch(/^repo\/passages\/JN\.1\.1-18\.json: cannot read file \(ENOENT/);
  });
});

describe('runValidate', () => {
  it('validates the files given and exits 0 when all are valid', () => {
    expect(run(['--', 'repo/calendar/2026.json', 'repo/passages/IS.55.6-9.json'], 'config-repo.json')).toEqual({
      code: 0,
      out: ['content:validate: 2 files valid'],
      err: [],
    });
  });

  it('prints every problem and exits 1 when a file is invalid', () => {
    const { code, out, err } = run(['broken/passages/MT.20.1-16.json', 'repo/calendar/2026.json'], 'config-repo.json');
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([
      'broken/passages/MT.20.1-16.json#/review: is required',
      'content:validate: 1 of 2 files invalid',
    ]);
  });

  it('validates the whole configured content root when no file is given', () => {
    expect(run([], 'config-repo.json')).toEqual({ code: 0, out: ['content:validate: 4 files valid'], err: [] });
  });

  it('says so when the content root has no content files', () => {
    expect(run([], 'config-empty.json')).toEqual({
      code: 0,
      out: ['content:validate: no content files found'],
      err: [],
    });
  });

  it('uses the injected file system', () => {
    const fs: ContentFs = { ...nodeFs, readFile: () => '{' };
    const { code, err } = run(['repo/calendar/2026.json'], 'config-repo.json', fs);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^repo\/calendar\/2026\.json: not valid JSON/);
  });
});
