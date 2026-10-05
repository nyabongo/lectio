import { describe, expect, it } from 'vitest';

import type { CliContext } from '../cli/main.ts';
import { REGISTERED_SUBCOMMANDS } from '../cli/registry.ts';
import { BACKFILL_USAGE, backfillSubcommand } from './index.ts';

describe('backfill (reserved for L-072)', () => {
  it('is registered with the CLI and says it is not implemented yet, exit 2', async () => {
    expect(REGISTERED_SUBCOMMANDS).toContain(backfillSubcommand);
    expect(backfillSubcommand).toMatchObject({ name: 'backfill', usage: BACKFILL_USAGE });
    const err: string[] = [];
    const code = await backfillSubcommand.run([], {} as CliContext, {
      out: () => undefined,
      err: (line) => err.push(line),
    });
    expect(code).toBe(2);
    expect(err).toEqual(['research backfill: not implemented yet (L-072)']);
  });
});
