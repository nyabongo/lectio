/**
 * Reader preferences, kept on the device: there are no accounts. The store is a typed, versioned JSON record in
 * `localStorage` under `STORAGE_KEY`, read and written through a `SettingsStorage` (the browser's `localStorage`, or
 * a fake in tests).
 *
 * Every read is tolerant: no storage (SSR, a blocked or private window), a throwing accessor, malformed JSON, an
 * unknown version or a field with the wrong type all fall back to the defaults field by field, so a bad value never
 * breaks a page. Every write is wrapped in try/catch and reports whether it stuck.
 *
 * Applying: `applySettings` sets `data-theme` (absent for "system", so `prefers-color-scheme` decides; see
 * `themeCss()` in theme.ts), `data-text-size` and the root font size (the type and spacing scales are in `rem`, so
 * the whole page scales). `headScript()` is the same logic as a dependency-free inline script for `<head>`, so the
 * saved theme and size apply before first paint.
 *
 * Other features read the store with `loadSettings(browserStorage())`; the Listen page (L-085) takes its starting
 * speed from `playbackSpeed`. `clearOfflineData` is the hook for the PWA (L-061): it deletes the Cache Storage
 * caches named with `OFFLINE_DATA_CACHE_PREFIX` and leaves the app-shell cache alone.
 */

export const STORAGE_KEY = 'lectio.settings';

/** The shape version written with every save. Bump it, and migrate in `parseSettings`, when the shape changes. */
export const SETTINGS_VERSION = 1;

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

/** Text sizes and their root font-size scale (1 = the browser's own default size). */
export const TEXT_SIZES = { small: 0.9, default: 1, large: 1.125, larger: 1.25 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const TEXT_SIZE_NAMES = Object.keys(TEXT_SIZES) as readonly TextSize[];

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** UI languages: `available: false` ones are listed as coming soon and cannot be chosen yet. */
export const LANGUAGES = [
  { code: 'en', available: true },
  { code: 'sw', available: false },
] as const;
export type LanguageCode = Extract<(typeof LANGUAGES)[number], { available: true }>['code'];

export interface Settings {
  readonly textSize: TextSize;
  readonly theme: ThemePreference;
  readonly playbackSpeed: PlaybackSpeed;
  readonly language: LanguageCode;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  textSize: 'default',
  theme: 'system',
  playbackSpeed: 1,
  language: 'en',
});

/** The slice of the Web Storage API the store needs. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTheme(value: unknown): value is ThemePreference {
  return (THEMES as readonly unknown[]).includes(value);
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

export function isPlaybackSpeed(value: unknown): value is PlaybackSpeed {
  return (PLAYBACK_SPEEDS as readonly unknown[]).includes(value);
}

export function isLanguage(value: unknown): value is LanguageCode {
  return LANGUAGES.some((language) => language.available && language.code === value);
}

/** Valid fields of `value` over `base`; anything missing or invalid keeps the base value. */
export function sanitizeSettings(value: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  if (!isRecord(value)) return base;
  return {
    textSize: isTextSize(value.textSize) ? value.textSize : base.textSize,
    theme: isTheme(value.theme) ? value.theme : base.theme,
    playbackSpeed: isPlaybackSpeed(value.playbackSpeed) ? value.playbackSpeed : base.playbackSpeed,
    language: isLanguage(value.language) ? value.language : base.language,
  };
}

/**
 * Settings from the stored JSON. Version 1 is the only shape so far; a record without a version (or with another
 * one) is read field by field, so whatever is still valid survives and the rest falls back to the defaults.
 */
export function parseSettings(raw: string | null | undefined): Settings {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_SETTINGS;
  try {
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The JSON written to storage. */
export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, ...sanitizeSettings(settings) });
}

/** The browser's `localStorage`, or `null` during SSR or when the browser blocks it. */
export function browserStorage(scope: { localStorage?: SettingsStorage } = globalThis): SettingsStorage | null {
  try {
    return scope.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved settings, or the defaults when there are none or they cannot be read. */
export function loadSettings(storage: SettingsStorage | null): Settings {
  if (storage === null) return DEFAULT_SETTINGS;
  try {
    return parseSettings(storage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Saves `settings`; false when there is no storage or the write fails (quota, private mode). */
export function saveSettings(storage: SettingsStorage | null, settings: Settings): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeSettings(settings));
    return true;
  } catch {
    return false;
  }
}

/** Merges the valid fields of `patch` into the saved settings and saves them. */
export function updateSettings(
  storage: SettingsStorage | null,
  patch: Partial<Record<keyof Settings, unknown>>,
): { settings: Settings; saved: boolean } {
  const settings = sanitizeSettings(patch, loadSettings(storage));
  return { settings, saved: saveSettings(storage, settings) };
}

/** The settings page's state: changes build on the settings in memory, then are saved if storage allows. */
export interface SettingsSession {
  /** The settings now in effect, saved or not. */
  readonly current: Settings;
  /** Applies a form field change to `current` and tries to save the result. */
  change(name: string, value: string): { settings: Settings; saved: boolean };
}

/**
 * Starts from the saved settings and keeps them in memory, so that when storage is missing or refuses writes, each
 * change still builds on the earlier ones rather than on the defaults.
 */
export function createSettingsSession(storage: SettingsStorage | null): SettingsSession {
  let current = loadSettings(storage);
  return {
    get current() {
      return current;
    },
    change(name, value) {
      current = sanitizeSettings(fieldPatch(name, value), current);
      return { settings: current, saved: saveSettings(storage, current) };
    },
  };
}

/**
 * A form field's value as a settings patch: `playbackSpeed` is parsed as a number, unknown names give an empty
 * patch (and invalid values are dropped later by `sanitizeSettings`).
 */
export function fieldPatch(name: string, value: string): Partial<Record<keyof Settings, unknown>> {
  switch (name) {
    case 'textSize':
    case 'theme':
    case 'language':
      return { [name]: value };
    case 'playbackSpeed':
      return { playbackSpeed: Number(value) };
    default:
      return {};
  }
}

/** The element `applySettings` writes to (`document.documentElement`). */
export interface SettingsRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  readonly style: { fontSize: string };
}

/** The root font size for a text size, as a percentage of the browser default (`''` for the default size). */
export function fontSizeFor(textSize: TextSize): string {
  return textSize === 'default' ? '' : `${TEXT_SIZES[textSize] * 100}%`;
}

/** Applies the theme and text size to the root element. */
export function applySettings(root: SettingsRoot, settings: Pick<Settings, 'theme' | 'textSize'>): void {
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-text-size', settings.textSize);
  root.style.fontSize = fontSizeFor(settings.textSize);
}

/**
 * An inline `<head>` script that applies the saved theme and text size before first paint: no imports, no globals
 * beyond `document` and `localStorage`, and silent on any error (the page then renders with the defaults).
 */
export function headScript(): string {
  const sizes = Object.fromEntries(TEXT_SIZE_NAMES.map((name) => [name, fontSizeFor(name)]));
  return [
    '(function(){try{',
    `var s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||'{}')||{};`,
    'var r=document.documentElement;',
    `if(s.theme==='light'||s.theme==='dark')r.setAttribute('data-theme',s.theme);`,
    `var z=${JSON.stringify(sizes)};`,
    'if(typeof s.textSize==="string"&&Object.prototype.hasOwnProperty.call(z,s.textSize)){',
    'r.setAttribute("data-text-size",s.textSize);r.style.fontSize=z[s.textSize];}',
    '}catch(e){}})();',
  ].join('');
}

/** The slice of Cache Storage that offline data lives in (`globalThis.caches`). */
export interface OfflineCaches {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/**
 * Caches whose names start with this hold offline reading data (saved days, audio); they are what "Clear offline
 * data" removes. The PWA (L-061) names its app-shell precache without it, so clearing never breaks the shell.
 */
export const OFFLINE_DATA_CACHE_PREFIX = 'lectio-data-';

export type ClearOfflineResult =
  | { readonly status: 'cleared'; readonly count: number }
  | { readonly status: 'unsupported' }
  | { readonly status: 'failed' };

/**
 * Deletes the offline data caches, those whose names start with `prefix`. Settings and every other cache (the app
 * shell) are kept. `unsupported` when the browser has no Cache Storage.
 */
export async function clearOfflineData(
  prefix: string = OFFLINE_DATA_CACHE_PREFIX,
  caches: OfflineCaches | undefined = (globalThis as { caches?: OfflineCaches }).caches,
): Promise<ClearOfflineResult> {
  if (caches === undefined) return { status: 'unsupported' };
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
    const deleted = await Promise.all(names.map((name) => caches.delete(name)));
    return { status: 'cleared', count: deleted.filter(Boolean).length };
  } catch {
    return { status: 'failed' };
  }
}
