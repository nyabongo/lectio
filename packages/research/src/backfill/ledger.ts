/**
 * The back-fill spend ledger: an append-only JSON Lines file that makes
 * `research.budget.backfillTotalUsd` a cumulative ceiling across batches.
 *
 * Every live batch appends two lines under {@link LEDGER_PATH}:
 *
 *     {"run":"…","at":"2026-10-05T08:00:00.000Z","reservedUsd":5}   before any provider is called
 *     {"run":"…","at":"2026-10-05T08:20:00.000Z","spentUsd":3.42}   when the batch ends
 *
 * A run counts its `spentUsd` once settled and its whole `reservedUsd` until then, so a batch that
 * is still running (or one that crashed before it settled) keeps its share. Reserving reads the
 * total and appends under an exclusive lock file (`<ledger>.lock`, created with `O_EXCL`), so two
 * batches started at the same time on one checkout cannot both spend the same remaining dollars.
 * A lock older than {@link LedgerOptions.staleMs} is left over from a killed process and is removed.
 */
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { BudgetRefusedError } from '../cli/budget.ts';

/** The ledger, relative to the repository root. Commit it so another clone counts the same spend. */
export const LEDGER_PATH = 'research/backfill-ledger.jsonl';

/** One ledger line: a reservation before a batch or its settlement after. */
export type LedgerEntry =
  | { readonly run: string; readonly at: string; readonly reservedUsd: number }
  | { readonly run: string; readonly at: string; readonly spentUsd: number };

export interface LedgerTotals {
  /** Settled spend plus the reservations of runs that have not settled. */
  readonly spentUsd: number;
  /** Runs reserved but not settled: running now, or killed before they settled. */
  readonly openRuns: number;
}

export interface LedgerOptions {
  /** How long to wait for the lock before giving up. Default 10 s. */
  readonly timeoutMs?: number;
  /** A lock older than this is stale and removed. Default 60 s (the lock is held for milliseconds). */
  readonly staleMs?: number;
  /** Waits between lock attempts. Default a 50 ms timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Current time in ms, for the stale-lock check. Default `Date.now`. */
  readonly nowMs?: () => number;
}

export interface Reservation {
  readonly run: string;
  /** What the batch may spend: `min(wantUsd, totalUsd − spent)`. */
  readonly reservedUsd: number;
  /** The ledger total before this reservation. */
  readonly spentBeforeUsd: number;
}

const money = (usd: number): string => `$${usd.toFixed(2)}`;
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function parseLine(line: string, number: number, path: string): LedgerEntry {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    value = null;
  }
  const entry = value as Record<string, unknown> | null;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry['run'] === 'string' &&
    typeof entry['at'] === 'string' &&
    isAmount(entry['reservedUsd']) !== isAmount(entry['spentUsd'])
  ) {
    return entry as unknown as LedgerEntry;
  }
  throw new BudgetRefusedError(
    `research backfill: ${path} line ${String(number)} is not a ledger entry; nothing was spent. ` +
      'Fix the line (see docs/runbooks/research-cli.md#back-fill) and run again.',
  );
}

/** The entries of the ledger at `path` (none when the file does not exist). */
export function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, number }) => parseLine(line, number, path));
}

/** The cumulative spend in `entries`: settled runs at what they spent, open runs at what they reserved. */
export function ledgerTotals(entries: readonly LedgerEntry[]): LedgerTotals {
  const reserved = new Map<string, number>();
  const settled = new Map<string, number>();
  for (const entry of entries) {
    if ('reservedUsd' in entry) reserved.set(entry.run, (reserved.get(entry.run) ?? 0) + entry.reservedUsd);
    else settled.set(entry.run, (settled.get(entry.run) ?? 0) + entry.spentUsd);
  }
  let spentUsd = 0;
  let openRuns = 0;
  for (const [run, usd] of settled) if (!reserved.has(run)) spentUsd += usd;
  for (const [run, usd] of reserved) {
    const spent = settled.get(run);
    if (spent === undefined) openRuns++;
    spentUsd += spent ?? usd;
  }
  return { spentUsd: Math.round(spentUsd * 1e6) / 1e6, openRuns };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Runs `body` holding `<path>.lock`; waits for another holder, removes a stale lock. */
export async function withLedgerLock<T>(path: string, body: () => T, options: LedgerOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, staleMs = 60_000, sleep = defaultSleep, nowMs = Date.now } = options;
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const start = nowMs();
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (fd !== undefined) {
      try {
        return body();
      } finally {
        closeSync(fd);
        rmSync(lock, { force: true });
      }
    }
    let age: number;
    try {
      age = nowMs() - lstatSync(lock).mtimeMs;
    } catch {
      continue; // released since the attempt above
    }
    if (age > staleMs) {
      rmSync(lock, { force: true });
      continue;
    }
    if (nowMs() - start >= timeoutMs) {
      throw new BudgetRefusedError(
        `research backfill: another back-fill holds ${lock}; nothing was spent. Wait for it to finish, ` +
          'or delete the lock file if no back-fill is running.',
      );
    }
    await sleep(50);
  }
}

const append = (path: string, entry: LedgerEntry): void => {
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
};

/**
 * Reserves up to `wantUsd` for run `run` under the lock: refuses (`BudgetRefusedError`) when the
 * ledger already holds `totalUsd` or more, else appends a reservation of `min(wantUsd, left)`.
 */
export function reserveSpend(
  path: string,
  request: { readonly run: string; readonly at: string; readonly wantUsd: number; readonly totalUsd: number },
  options?: LedgerOptions,
): Promise<Reservation> {
  return withLedgerLock(
    path,
    () => {
      const { spentUsd } = ledgerTotals(readLedger(path));
      const leftUsd = request.totalUsd - spentUsd;
      // Under a cent left cannot pay for a research call.
      if (leftUsd < 0.01) {
        throw new BudgetRefusedError(
          `research backfill: the back-fill ceiling is used up (${money(spentUsd)} of ` +
            `${money(request.totalUsd)} research.budget.backfillTotalUsd in ${path}); nothing was generated. ` +
            'The owner raises the ceiling in config/lectio.config.json to back-fill more.',
        );
      }
      const reservedUsd = Math.min(request.wantUsd, leftUsd);
      append(path, { run: request.run, at: request.at, reservedUsd });
      return { run: request.run, reservedUsd, spentBeforeUsd: spentUsd };
    },
    options,
  );
}

/** Records what run `run` spent, releasing the rest of its reservation. */
export function settleSpend(
  path: string,
  settlement: { readonly run: string; readonly at: string; readonly spentUsd: number },
  options?: LedgerOptions,
): Promise<void> {
  return withLedgerLock(path, () => append(path, settlement), options);
}
