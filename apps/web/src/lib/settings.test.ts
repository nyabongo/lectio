import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  PLAYBACK_SPEEDS,
  SETTINGS_VERSION,
  STORAGE_KEY,
  TEXT_SIZE_NAMES,
  THEMES,
  applySettings,
  browserStorage,
  clearOfflineData,
  fieldPatch,
  fontSizeFor,
  headScript,
  isLanguage,
  isPlaybackSpeed,
  isTextSize,
  isTheme,
  loadSettings,
  parseSettings,
  sanitizeSettings,
  saveSettings,
  serializeSettings,
  updateSettings,
} from './settings.ts';
import type { OfflineCaches, Settings, SettingsRoot, SettingsStorage } from './settings.ts';

/** An in-memory Web Storage, shared across "page loads" the way localStorage is. */
class FakeStorage implements SettingsStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const throwingStorage: SettingsStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

class FakeRoot implements SettingsRoot {
  readonly attributes = new Map<string, string>();
  readonly style = { fontSize: '' };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

const custom: Settings = { textSize: 'larger', theme: 'dark', playbackSpeed: 1.5, language: 'en' };

describe('settings store', () => {
  it('persists settings across reloads', () => {
    const storage = new FakeStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(storage, custom)).toBe(true);
    // A reload reads the same storage afresh.
    expect(loadSettings(storage)).toEqual(custom);
    const { settings, saved } = updateSettings(storage, { theme: 'light' });
    expect(saved).toBe(true);
    expect(settings).toEqual({ ...custom, theme: 'light' });
    expect(loadSettings(storage)).toEqual({ ...custom, theme: 'light' });
  });

  it('writes a versioned record under its key', () => {
    const storage = new FakeStorage();
    saveSettings(storage, custom);
    expect(JSON.parse(storage.items.get(STORAGE_KEY) ?? '')).toEqual({ version: SETTINGS_VERSION, ...custom });
    expect(serializeSettings(custom)).toBe(storage.items.get(STORAGE_KEY));
  });

  it('ignores invalid fields in an update and keeps the saved ones', () => {
    const storage = new FakeStorage();
    saveSettings(storage, custom);
    const { settings } = updateSettings(storage, {
      theme: 'neon',
      playbackSpeed: 3,
      language: 'sw',
      textSize: 'small',
    });
    expect(settings).toEqual({ ...custom, textSize: 'small' });
  });

  it('is SSR-safe: no storage reads the defaults and cannot save', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(null, custom)).toBe(false);
    expect(updateSettings(null, { theme: 'dark' })).toEqual({
      settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
      saved: false,
    });
  });

  it('survives storage that throws on read and write', () => {
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwingStorage, custom)).toBe(false);
  });

  it('tolerates corrupted data', () => {
    for (const raw of [null, undefined, '', '{', 'null', '42', '"dark"', '[1,2]', 'true']) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, 'not json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the valid fields of a partly broken, unversioned or newer record', () => {
    expect(parseSettings(JSON.stringify({ theme: 'dark', textSize: 12, playbackSpeed: '1.5' }))).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
    });
    expect(parseSettings(JSON.stringify({ version: 99, textSize: 'large', language: 'fr' }))).toEqual({
      ...DEFAULT_SETTINGS,
      textSize: 'large',
    });
    // An inherited key is not a text size.
    expect(parseSettings(JSON.stringify({ textSize: 'toString' }))).toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizes over a base', () => {
    expect(sanitizeSettings('x', custom)).toBe(custom);
    expect(sanitizeSettings({ playbackSpeed: 0.75 }, custom)).toEqual({ ...custom, playbackSpeed: 0.75 });
  });

  it('validates each field against its options', () => {
    expect(THEMES.every(isTheme)).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(TEXT_SIZE_NAMES.every(isTextSize)).toBe(true);
    expect(isTextSize(1)).toBe(false);
    expect(PLAYBACK_SPEEDS.every(isPlaybackSpeed)).toBe(true);
    expect(isPlaybackSpeed(1.1)).toBe(false);
    expect(isLanguage('en')).toBe(true);
    // Swahili is listed as coming soon, so it cannot be chosen yet.
    expect(LANGUAGES.find((language) => language.code === 'sw')?.available).toBe(false);
    expect(isLanguage('sw')).toBe(false);
  });

  it('turns form fields into patches', () => {
    expect(fieldPatch('theme', 'dark')).toEqual({ theme: 'dark' });
    expect(fieldPatch('textSize', 'large')).toEqual({ textSize: 'large' });
    expect(fieldPatch('language', 'en')).toEqual({ language: 'en' });
    expect(fieldPatch('playbackSpeed', '1.25')).toEqual({ playbackSpeed: 1.25 });
    expect(fieldPatch('other', 'x')).toEqual({});
  });
});

describe('browserStorage', () => {
  it('returns localStorage when there is one', () => {
    const storage = new FakeStorage();
    expect(browserStorage({ localStorage: storage })).toBe(storage);
  });

  it('returns null during SSR or when access throws', () => {
    expect(browserStorage({})).toBeNull();
    const blocked = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(browserStorage(blocked)).toBeNull();
    // The default scope is globalThis: whatever the runtime offers, it never throws.
    expect(() => browserStorage()).not.toThrow();
  });
});

describe('applySettings', () => {
  it('sets the theme and text size on the root', () => {
    const root = new FakeRoot();
    applySettings(root, { theme: 'dark', textSize: 'large' });
    expect(root.attributes.get('data-theme')).toBe('dark');
    expect(root.attributes.get('data-text-size')).toBe('large');
    expect(root.style.fontSize).toBe('112.5%');
  });

  it('leaves the scheme to the system and the size to the browser by default', () => {
    const root = new FakeRoot();
    applySettings(root, { theme: 'light', textSize: 'small' });
    applySettings(root, DEFAULT_SETTINGS);
    expect(root.attributes.has('data-theme')).toBe(false);
    expect(root.attributes.get('data-text-size')).toBe('default');
    expect(root.style.fontSize).toBe('');
  });

  it('scales the root font size for each text size', () => {
    expect(TEXT_SIZE_NAMES.map(fontSizeFor)).toEqual(['90%', '', '112.5%', '125%']);
  });
});

describe('headScript', () => {
  function run(storage: Partial<SettingsStorage>): FakeRoot {
    const root = new FakeRoot();
    new Function('document', 'localStorage', headScript())({ documentElement: root }, storage);
    return root;
  }

  it('applies the saved theme and text size, matching applySettings', () => {
    const storage = new FakeStorage();
    saveSettings(storage, custom);
    const root = run(storage);
    const expected = new FakeRoot();
    applySettings(expected, custom);
    expect(root.attributes).toEqual(expected.attributes);
    expect(root.style).toEqual(expected.style);
  });

  it('leaves the page alone without valid saved settings', () => {
    for (const raw of [null, 'null', '{}', '{"theme":"system","textSize":"toString"}']) {
      const root = run({ getItem: () => raw });
      expect(root.attributes.size).toBe(0);
      expect(root.style.fontSize).toBe('');
    }
  });

  it('swallows broken JSON and throwing storage', () => {
    expect(run({ getItem: () => '{' }).attributes.size).toBe(0);
    expect(run(throwingStorage).attributes.size).toBe(0);
  });
});

describe('clearOfflineData', () => {
  it('deletes every cache', async () => {
    const names = new Set(['lectio-precache', 'lectio-days', 'audio']);
    const caches: OfflineCaches = {
      keys: () => Promise.resolve([...names, 'gone']),
      delete: (name) => Promise.resolve(names.delete(name)),
    };
    expect(await clearOfflineData(caches)).toEqual({ status: 'cleared', count: 3 });
    expect(names.size).toBe(0);
  });

  it('reports a browser without Cache Storage', async () => {
    expect(await clearOfflineData(undefined)).toEqual({ status: 'unsupported' });
    // Node has no Cache Storage, so the default is unsupported here.
    expect(await clearOfflineData()).toEqual({ status: 'unsupported' });
  });

  it('reports a failure', async () => {
    const caches: OfflineCaches = {
      keys: () => Promise.reject(new Error('denied')),
      delete: () => Promise.resolve(true),
    };
    expect(await clearOfflineData(caches)).toEqual({ status: 'failed' });
  });
});
