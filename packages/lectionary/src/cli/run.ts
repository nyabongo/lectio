/**
 * The logic behind the lectionary CLIs (check.ts, crosscheck.ts, import-litcal.ts), which only wire in process state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { validateCalendarYear } from '@lectio/schema/calendar';

import { checkLectionary } from '../check.ts';
import { crosscheckBlock, parseCrosscheckFile, renderDisputes } from '../crosscheck.ts';
import { importLitcal, mergeImported, parseManifest, serialiseBlockFile } from '../import/litcal.ts';
import type { TextFetcher } from '../import/litcal.ts';
import { loadLectionary, loadRegistry } from '../load.ts';
import type { LectionaryDay } from '../resolve.ts';
import type { BlockFile } from '../types.ts';
import { validateBlockFile } from '../validate.ts';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function isWorkspaceRoot(dir: string): boolean {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    return 'workspaces' in (JSON.parse(readFileSync(manifest, 'utf8')) as object);
  } catch {
    return false;
  }
}

/** The directory the user ran the command in: `INIT_CWD` (set by npm), else `cwd`. */
export function invocationDir(env: NodeJS.ProcessEnv, cwd: string): string {
  return resolve(env['INIT_CWD'] ?? cwd);
}

/**
 * The lectionary data directory: `LECTIO_LECTIONARY_ROOT` if set (relative to `INIT_CWD`, or `cwd` without it), else
 * `<repo>/calendar/lectionary`, where the repo root is the nearest ancestor of `INIT_CWD` (or `cwd`) whose
 * package.json declares workspaces.
 */
export function resolveLectionaryRoot(env: NodeJS.ProcessEnv, cwd: string): string {
  const explicit = env['LECTIO_LECTIONARY_ROOT'];
  const base = invocationDir(env, cwd);
  if (explicit !== undefined && explicit !== '') return resolve(base, explicit);
  let dir = base;
  while (!isWorkspaceRoot(dir)) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no workspace root above ${base}`);
    dir = parent;
  }
  return join(dir, 'calendar', 'lectionary');
}

function report(problems: readonly string[], io: CliIo): void {
  for (const problem of problems) io.err(`  ${problem}`);
}

/** The days of calendar year files (`calendar/<year>.json`, L-017), or the problems reading them. */
async function readCalendars(paths: readonly string[]): Promise<{ days: LectionaryDay[]; problems: string[] }> {
  const days: LectionaryDay[] = [];
  const problems: string[] = [];
  for (const path of paths) {
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      problems.push(`${path}: ${(error as Error).message}`);
      continue;
    }
    if (validateCalendarYear(json)) {
      days.push(...json.days);
    } else {
      // ajv always sets `errors` when validation fails.
      const errors = (validateCalendarYear.errors as NonNullable<typeof validateCalendarYear.errors>).slice(0, 3);
      const detail = errors.map((e) => `${e.instancePath || '/'} ${String(e.message)}`).join('; ');
      problems.push(`${path}: not a valid calendar year file (${detail})`);
    }
  }
  return { days, problems };
}

/**
 * `lectionary:check [--block <name>]… [--calendar <file>]…`: shape, refs, sources and status of every data file.
 * With calendar year files (relative paths resolve against `cwd`, the directory the command was run in), also
 * checks that every feast or solemnity on a Sunday gets a second reading. Exit code 0 when clean, 1 when there are
 * problems, 2 on usage errors (including a flag where a value belongs).
 */
export async function runCheck(
  args: readonly string[],
  root: string,
  io: CliIo,
  cwd: string = process.cwd(),
): Promise<number> {
  const blocks: string[] = [];
  const calendars: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i + 1];
    const ok = value !== undefined && !value.startsWith('--');
    if (args[i] === '--block' && ok) blocks.push(value);
    else if (args[i] === '--calendar' && ok) calendars.push(resolve(cwd, value));
    else {
      io.err('usage: lectionary:check [-- [--block <name>]… [--calendar <calendar/YYYY.json>]…]');
      return 2;
    }
    i += 1;
  }
  const loaded = await loadLectionary(root, blocks.length === 0 ? undefined : blocks);
  const calendar = await readCalendars(calendars);
  const options = calendars.length === 0 ? {} : { days: calendar.days };
  const { problems, stats } = checkLectionary(loaded.files, loaded.registry, options);
  const all = [...loaded.problems, ...calendar.problems, ...problems];
  const { provisional, verified, disputed } = stats.byStatus;
  io.out(
    `lectionary:check: ${stats.files} files, ${stats.entries} entries, ${stats.readings} readings ` +
      `(${provisional} provisional, ${verified} verified, ${disputed} disputed)`,
  );
  if (stats.unknownPages > 0) io.out(`  ${stats.unknownPages} OLM 1981 citations have no page yet (p?)`);
  if (all.length === 0) return 0;
  io.err(`${all.length} problem${all.length === 1 ? '' : 's'}:`);
  report(all, io);
  return 1;
}

function blockArg(args: readonly string[]): string | undefined {
  const [flag, value, ...rest] = args;
  return flag === '--block' && value !== undefined && rest.length === 0 && /^[a-z0-9-]+$/.test(value)
    ? value
    : undefined;
}

/**
 * `lectionary:crosscheck --block <name>`: compares the block with `crosscheck/<name>.json` and writes
 * `disputes/<name>.md`. Exit code 0 with no disagreements, 1 with disagreements or check problems, 2 on usage errors.
 */
export async function runCrosscheck(args: readonly string[], root: string, io: CliIo): Promise<number> {
  const block = blockArg(args);
  if (block === undefined) {
    io.err('usage: lectionary:crosscheck -- --block <name>');
    return 2;
  }
  const loaded = await loadLectionary(root, [block]);
  const checked = checkLectionary(loaded.files, loaded.registry);
  const problems = [...loaded.problems, ...checked.problems];
  if (problems.length > 0) {
    io.err(`block "${block}" fails lectionary:check; fix it first:`);
    report(problems, io);
    return 1;
  }
  const label = `crosscheck/${block}.json`;
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(root, 'crosscheck', `${block}.json`), 'utf8'));
  } catch (error) {
    io.err(`${label}: ${(error as Error).message}`);
    return 1;
  }
  const parsed = parseCrosscheckFile(json, label);
  if (parsed.data === undefined || parsed.data.block !== block) {
    io.err(`${label} is invalid:`);
    report(
      parsed.data === undefined ? parsed.problems : [`"block" is "${parsed.data.block}", expected "${block}"`],
      io,
    );
    return 1;
  }
  const result = crosscheckBlock(block, loaded.files, parsed.data, loaded.registry);
  const out = join(root, 'disputes', `${block}.md`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderDisputes(result));
  io.out(
    `lectionary:crosscheck ${block}: ${result.compared} compared, ${result.agreements} agree, ` +
      `${result.disagreements.length} disagree, ${result.singleSource.length} single-source → disputes/${block}.md`,
  );
  return result.disagreements.length === 0 ? 0 : 1;
}

/**
 * `import-litcal <manifest>`: imports the LitCal leaves listed in `import/litcal/<manifest>.json` at the pinned
 * revision and merges them into the manifest's target file. Exit code 0 on success, 1 on import problems, 2 on usage
 * errors.
 */
export async function runImportLitcal(
  args: readonly string[],
  root: string,
  io: CliIo,
  fetcher: TextFetcher,
): Promise<number> {
  const [name, ...rest] = args;
  if (name === undefined || rest.length > 0 || !/^[a-z0-9-]+$/.test(name)) {
    io.err('usage: import-litcal <manifest name in calendar/lectionary/import/litcal/>');
    return 2;
  }
  const label = `import/litcal/${name}.json`;
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await readFile(join(root, 'import', 'litcal', `${name}.json`), 'utf8'));
  } catch (error) {
    io.err(`${label}: ${(error as Error).message}`);
    return 1;
  }
  const manifest = parseManifest(manifestJson, label);
  const { registry, problems: registryProblems } = await loadRegistry(root);
  if (manifest.data === undefined || registryProblems.length > 0) {
    report([...manifest.problems, ...registryProblems], io);
    return 1;
  }
  const { readings, removedMasses, problems } = await importLitcal(manifest.data, registry, fetcher);
  if (problems.length > 0) {
    io.err('import failed; nothing written:');
    report(problems, io);
    return 1;
  }
  const target = join(root, manifest.data.target);
  let current: BlockFile = { kind: manifest.data.kind, entries: [] };
  let comment: string | undefined;
  if (existsSync(target)) {
    const json = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    const valid = validateBlockFile(json, manifest.data.target);
    if (valid.data === undefined || valid.data.kind !== manifest.data.kind) {
      io.err(`${manifest.data.target} is not a valid ${manifest.data.kind} file:`);
      report(valid.problems, io);
      return 1;
    }
    current = valid.data;
    comment = json['$comment'] as string | undefined;
  }
  const merged = mergeImported(current, readings, removedMasses);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialiseBlockFile(merged.data, comment));
  io.out(`import-litcal ${name}: ${merged.added} added, ${merged.replaced} replaced → ${manifest.data.target}`);
  if (merged.kept.length > 0) {
    io.out(`  kept (verified, disputed or from another source): ${merged.kept.join('; ')}`);
  }
  if (merged.removed.length > 0) {
    io.out(`  removed (no longer in the LitCal leaf): ${merged.removed.join('; ')}`);
  }
  return 0;
}

/** A {@link TextFetcher} over HTTP(S) with the given `fetch` (the global one by default). */
export function httpFetcher(fetchImpl: typeof fetch = fetch): TextFetcher {
  return {
    async fetchText(url) {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
      return response.text();
    },
  };
}
