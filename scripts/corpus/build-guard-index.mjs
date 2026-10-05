#!/usr/bin/env node
// Thin wrapper: downloads the public-domain English Bibles (WEB, Douay-Rheims) to a temp dir, hashes their
// shingles, deletes the text and writes only corpus/guard/en-pd-<n>.bin and corpus/guard/SOURCE.json.
// Logic: packages/textguard/src/build.ts. Run with `npm run guard:build [-- --n 8 --out corpus/guard]`.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFetchDownloader, parseBuildArgs, runGuardBuild } from '@lectio/textguard';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const args = parseBuildArgs(process.argv.slice(2));

await runGuardBuild({
  downloader: createFetchDownloader(),
  outDir: resolve(repoRoot, args.outDir),
  shingleSize: args.shingleSize,
  log: (message) => console.log(`guard:build: ${message}`),
});
