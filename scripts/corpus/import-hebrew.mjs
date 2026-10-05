#!/usr/bin/env node
// Thin wrapper for `npm run corpus:import:hebrew` (L-011): downloads the pinned openscriptures/morphhb archive and
// rewrites corpus/hbo-oshb. Logic and tests: packages/corpus/src/importers/oshb.ts; downloader: packages/provider-fetch.
import { runImportHebrew } from '../../packages/corpus/src/importers/oshb.ts';
import { LiveDownloader } from '../../packages/provider-fetch/src/index.ts';

process.exitCode = await runImportHebrew(
  process.env,
  process.cwd(),
  { out: console.log, err: console.error },
  { downloader: new LiveDownloader() },
);
