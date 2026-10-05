import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BudgetRefusedError } from '../cli/budget.ts';
import { LEDGER_PATH, ledgerTotals, readLedger, reserveSpend, settleSpend, withLedgerLock } from './ledger.ts';

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

  it('serialises batches that start together, so they never reserve the same dollars', async () => {
    const reservations = await Promise.all(
      ['a', 'b', 'c', 'd'].map((run) =>
        reserveSpend(path, { run, at, wantUsd: 2, totalUsd: 5 }, noWait).catch((error: unknown) => error),
      ),
    );
    expect(reservations.slice(0, 3)).toMatchObject([{ reservedUsd: 2 }, { reservedUsd: 2 }, { reservedUsd: 1 }]);
    expect(reservations[3]).toBeInstanceOf(BudgetRefusedError);
    expect(ledgerTotals(readLedger(path)).spentUsd).toBe(5);
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
