/**
 * Offline link check for the repository's Markdown (L-091). Finds every relative link and heading anchor in a
 * Markdown file and reports the ones that do not resolve: a missing file or directory, or an `#anchor` that is not
 * a heading (GitHub's slug rules) or an explicit `id`/`name` in the target Markdown file.
 *
 * External links (any URL scheme, or `//host`) are never fetched. Code spans and fenced code blocks are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface Link {
  /** 1-based line number in the source file. */
  readonly line: number;
  /** The link target exactly as written (without `<…>` and title). */
  readonly target: string;
}

export interface BrokenLink extends Link {
  /** Source file, relative to the repository root, with `/` separators. */
  readonly file: string;
  readonly reason: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;
const HTML_ANCHOR = /<(?:a|[a-z][a-z0-9]*)\b[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
const HTML_HREF = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Lines outside fenced code blocks, with their 1-based numbers and code spans blanked out. */
export function proseLines(markdown: string): { readonly line: number; readonly text: string }[] {
  const out: { line: number; text: string }[] = [];
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const opener = FENCE.exec(raw);
    if (fence !== null) {
      if (opener && opener[1]?.[0] === fence[0] && (opener[1]?.length ?? 0) >= fence.length) fence = null;
      return;
    }
    if (opener) {
      fence = opener[1] ?? null;
      return;
    }
    out.push({ line: index + 1, text: raw.replace(/(`+)(?:(?!\1).)+?\1/g, (span) => ' '.repeat(span.length)) });
  });
  return out;
}

/** Every link target in the Markdown: inline links and images, reference definitions and HTML `href`s. */
export function extractLinks(markdown: string): Link[] {
  const links: Link[] = [];
  const add = (line: number, raw: string): void => {
    const target = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
    if (target !== '') links.push({ line, target });
  };
  for (const { line, text } of proseLines(markdown)) {
    for (const match of text.matchAll(INLINE_LINK)) add(line, match[1] as string);
    for (const match of text.matchAll(HTML_HREF)) add(line, match[1] as string);
    const definition = REFERENCE_DEFINITION.exec(text);
    if (definition) add(line, definition[1] as string);
  }
  return links;
}

/** The text a heading renders to, roughly: inline links reduced to their text, emphasis and HTML tags removed. */
function headingText(source: string): string {
  return source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/(\*+|\b_+|_+\b)/g, '')
    .trim();
}

/** GitHub's heading slug: lower case, punctuation dropped (letters, digits, `-`, `_` kept), spaces to `-`. */
export function slugify(text: string): string {
  return headingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor a Markdown file defines: heading slugs (`-1`, `-2` … for repeats) and HTML `id`/`name`s. */
export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const { text } of proseLines(markdown)) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
    if (heading) {
      const base = slugify(heading[1] as string);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${String(count)}`);
    }
    for (const match of text.matchAll(HTML_ANCHOR)) anchors.add(match[1] as string);
  }
  return anchors;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Checks one Markdown file. `file` is absolute; `repoRoot` anchors `/`-rooted links (as GitHub does) and the
 * reported path. Anchors are checked only when the target is a Markdown file.
 */
export function checkFile(file: string, repoRoot: string): BrokenLink[] {
  const markdown = readFileSync(file, 'utf8');
  const shown = relative(repoRoot, file).split(sep).join('/');
  const broken: BrokenLink[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsFor = (path: string): Set<string> => {
    let anchors = anchorCache.get(path);
    if (!anchors) {
      anchors = anchorsOf(readFileSync(path, 'utf8'));
      anchorCache.set(path, anchors);
    }
    return anchors;
  };

  for (const link of extractLinks(markdown)) {
    const { target } = link;
    if (SCHEME.test(target) || target.startsWith('//')) continue;
    const hashAt = target.indexOf('#');
    const pathPart = decode((hashAt === -1 ? target : target.slice(0, hashAt)).split('?')[0] as string);
    const anchor = hashAt === -1 ? null : decode(target.slice(hashAt + 1));
    const path =
      pathPart === '' ? file : pathPart.startsWith('/') ? join(repoRoot, pathPart) : resolve(dirname(file), pathPart);

    if (!existsSync(path)) {
      broken.push({ ...link, file: shown, reason: `no such file or directory: ${relative(repoRoot, path)}` });
      continue;
    }
    if (anchor === null || anchor === '' || !path.endsWith('.md') || !statSync(path).isFile()) continue;
    if (!anchorsFor(path).has(anchor.toLowerCase()) && !anchorsFor(path).has(anchor)) {
      broken.push({ ...link, file: shown, reason: `no heading or anchor #${anchor} in ${relative(repoRoot, path)}` });
    }
  }
  return broken;
}

/** Markdown files under `dir`, recursively, sorted; skips `node_modules` and dot-directories. */
export function markdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files.sort();
}
