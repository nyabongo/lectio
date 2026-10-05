/**
 * Writes the bad-week fixture files (see ./bad-week.ts) under tests/gates/fixtures/bad-week/,
 * keeping the comment snapshot. Run `npx tsx tests/gates/helpers/write-bad-week.ts`, then
 * `npx vitest run --project gates-content -u` to refresh comment.md.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { format, resolveConfig } from 'prettier';

import { BAD_WEEK_DIR, badWeekFiles } from './bad-week.ts';

for (const dir of ['head', 'base', 'pages']) rmSync(join(BAD_WEEK_DIR, dir), { recursive: true, force: true });
for (const [file, text] of Object.entries(badWeekFiles())) {
  const path = join(BAD_WEEK_DIR, file);
  mkdirSync(dirname(path), { recursive: true });
  const options = (await resolveConfig(path)) ?? {};
  writeFileSync(path, file.endsWith('.json') ? await format(text, { ...options, parser: 'json' }) : text, 'utf8');
}
