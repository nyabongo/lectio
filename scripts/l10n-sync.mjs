#!/usr/bin/env node
// Thin wrapper: `npm run l10n:sync [-- --check]` regenerates the Flutter app's l10n files (apps/mobile/lib/l10n)
// from the site's and the app's catalogs, without a Dart SDK. Logic: apps/web/src/lib/mobile-l10n.ts, a byte-for-byte
// port of apps/mobile/tool/sync_l10n.dart.
import { fileURLToPath } from 'node:url';

import { syncL10n } from '../apps/web/src/lib/mobile-l10n.ts';

process.exitCode = syncL10n(fileURLToPath(new URL('../apps/mobile', import.meta.url)), {
  out: process.stdout,
  err: process.stderr,
  check: process.argv.includes('--check'),
});
