#!/usr/bin/env node
// A stand-in for `gh` in the setup.sh tests. Appends every call ({ args, stdin }) as one JSON line
// to $FAKE_GH_LOG and answers the two reads setup.sh makes:
//   gh api repos/<o>/<r> --jq .owner.type  -> $FAKE_GH_OWNER_TYPE (default User)
//   gh api repos/<o>/<r>/pages --silent    -> $FAKE_GH_PAGES: "exists" (default), "missing" (404), "error" (500)
// Every other call succeeds silently.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const stdin = args.includes('--input') ? readFileSync(0, 'utf8') : null;
appendFileSync(process.env['FAKE_GH_LOG'] ?? 'fake-gh.log', `${JSON.stringify({ args, stdin })}\n`);

const isRead = args[0] === 'api' && !args.includes('--method');
if (isRead && args.includes('--jq')) {
  process.stdout.write(`${process.env['FAKE_GH_OWNER_TYPE'] ?? 'User'}\n`);
} else if (isRead && args[1]?.endsWith('/pages')) {
  const pages = process.env['FAKE_GH_PAGES'] ?? 'exists';
  if (pages === 'missing') {
    process.stderr.write('gh: Not Found (HTTP 404)\n');
    process.exit(1);
  }
  if (pages === 'error') {
    process.stderr.write('gh: Server Error (HTTP 500)\n');
    process.exit(1);
  }
}
