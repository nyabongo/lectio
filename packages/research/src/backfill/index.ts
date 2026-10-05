/**
 * `npm run research -- backfill` (L-072): reserved. The CLI registry (../cli/registry.ts) routes the
 * subcommand here; L-072 replaces this stub with the back-fill mode without touching `src/cli`.
 */
import type { RegisteredSubcommand } from '../cli/registry.ts';

export const BACKFILL_USAGE = 'research backfill … (not implemented yet, L-072)';

export const backfillSubcommand: RegisteredSubcommand = {
  name: 'backfill',
  usage: BACKFILL_USAGE,
  run(_argv, _context, io) {
    io.err('research backfill: not implemented yet (L-072)');
    return Promise.resolve(2);
  },
};
