/**
 * A separate process for the ledger's concurrency test: says it is ready (a file), then reserves
 * $2 of a $5 ceiling in the ledger and prints the reservation, or the refusal, as JSON.
 *
 *     tsx reserve-child.ts <ledger path> <run id> <ready file>
 */
import { writeFileSync } from 'node:fs';

import { reserveSpend } from '../ledger.ts';

const [path = '', run = '', ready = ''] = process.argv.slice(2);
writeFileSync(ready, '');
try {
  const reservation = await reserveSpend(path, { run, at: new Date().toISOString(), wantUsd: 2, totalUsd: 5 });
  process.stdout.write(JSON.stringify(reservation));
} catch (error) {
  process.stdout.write(JSON.stringify({ run, refused: (error as Error).message }));
}
