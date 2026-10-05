// `npm exec -w @lectio/lectionary -- tsx src/cli/import-litcal.ts <manifest>` (logic and tests: ./run.ts).
// The only network access: GETs of the pinned LitCal files named in calendar/lectionary/sources.json.
import { httpFetcher, resolveLectionaryRoot, runImportLitcal } from './run.ts';

process.exitCode = await runImportLitcal(
  process.argv.slice(2),
  resolveLectionaryRoot(process.env, process.cwd()),
  { out: console.log, err: console.error },
  httpFetcher(),
);
