// `npm run corpus:import:lxx`: imports the deuterocanonical books of the pinned Swete Septuagint into corpus/grc-lxx
// (logic and tests: packages/corpus/src/importers/lxx.ts; downloader: packages/provider-fetch).
import { resolveCorpusRoot } from '../../packages/corpus/src/cli/run.ts';
import { runImportLxx } from '../../packages/corpus/src/importers/lxx.ts';
import { LiveDownloader } from '../../packages/provider-fetch/src/index.ts';

process.exitCode = await runImportLxx(
  resolveCorpusRoot(process.env, process.cwd()),
  { out: console.log, err: console.error },
  { downloader: new LiveDownloader() },
);
