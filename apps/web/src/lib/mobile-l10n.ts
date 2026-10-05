/**
 * The Flutter app's UI string catalogs (L-114) without a Dart SDK: a byte-for-byte port of
 * `apps/mobile/tool/sync_l10n.dart`, run with `npm run l10n:sync` (`-- --check` only reports). See that file for the
 * format; in short:
 *
 * - The sources are the site's catalogs, `apps/web/src/i18n/<locale>/<feature>.json`, and the app's own,
 *   `apps/mobile/lib/l10n/catalog/<locale>/<feature>.json`, flattened with `_` between segments (`day.json` →
 *   `{"slot": {"psalm": "Psalm"}}` is `day_slot_psalm`). A plural message is an object whose keys are all plural
 *   categories, including `one` or `other`.
 * - It writes `apps/mobile/lib/l10n/app_<locale>.arb` (ICU plurals; the English template describes placeholders) and
 *   `catalog.g.dart` (every message as JSON in a Dart raw string).
 * - Every locale must have every English key, with the same shape and placeholders, and nothing else.
 *
 * Byte-identical output needs Dart's ordering: JSON objects are read into `Map`s in file order (a plain object
 * would move integer-like keys such as `"2"` to the front) and written as Dart's `JsonEncoder.withIndent('  ')`
 * writes them. `mobile-l10n.test.ts` compares the output with the committed files, which flutter.yml checks against
 * the Dart tool, and with Dart's output for edge cases (`apps/mobile/test/fixtures/l10n/`).
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The UI locales, the first being the fallback. */
export const CATALOG_LOCALES: readonly string[] = ['en', 'sw'];

/** Catalog directories, relative to `apps/mobile`: the site's, then the app's. */
export const CATALOG_DIRS: readonly string[] = ['../web/src/i18n', 'lib/l10n/catalog'];

/** Where the generated files go, relative to `apps/mobile`. */
export const OUTPUT_DIR = 'lib/l10n';

/** The generated Dart catalog, relative to `apps/mobile`. */
export const DART_CATALOG_PATH = `${OUTPUT_DIR}/catalog.g.dart`;

/** The ARB file of `locale`, relative to `apps/mobile`. */
export function arbPath(locale: string): string {
  return `${OUTPUT_DIR}/app_${locale}.arb`;
}

/** Plural categories, in CLDR order. */
export const PLURAL_CATEGORIES: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A flattened message: plain text, or a plural message (category → text, in CLDR order). */
export type Message = string | ReadonlyMap<string, string>;

/** One locale's messages by flattened key, in catalog order. */
export type Messages = Map<string, Message>;

/** Every locale's messages, the fallback first. */
export type Catalogs = Map<string, Messages>;

const SEGMENT = /^[A-Za-z0-9]+$/;
const PLACEHOLDER = /\{(\w+)\}/g;

/** A catalog that cannot be turned into the app's strings. */
export class CatalogError extends Error {
  override readonly name = 'CatalogError';
}

/** A JSON value with every object read as a `Map` in file order. */
export type JsonValue = string | number | boolean | null | JsonValue[] | Map<string, JsonValue>;

/**
 * Parses `text` as JSON, objects as `Map`s with their keys in file order (a repeated key keeps its first place and
 * takes its last value, as in Dart's `jsonDecode`). Malformed JSON throws a `CatalogError` naming `path`.
 */
export function parseJsonInOrder(text: string, path: string): JsonValue {
  try {
    JSON.parse(text);
  } catch (error) {
    throw new CatalogError(`${path}: ${(error as Error).message}`, { cause: error });
  }
  // `text` is valid JSON from here on, so the reader below only has to find where each value ends.
  let at = 0;
  const space = (): void => {
    while (/\s/.test(text.charAt(at))) at += 1;
  };
  const token = (pattern: RegExp): string => {
    pattern.lastIndex = at;
    const match = pattern.exec(text) as RegExpExecArray;
    at += match[0].length;
    return match[0];
  };
  const STRING = /"(?:[^"\\]|\\.)*"/y;
  const SCALAR = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  const value = (): JsonValue => {
    space();
    const char = text.charAt(at);
    if (char === '"') return JSON.parse(token(STRING)) as string;
    if (char !== '{' && char !== '[') return JSON.parse(token(SCALAR)) as JsonValue;
    at += 1;
    space();
    const close = char === '{' ? '}' : ']';
    const object = new Map<string, JsonValue>();
    const array: JsonValue[] = [];
    while (text.charAt(at) !== close) {
      if (char === '{') {
        space();
        const key = JSON.parse(token(STRING)) as string;
        space();
        at += 1; // the colon
        object.set(key, value());
      } else {
        array.push(value());
      }
      space();
      if (text.charAt(at) === ',') at += 1;
      space();
    }
    at += 1;
    return char === '{' ? object : array;
  };
  return value();
}

/**
 * Whether `value` is a plural message: two or more string values whose keys are all plural categories, including
 * `one` or `other`.
 */
export function looksPlural(value: ReadonlyMap<string, unknown>): boolean {
  const keys = [...value.keys()];
  return (
    keys.length >= 2 &&
    (value.has('one') || value.has('other')) &&
    keys.every((key) => PLURAL_CATEGORIES.includes(key) && typeof value.get(key) === 'string')
  );
}

/** Flattens one catalog file's `value` into `into`, under `key`. `path` names the file in errors. */
export function flattenCatalog(value: unknown, key: string, path: string, into: Messages): void {
  if (typeof value === 'string') {
    into.set(key, value);
    return;
  }
  if (!(value instanceof Map)) throw new CatalogError(`${path}: "${key}" must be a string or an object`);
  const object = value as ReadonlyMap<string, unknown>;
  if (looksPlural(object)) {
    if (!object.has('other')) throw new CatalogError(`${path}: plural "${key}" needs an "other" form`);
    const forms = new Map<string, string>();
    for (const category of PLURAL_CATEGORIES) {
      const text = object.get(category);
      if (typeof text === 'string') forms.set(category, text);
    }
    into.set(key, forms);
    return;
  }
  if (object.size === 0) throw new CatalogError(`${path}: "${key}" is empty`);
  for (const [name, child] of object) {
    if (!SEGMENT.test(name)) {
      throw new CatalogError(`${path}: key "${name}" under "${key}" must be letters and digits`);
    }
    flattenCatalog(child, `${key}_${name}`, path, into);
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export interface ReadCatalogsOptions {
  readonly dirs?: readonly string[];
  readonly locales?: readonly string[];
}

/**
 * The messages of every locale, read from the `<locale>/<feature>.json` files under `dirs` (relative to `root`),
 * features in name order. A feature defined in two directories is an error, as is a locale with no catalog at all.
 */
export function readCatalogs(root: string, options: ReadCatalogsOptions = {}): Catalogs {
  const { dirs = CATALOG_DIRS, locales = CATALOG_LOCALES } = options;
  const catalogs: Catalogs = new Map();
  for (const locale of locales) {
    const files = new Map<string, string>();
    for (const dir of dirs) {
      const directory = `${root}/${dir}/${locale}`;
      let names: string[];
      try {
        names = readdirSync(directory);
      } catch {
        continue;
      }
      for (const name of names) {
        const file = `${directory}/${name}`;
        if (!name.endsWith('.json') || !isFile(file)) continue;
        const feature = name.slice(0, -'.json'.length);
        const path = `${dir}/${locale}/${name}`;
        if (!SEGMENT.test(feature)) throw new CatalogError(`${path}: the feature name must be letters and digits`);
        const previous = files.get(feature);
        if (previous !== undefined) {
          throw new CatalogError(`${path}: feature "${feature}" is also defined in ${previous}`);
        }
        files.set(feature, file);
      }
    }
    if (files.size === 0) throw new CatalogError(`no catalog for locale "${locale}"`);
    const messages: Messages = new Map();
    // The default sort compares UTF-16 code units, as Dart's `List<String>.sort()` does.
    for (const feature of [...files.keys()].sort()) {
      const file = files.get(feature) as string;
      flattenCatalog(parseJsonInOrder(readFileSync(file, 'utf8'), file), feature, file, messages);
    }
    catalogs.set(locale, messages);
  }
  return catalogs;
}

/** The `{name}` placeholders of `message`, every plural form together, sorted. */
export function placeholdersOf(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : [...message.values()];
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(PLACEHOLDER)) names.add(match[1] as string);
  return [...names].sort();
}

function shape(message: Message): string {
  return [typeof message === 'string' ? 'text' : 'plural', ...placeholdersOf(message)].join(' ');
}

/**
 * Why the `catalogs` do not match the first locale's: missing or extra keys, or a message whose shape or
 * placeholders differ. Empty when they match.
 */
export function parityProblems(catalogs: Catalogs): string[] {
  const problems: string[] = [];
  const [base, ...others] = [...catalogs];
  const [baseLocale, baseMessages] = base as [string, Messages];
  for (const [locale, messages] of others) {
    for (const [key, value] of baseMessages) {
      const translated = messages.get(key);
      if (translated === undefined) problems.push(`${locale}: missing "${key}"`);
      else if (shape(translated) !== shape(value)) {
        problems.push(`${locale}: "${key}" is "${shape(translated)}", ${baseLocale} is "${shape(value)}"`);
      }
    }
    for (const key of messages.keys()) {
      if (!baseMessages.has(key)) problems.push(`${locale}: "${key}" is not in ${baseLocale}`);
    }
  }
  return problems;
}

/** `message` as an ARB (ICU) message: plain text, or `{count, plural, one{…} other{…}}`. */
export function icuMessage(message: Message): string {
  if (typeof message === 'string') return message;
  const forms = [...message].map(([category, text]) => `${category}{${text}}`).join(' ');
  return `{count, plural, ${forms}}`;
}

/** A string or nested map, for {@link encodeJson}. */
export type EncodableJson = string | ReadonlyMap<string, EncodableJson>;

/**
 * `value` as Dart's `JsonEncoder.withIndent('  ')` writes it: keys in map order, two-space indent, `{}` for an empty
 * map. Strings are escaped as `JSON.stringify` escapes them, which is what Dart does too.
 */
export function encodeJson(value: EncodableJson, indent = ''): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value.size === 0) return '{}';
  const inner = `${indent}  `;
  const entries = [...value].map(([key, child]) => `${inner}${JSON.stringify(key)}: ${encodeJson(child, inner)}`);
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

/** The ARB file of `locale`; the template (`withMetadata`) also describes each message's placeholders. */
export function arbSource(locale: string, messages: Messages, withMetadata: boolean): string {
  const arb = new Map<string, EncodableJson>([['@@locale', locale]]);
  for (const [key, value] of messages) {
    arb.set(key, icuMessage(value));
    const placeholders = placeholdersOf(value);
    if (withMetadata && placeholders.length > 0) {
      const described = new Map<string, EncodableJson>(
        placeholders.map((name) => [
          name,
          typeof value === 'string' || name !== 'count' ? new Map() : new Map([['type', 'num']]),
        ]),
      );
      arb.set(`@${key}`, new Map([['placeholders', described]]));
    }
  }
  return `${encodeJson(arb)}\n`;
}

/** The Dart catalog: every locale's messages as JSON in a raw string. */
export function dartSource(catalogs: Catalogs): string {
  const json = encodeJson(catalogs);
  if (json.includes("'''")) throw new CatalogError("a message contains ''' (see dartSource)");
  return (
    '// GENERATED by tool/sync_l10n.dart from apps/web/src/i18n and lib/l10n/catalog.\n' +
    '// Do not edit: run `npm run l10n:sync` (or `dart run tool/sync_l10n.dart` in apps/mobile).\n' +
    '// Kiswahili strings are provisional until a native speaker reviews them (#221).\n' +
    '\n' +
    '/// Every UI message by locale and key, read by LectioLocalizations.\n' +
    "const String catalogJson = r'''\n" +
    `${json}\n` +
    "''';\n"
  );
}

/** Every generated file, by path relative to `apps/mobile`. */
export function generatedFiles(catalogs: Catalogs): Map<string, string> {
  const problems = parityProblems(catalogs);
  if (problems.length > 0) throw new CatalogError(problems.join('\n'));
  const [fallback] = catalogs.keys();
  const files = new Map<string, string>();
  for (const [locale, messages] of catalogs)
    files.set(arbPath(locale), arbSource(locale, messages, locale === fallback));
  files.set(DART_CATALOG_PATH, dartSource(catalogs));
  return files;
}

/** Where `syncL10n` reports. */
export interface Sink {
  write(text: string): unknown;
}

export interface SyncL10nOptions {
  readonly out: Sink;
  readonly err: Sink;
  /** Only report the files that are out of date. */
  readonly check?: boolean;
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Writes the generated files under `root` (`apps/mobile`), or with `check` only reports the ones that are out of
 * date. Returns the exit code.
 */
export function syncL10n(root: string, options: SyncL10nOptions): number {
  const { out, err, check = false } = options;
  let files: Map<string, string>;
  try {
    files = generatedFiles(readCatalogs(root));
  } catch (error) {
    err.write(`sync_l10n: ${(error as Error).message}\n`);
    return 1;
  }
  const stale: string[] = [];
  for (const [path, content] of files) {
    const file = `${root}/${path}`;
    if (readIfExists(file) === content) continue;
    stale.push(path);
    if (!check) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
  if (check && stale.length > 0) {
    err.write(
      `sync_l10n: out of date: ${stale.join(', ')}. Run \`npm run l10n:sync\` (or ` +
        '`dart run tool/sync_l10n.dart` in apps/mobile) and commit the result.\n',
    );
    return 1;
  }
  const verb = check ? 'up to date' : `wrote ${String(stale.length)} file(s)`;
  out.write(`sync_l10n: ${verb} (${String(files.size)} generated files)\n`);
  return 0;
}
