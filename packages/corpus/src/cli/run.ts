/**
 * The logic behind the corpus CLIs (src/cli/find.ts, src/cli/licences.ts), which only wire in process state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { openCorpus } from '../corpus.ts';
import type { MatchMode } from '../corpus.ts';
import { CorpusError } from '../format.ts';
import { formatLicences, listLicences } from '../licences.ts';

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

/**
 * The corpus directory: `LECTIO_CORPUS_ROOT` if set, else `<repo>/corpus`, where the repo root is the nearest
 * ancestor of `INIT_CWD` (or `cwd`) whose package.json declares workspaces.
 */
export function resolveCorpusRoot(env: NodeJS.ProcessEnv, cwd: string): string {
  const explicit = env['LECTIO_CORPUS_ROOT'];
  if (explicit !== undefined && explicit !== '') return resolve(cwd, explicit);
  let dir = resolve(env['INIT_CWD'] ?? cwd);
  while (!isWorkspaceRoot(dir)) {
    const parent = dirname(dir);
    if (parent === dir) throw new CorpusError(`no workspace root above ${env['INIT_CWD'] ?? cwd}`);
    dir = parent;
  }
  return join(dir, 'corpus');
}

const FIND_USAGE =
  'usage: corpus:find -- <edition> <BOOK> <chapter> <verse> <word…> [--match surface|lemma|either]\n' +
  'example: npm run corpus:find -- grc-sblgnt MT 20 15 πονηρός';

const MODES: readonly MatchMode[] = ['surface', 'lemma', 'either'];

function parseFindArgs(args: readonly string[]): { positional: string[]; match: MatchMode } | string {
  const positional: string[] = [];
  let match: MatchMode = 'either';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const inline = arg.startsWith('--match=') ? arg.slice('--match='.length) : undefined;
    if (arg === '--match' || inline !== undefined) {
      const value = inline ?? args[(i += 1)];
      if (!MODES.includes(value as MatchMode)) return `--match must be one of ${MODES.join(', ')}`;
      match = value as MatchMode;
    } else if (arg === '--help' || arg === '-h') {
      return '';
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < 5) return 'expected an edition, book, chapter, verse and word';
  return { positional, match };
}

/**
 * `corpus:find`: prints the verse's matching tokens. Several trailing words are looked up as a phrase.
 * Exit code 0 when found, 1 when not found (or the verse is missing), 2 on usage or corpus errors.
 */
export async function runFind(args: readonly string[], root: string, io: CliIo): Promise<number> {
  const parsed = parseFindArgs(args);
  if (typeof parsed === 'string') {
    if (parsed !== '') io.err(parsed);
    io.err(FIND_USAGE);
    return 2;
  }
  const [edition, book, chapter, verse, ...words] = parsed.positional as [string, string, string, string, string];
  const query = words.join(' ');
  const where = `${edition} ${book} ${chapter}:${verse}`;
  try {
    const corpus = openCorpus(root);
    if ((await corpus.getVerse(edition, book, chapter, verse)) === undefined) {
      io.err(`${where}: verse not in corpus`);
      return 1;
    }
    if (words.length > 1) {
      const found = await corpus.phraseOccurs(edition, book, chapter, verse, query, { match: parsed.match });
      io.out(`${where}: phrase "${query}" ${found ? 'occurs' : 'does not occur'} (match: ${parsed.match})`);
      return found ? 0 : 1;
    }
    const result = await corpus.findWord(edition, book, chapter, verse, query, { match: parsed.match });
    if (result.matches.length === 0) {
      io.out(`${where}: "${query}" not found (match: ${parsed.match})`);
      return 1;
    }
    io.out(`${where}: "${query}" found (match: ${parsed.match})`);
    for (const { index, token } of result.matches) {
      const [surface, lemma, morph] = token;
      io.out(`  word ${index + 1}: ${surface}  lemma ${lemma || '-'}${morph === undefined ? '' : `  morph ${morph}`}`);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof CorpusError)) throw error;
    io.err(error.message);
    return 2;
  }
}

/** `corpus:licences`: prints the attribution list of every edition. */
export async function runLicences(root: string, io: CliIo): Promise<number> {
  try {
    io.out(formatLicences(await listLicences(root)).trimEnd());
    return 0;
  } catch (error) {
    if (!(error instanceof CorpusError)) throw error;
    io.err(error.message);
    return 2;
  }
}
