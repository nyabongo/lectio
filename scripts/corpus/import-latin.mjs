// `npm run corpus:import:latin`: imports the pinned Clementine Vulgate into corpus/lat-vulgate-clementine
// (logic and tests: packages/corpus/src/importers/vulgate.ts; downloader: packages/provider-fetch).
import { resolveCorpusRoot } from '../../packages/corpus/src/cli/run.ts';
import { runImportVulgate } from '../../packages/corpus/src/importers/vulgate.ts';
import { LiveDownloader } from '../../packages/provider-fetch/src/index.ts';

process.exitCode = await runImportVulgate(
  resolveCorpusRoot(process.env, process.cwd()),
  { out: console.log, err: console.error },
  { downloader: new LiveDownloader() },
);
