/**
 * Subcommands that live outside `src/cli`. Each one names itself, gives a usage line and runs with
 * the words after its name, the CLI context and the output. It parses its own flags (the common
 * ones through `parseCommonArgs`) and builds its providers with `composeProviders` and the budget
 * helpers, so a new mode needs no change to `args.ts` or `main.ts`.
 *
 * `backfill` (L-072) is registered from `../backfill/index.ts`; that module replaces its stub with
 * the real command.
 */
import { backfillSubcommand } from '../backfill/index.ts';
import type { CliContext, CliIo } from './main.ts';

export interface RegisteredSubcommand {
  /** The word after `research`. */
  readonly name: string;
  /** One usage line, starting with `research <name>`. */
  readonly usage: string;
  /** Runs the subcommand; returns the exit code (0 done, 1 needs attention, 2 bad command line). */
  run(argv: readonly string[], context: CliContext, io: CliIo): Promise<number>;
}

/** The registered subcommands, in usage order. */
export const REGISTERED_SUBCOMMANDS: readonly RegisteredSubcommand[] = [backfillSubcommand];
