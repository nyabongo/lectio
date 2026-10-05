import { describe, expect, it } from 'vitest';

import { MemoryStorage } from './fixtures/fakes.ts';
import { RESUME_DAYS, RESUME_KEY, clearResume, loadResume, resumeStart, saveResume } from './resume.ts';

describe('resume points', () => {
  it('saves and loads the point per day', () => {
    const storage = new MemoryStorage();
    expect(loadResume(storage, '2026-09-20')).toBeNull();
    expect(saveResume(storage, '2026-09-20', { id: 'MT.20.1-16/context', position: 12.5 })).toBe(true);
    expect(saveResume(storage, '2026-09-21', { id: 'x', position: -4 })).toBe(true);
    expect(loadResume(storage, '2026-09-20')).toEqual({ id: 'MT.20.1-16/context', position: 12.5 });
    expect(loadResume(storage, '2026-09-21')).toEqual({ id: 'x', position: 0 });
  });

  it(`keeps only the latest ${RESUME_DAYS} days`, () => {
    const storage = new MemoryStorage();
    for (let day = 1; day <= RESUME_DAYS + 2; day++)
      saveResume(storage, `2026-10-${String(day).padStart(2, '0')}`, { id: 'a', position: day });
    const saved = JSON.parse(storage.getItem(RESUME_KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(saved)).toHaveLength(RESUME_DAYS);
    expect(saved['2026-10-01']).toBeUndefined();
    expect(loadResume(storage, '2026-10-16')).toEqual({ id: 'a', position: 16 });
  });

  it('forgets a day heard to the end', () => {
    const storage = new MemoryStorage();
    saveResume(storage, '2026-09-20', { id: 'a', position: 1 });
    saveResume(storage, '2026-09-21', { id: 'b', position: 2 });
    expect(clearResume(storage, '2026-09-20')).toBe(true);
    expect(clearResume(storage, '2026-09-20')).toBe(true);
    expect(loadResume(storage, '2026-09-20')).toBeNull();
    expect(loadResume(storage, '2026-09-21')).toEqual({ id: 'b', position: 2 });
  });

  it('tolerates no storage, failing storage and bad data', () => {
    expect(loadResume(null, '2026-09-20')).toBeNull();
    expect(saveResume(null, '2026-09-20', { id: 'a', position: 1 })).toBe(false);
    const storage = new MemoryStorage();
    for (const raw of ['not json', '[]', 'null', '{"2026-09-20":null}', '{"2026-09-20":{"id":1,"position":2}}']) {
      storage.setItem(RESUME_KEY, raw);
      expect(loadResume(storage, '2026-09-20')).toBeNull();
    }
    storage.setItem(RESUME_KEY, '{"2026-09-20":{"id":"a","position":"2"},"2026-09-21":{"id":"b","position":3}}');
    expect(loadResume(storage, '2026-09-21')).toEqual({ id: 'b', position: 3 });
    storage.setItem(RESUME_KEY, '{"2026-09-20":{"id":"a","position":-1},"2026-09-21":[1]}');
    expect(loadResume(storage, '2026-09-20')).toBeNull();
    saveResume(storage, '2026-09-22', { id: 'c', position: 1 });
    storage.failWrites = true;
    expect(saveResume(storage, '2026-09-20', { id: 'a', position: 1 })).toBe(false);
    expect(clearResume(storage, '2026-09-22')).toBe(false);
    storage.failReads = true;
    expect(loadResume(storage, '2026-09-22')).toBeNull();
  });
});

describe('resumeStart', () => {
  it('maps a saved point to the queue, or the start when it is gone', () => {
    const ids = ['a', 'b', 'c'];
    expect(resumeStart({ id: 'b', position: 7 }, ids)).toEqual({ index: 1, position: 7 });
    expect(resumeStart({ id: 'z', position: 7 }, ids)).toEqual({ index: 0, position: 0 });
    expect(resumeStart(null, ids)).toEqual({ index: 0, position: 0 });
  });
});
