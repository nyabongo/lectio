import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ContentError } from './errors.ts';
import {
  checkCalendarYear,
  checkContentText,
  checkPassage,
  contentKindOf,
  isMissing,
  nodeFs,
  parseJson,
  yearOfFileName,
} from './files.ts';

const fixture = (path: string) => fileURLToPath(new URL(`fixtures/${path}`, import.meta.url));
const json = (path: string): unknown => JSON.parse(readFileSync(fixture(path), 'utf8'));

function thrown(fn: () => unknown): ContentError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContentError) return error;
    throw error;
  }
  throw new Error('expected a ContentError');
}

describe('parseJson', () => {
  it('parses JSON and reports malformed text against the whole file', () => {
    expect(parseJson('{"a":1}', 'x.json')).toEqual({ a: 1 });
    const error = thrown(() => parseJson('{', 'x.json'));
    expect(error.file).toBe('x.json');
    expect(error.pointer).toBe('');
    expect(error.message).toMatch(/^x\.json: not valid JSON \(/);
  });
});

describe('checkPassage', () => {
  it('returns a valid passage, with or without an expected key', () => {
    const value = json('repo/passages/MT.20.1-16.json');
    expect(checkPassage(value, 'p.json').key).toBe('MT.20.1-16');
    expect(checkPassage(value, 'p.json', 'MT.20.1-16').key).toBe('MT.20.1-16');
  });

  it('rejects a schema violation and a key that differs from the file name', () => {
    expect(thrown(() => checkPassage(json('broken/passages/MT.20.1-16.json'), 'p.json')).pointer).toBe('/review');
    const mismatch = thrown(() => checkPassage(json('repo/passages/MT.20.1-16.json'), 'p.json', 'MT.20.1-15'));
    expect(mismatch.pointer).toBe('/key');
    expect(mismatch.message).toBe('p.json#/key: must equal the file name key "MT.20.1-15"');
  });
});

describe('checkCalendarYear', () => {
  it('returns a valid year, with or without an expected year', () => {
    const value = json('repo/calendar/2026.json');
    expect(checkCalendarYear(value, 'c.json').year).toBe(2026);
    expect(checkCalendarYear(value, 'c.json', 2026).days).toHaveLength(3);
  });

  it('rejects a schema violation and a year that differs from the file name', () => {
    expect(thrown(() => checkCalendarYear(json('broken/calendar/2025.json'), 'c.json')).pointer).toBe(
      '/days/0/celebrations/0/colour',
    );
    expect(thrown(() => checkCalendarYear(json('repo/calendar/2026.json'), 'c.json', 2027)).pointer).toBe('/year');
  });
});

describe('file names', () => {
  it('classifies content files by their directory', () => {
    expect(contentKindOf('/repo/passages/MT.20.1-16.json')).toBe('passage');
    expect(contentKindOf('calendar/2026.json')).toBe('calendar');
    expect(contentKindOf('calendar/2026.txt')).toBeNull();
    expect(contentKindOf('other/2026.json')).toBeNull();
  });

  it('reads the year from a calendar file name', () => {
    expect(yearOfFileName('2026.json')).toBe(2026);
    expect(yearOfFileName('2026-draft.json')).toBeNull();
  });
});

describe('checkContentText', () => {
  it('checks a passage against its file name key', () => {
    const text = readFileSync(fixture('repo/passages/MT.20.1-16.json'), 'utf8');
    expect(checkContentText('passage', text, 'passages/MT.20.1-16.json')).toMatchObject({ key: 'MT.20.1-16' });
    expect(thrown(() => checkContentText('passage', text, 'passages/IS.55.6-9.json')).pointer).toBe('/key');
  });

  it('checks a calendar against its file name year', () => {
    const text = readFileSync(fixture('repo/calendar/2026.json'), 'utf8');
    expect(checkContentText('calendar', text, 'calendar/2026.json')).toMatchObject({ year: 2026 });
    expect(thrown(() => checkContentText('calendar', text, 'calendar/2025.json')).pointer).toBe('/year');
    expect(thrown(() => checkContentText('calendar', text, 'calendar/latest.json')).message).toBe(
      'calendar/latest.json: calendar files are named <year>.json',
    );
  });
});

describe('nodeFs and isMissing', () => {
  it('reads files and directories, and recognises ENOENT', () => {
    expect(nodeFs.readdir(fixture('repo/calendar'))).toContain('2026.json');
    expect(nodeFs.readFile(fixture('repo/calendar/2026.json'))).toContain('"year": 2026');
    let caught: unknown;
    try {
      nodeFs.readFile(fixture('repo/missing.json'));
    } catch (error) {
      caught = error;
    }
    expect(isMissing(caught)).toBe(true);
    expect(isMissing(new Error('other'))).toBe(false);
    expect(isMissing(null)).toBe(false);
  });
});
