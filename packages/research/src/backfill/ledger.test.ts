import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BudgetRefusedError } from '../cli/budget.ts';
import {
  LEDGER_PATH,
  ledgerTotals,
  readLedger,
  reserveSpend,
  settleSpend,
  takeStaleLock,
  withLedgerLock,
} from './ledger.ts';
import type { Reservation } from './ledger.ts';

const TSX = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));
const CHILD = fileURLToPath(new URL('fixtures/reserve-child.ts', import.meta.url));

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lectio-ledger-'));
  path = join(dir, LEDGER_PATH);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = '2026-10-05T08:00:00.000Z';
const noWait = { sleep: () => Promise.resolve() };

describe('readLedger and ledgerTotals', () => {
  it('reads nothing from a missing ledger', () => {
    expect(readLedger(path)).toEqual([]);
    expect(ledgerTotals([])).toEqual({ spentUsd: 0, openRuns: 0 });
  });

  it('counts settled runs at what they spent and open runs at what they reserved', () => {
    expect(
      ledgerTotals([
        { run: 'a', at, reservedUsd: 5 },
        { run: 'a', at, spentUsd: 3.25 },
        { run: 'b', at, reservedUsd: 2 },
        // A settlement without its reservation (an edited ledger) still counts.
        { run: 'c', at, spentUsd: 0.5 },
        // Repeated lines for one run add up.
        { run: 'd', at, reservedUsd: 1 },
        { run: 'd', at, reservedUsd: 1 },
        { run: 'e', at, reservedUsd: 4 },
        { run: 'e', at, spentUsd: 1 },
        { run: 'e', at, spentUsd: 0.1 },
      ]),
    ).toEqual({ spentUsd: 3.25 + 2 + 0.5 + 2 + 1.1, openRuns: 2 });
  });

  it('skips blank lines and refuses a line that is not an entry', () => {
    writeLedger(`{"run":"a","at":"${at}","reservedUsd":1}\n\n{"run":"a","at":"${at}","spentUsd":0.5}\n`);
    expect(readLedger(path)).toEqual([
      { run: 'a', at, reservedUsd: 1 },
      { run: 'a', at, spentUsd: 0.5 },
    ]);
    for (const bad of [
      'not json',
      'null',
      '5',
      '{"run":1,"at":"x","spentUsd":1}',
      '{"run":"a","at":2,"spentUsd":1}',
      '{"run":"a","at":"x"}',
      '{"run":"a","at":"x","spentUsd":1,"reservedUsd":1}',
      '{"run":"a","at":"x","spentUsd":-1}',
      '{"run":"a","at":"x","spentUsd":"1"}',
    ]) {
      writeLedger(`{"run":"a","at":"${at}","reservedUsd":1}\n${bad}\n`);
      expect(() => readLedger(path)).toThrow(BudgetRefusedError);
      expect(() => readLedger(path)).toThrow(`${path} line 2 is not a ledger entry; nothing was spent.`);
    }
  });
});

function writeLedger(text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('reserveSpend and settleSpend', () => {
  it('reserves up to what is left, settles, and refuses once the ceiling is used up', async () => {
    const first = await reserveSpend(path, { run: 'a', at, wantUsd: 3, totalUsd: 5 });
    expect(first).toEqual({ run: 'a', reservedUsd: 3, spentBeforeUsd: 0 });
    // An open run holds its whole reservation.
    const second = await reserveSpend(path, { run: 'b', at, wantUsd: 3, totalUsd: 5 });
    expect(second).toEqual({ run: 'b', reservedUsd: 2, spentBeforeUsd: 3 });
    await expect(reserveSpend(path, { run: 'c', at, wantUsd: 3, totalUsd: 5 })).rejects.toThrow(
      `the back-fill ceiling is used up ($5.00 of $5.00 research.budget.backfillTotalUsd in ${path})`,
    );
    await settleSpend(path, { run: 'a', at, spentUsd: 1 });
    const third = await reserveSpend(path, { run: 'c', at, wantUsd: 3, totalUsd: 5 });
    expect(third).toEqual({ run: 'c', reservedUsd: 2, spentBeforeUsd: 3 });
    expect(readLedger(path)).toHaveLength(4);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('makes reservations that wait on a held lock take turns once it is released', async () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.lock`, '');
    let waits = 0;
    // Every reservation finds the lock held; the fourth wait releases it.
    const sleep = (): Promise<void> => {
      waits++;
      if (waits === 4) rmSync(`${path}.lock`);
      return Promise.resolve();
    };
    const reservations = await Promise.all(
      ['a', 'b', 'c', 'd'].map((run) =>
        reserveSpend(path, { run, at, wantUsd: 2, totalUsd: 5 }, { sleep }).catch((error: unknown) => error),
      ),
    );
    expect(waits).toBeGreaterThanOrEqual(4);
    expect(reservations.filter((r) => r instanceof BudgetRefusedError)).toHaveLength(1);
    const reserved = reservations.flatMap((r) =>
      r instanceof BudgetRefusedError ? [] : [(r as Reservation).reservedUsd],
    );
    expect(reserved.sort()).toEqual([1, 2, 2]);
    expect(ledgerTotals(readLedger(path)).spentUsd).toBe(5);
  });

  it('never lets separate processes reserve the same dollars', async () => {
    mkdirSync(dirname(path), { recursive: true });
    // Hold the lock until every process is started and waiting, so they all contend for it.
    writeFileSync(`${path}.lock`, '');
    const runs = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const outputs = runs.map(
      (run) =>
        new Promise<string>((resolve, reject) => {
          execFile(TSX, [CHILD, path, run, join(dir, `${run}.ready`)], { timeout: 30_000 }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
          });
        }),
    );
    while (!runs.every((run) => existsSync(join(dir, `${run}.ready`)))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    rmSync(`${path}.lock`);
    const results = (await Promise.all(outputs)).map(
      (stdout) => JSON.parse(stdout) as { reservedUsd?: number; refused?: string },
    );
    const reserved = results.flatMap((result) => (result.reservedUsd === undefined ? [] : [result.reservedUsd]));
    expect(reserved.sort()).toEqual([1, 2, 2]);
    expect(results.filter((result) => result.refused?.includes('the back-fill ceiling is used up'))).toHaveLength(2);
    expect(ledgerTotals(readLedger(path))).toEqual({ spentUsd: 5, openRuns: 3 });
    expect(existsSync(`${path}.lock`)).toBe(false);
  }, 60_000);
});

describe('takeStaleLock', () => {
  const lock = (): string => `${path}.lock`;
  const judgedStale = (): Stats => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(lock(), 'stale');
    return lstatSync(lock());
  };

  it('removes the lock it judged stale', () => {
    expect(takeStaleLock(lock(), judgedStale())).toBe(true);
    expect(readdirSync(dirname(path))).toEqual([]);
  });

  it('does nothing when the lock is already gone', () => {
    const judged = judgedStale();
    rmSync(lock());
    expect(takeStaleLock(lock(), judged)).toBe(false);
    expect(readdirSync(dirname(path))).toEqual([]);
  });

  it('puts back a live lock another run created after the check', () => {
    const judged = judgedStale();
    // Another run took the stale lock over first and holds a fresh one.
    rmSync(lock());
    writeFileSync(lock(), 'live');
    utimesSync(lock(), new Date(judged.mtimeMs + 5_000), new Date(judged.mtimeMs + 5_000));
    expect(takeStaleLock(lock(), judged)).toBe(false);
    expect(readFileSync(lock(), 'utf8')).toBe('live');
    expect(readdirSync(dirname(path))).toEqual(['backfill-ledger.jsonl.lock']);
  });

  it('leaves the lock to a third run that created one while the path was empty', () => {
    const judged = judgedStale();
    rmSync(lock());
    writeFileSync(lock(), 'live');
    const rename = (from: string, to: string): void => {
      renameSync(from, to);
      writeFileSync(lock(), 'third');
    };
    expect(takeStaleLock(lock(), judged, rename)).toBe(false);
    expect(readFileSync(lock(), 'utf8')).toBe('third');
    expect(readdirSync(dirname(path))).toEqual(['backfill-ledger.jsonl.lock']);
  });
});

describe('withLedgerLock', () => {
  const lock = (): string => `${path}.lock`;
  const hold = (): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(lock(), '');
  };

  it('waits for another holder to release the lock', async () => {
    hold();
    setTimeout(() => rmSync(lock()), 20);
    expect(await withLedgerLock(path, () => 'mine')).toBe('mine');
    expect(existsSync(lock())).toBe(false);
  });

  it('releases the lock when the body throws', async () => {
    await expect(
      withLedgerLock(path, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lock())).toBe(false);
  });

  it('removes a stale lock left by a killed process', async () => {
    hold();
    const later = Date.now() + 120_000;
    expect(await withLedgerLock(path, () => 1, { ...noWait, nowMs: () => later })).toBe(1);
    expect(readdirSync(dirname(path))).toEqual([]);
  });

  it('on release leaves a lock that is no longer its own', async () => {
    await withLedgerLock(path, () => {
      // Another run took the lock over (this holder was too slow) and holds a new one.
      rmSync(lock());
      writeFileSync(lock(), 'theirs');
    });
    expect(readFileSync(lock(), 'utf8')).toBe('theirs');
    rmSync(lock());
    await withLedgerLock(path, () => {
      rmSync(lock());
    });
    expect(existsSync(lock())).toBe(false);
  });

  it('tries again at once when the lock goes between the attempt and the check', async () => {
    hold();
    let calls = 0;
    const nowMs = (): number => {
      calls++;
      // The first call starts the clock; the second is the age check, after the failed attempt.
      if (calls === 2) rmSync(lock());
      return 0;
    };
    expect(await withLedgerLock(path, () => 2, { ...noWait, nowMs })).toBe(2);
  });

  it('gives up after the timeout and leaves a live lock alone', async () => {
    hold();
    let now = Date.now();
    const nowMs = (): number => (now += 1_000);
    await expect(withLedgerLock(path, () => 3, { ...noWait, nowMs, timeoutMs: 5_000 })).rejects.toThrow(
      `another back-fill holds ${lock()}; nothing was spent.`,
    );
    expect(existsSync(lock())).toBe(true);
  });

  it('passes on an error other than an existing lock', async () => {
    const long = join(dir, 'x'.repeat(252));
    await expect(withLedgerLock(long, () => 4)).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
  });
});
