/**
 * The audio manifest, `audio/manifest.json` in object storage: every rendered narration file by
 * storage key, with its public URL, size, duration, voice and creation time. The web build reads
 * it to attach audio to segments (L-082); the render pipeline reads it to skip what exists.
 */
import type { ObjectStorage, TtsFormat } from '@lectio/providers';

/** Storage key of the manifest. */
export const MANIFEST_KEY = 'audio/manifest.json';
/** Version of the manifest format. */
export const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  /** Public URL of the file (`publicBaseUrl` + key), or the bare key when there is no public base URL. */
  readonly url: string;
  readonly bytes: number;
  /** Playing time; `null` when the file was found in storage without an entry and its length is unreadable. */
  readonly durationMs: number | null;
  readonly voice: string;
  /** Engine version folded into the key (see `TTS_VERSIONS`). */
  readonly ttsVersion: string;
  /** Audio format of the file; also its key's extension. */
  readonly format: TtsFormat;
  /** ISO instant the entry was created. */
  readonly createdAt: string;
  readonly contentType: string;
  /**
   * Characters billed to render the file. Feeds the monthly budget; a file adopted from storage
   * counts its text's characters, since an interrupted earlier run most likely paid for it.
   */
  readonly characters: number;
}

export interface AudioManifest {
  readonly version: number;
  /** Entries by storage key (`audio/<locale>/<hash>.<ext>`). */
  readonly entries: Readonly<Record<string, ManifestEntry>>;
}

export function emptyManifest(): AudioManifest {
  return { version: MANIFEST_VERSION, entries: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function checkEntry(key: string, value: unknown): ManifestEntry {
  const fail = (field: string): never => {
    throw new TypeError(`audio manifest entry ${JSON.stringify(key)}: invalid ${field}`);
  };
  if (!isRecord(value)) return fail('entry');
  if (!isText(value['url'])) fail('url');
  if (!isCount(value['bytes'])) fail('bytes');
  if (value['durationMs'] !== null && !isCount(value['durationMs'])) fail('durationMs');
  if (!isText(value['voice'])) fail('voice');
  if (!isText(value['ttsVersion'])) fail('ttsVersion');
  if (value['format'] !== 'wav' && value['format'] !== 'mp3') fail('format');
  if (!isText(value['createdAt']) || Number.isNaN(Date.parse(value['createdAt']))) fail('createdAt');
  if (!isText(value['contentType'])) fail('contentType');
  if (!isCount(value['characters'])) fail('characters');
  return value as unknown as ManifestEntry;
}

/** Parses and checks a manifest's JSON text; throws on any malformed field or an unknown version. */
export function parseManifest(text: string): AudioManifest {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !isRecord(data['entries']))
    throw new TypeError('audio manifest: expected { version, entries }');
  if (data['version'] !== MANIFEST_VERSION) {
    throw new TypeError(`audio manifest: unsupported version ${JSON.stringify(data['version'])}`);
  }
  const entries: Record<string, ManifestEntry> = {};
  for (const [key, entry] of Object.entries(data['entries'])) entries[key] = checkEntry(key, entry);
  return { version: MANIFEST_VERSION, entries };
}

/** Stable JSON: entries sorted by key, so an unchanged manifest serialises to the same bytes. */
export function serializeManifest(manifest: AudioManifest): string {
  const keys = Object.keys(manifest.entries).sort();
  const entries = Object.fromEntries(keys.map((key) => [key, manifest.entries[key]]));
  return `${JSON.stringify({ version: manifest.version, entries }, null, 2)}\n`;
}

/** The stored manifest, or an empty one when storage has none yet. */
export async function readManifest(storage: ObjectStorage): Promise<AudioManifest> {
  const stored = await storage.get(MANIFEST_KEY);
  return stored === null ? emptyManifest() : parseManifest(new TextDecoder().decode(stored.body));
}

export async function writeManifest(storage: ObjectStorage, manifest: AudioManifest): Promise<void> {
  await storage.put(MANIFEST_KEY, serializeManifest(manifest), {
    contentType: 'application/json',
    cacheControl: 'no-cache',
  });
}

/** Characters billed by entries created in the UTC calendar month of `now`. */
export function charactersThisMonth(manifest: AudioManifest, now: Date): number {
  const month = now.toISOString().slice(0, 7);
  return Object.values(manifest.entries)
    .filter((entry) => new Date(entry.createdAt).toISOString().slice(0, 7) === month)
    .reduce((sum, entry) => sum + entry.characters, 0);
}
