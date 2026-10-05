import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCENTS, BASE_PALETTE, DEFAULT_COLOUR } from '../lib/theme.ts';

const publicDir = new URL('../../public/', import.meta.url);

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', publicDir), 'utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  id: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const png = readFileSync(fileURLToPath(new URL(path, publicDir)));
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('public/manifest.webmanifest', () => {
  it('names the app and opens standalone at the base path (URLs resolve against the manifest)', () => {
    expect(manifest.name).toBe('Lectio');
    expect(manifest.short_name).toBe('Lectio');
    expect(manifest.display).toBe('standalone');
    const at = 'https://nyabongo.github.io/lectio/manifest.webmanifest';
    expect(new URL(manifest.start_url, at).href).toBe('https://nyabongo.github.io/lectio/');
    expect(new URL(manifest.scope, at).href).toBe('https://nyabongo.github.io/lectio/');
    expect(new URL(manifest.id, at).href).toBe('https://nyabongo.github.io/lectio/');
  });

  it('uses the site palette', () => {
    expect(manifest.theme_color).toBe(ACCENTS.light[DEFAULT_COLOUR].accent);
    expect(manifest.background_color).toBe(BASE_PALETTE.light.bg);
  });

  it('lists 192 and 512 icons, a maskable one, and every PNG has its stated size', () => {
    const pngs = manifest.icons.filter((icon) => icon.type === 'image/png');
    expect(pngs.map((icon) => [icon.sizes, icon.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
    for (const icon of pngs) {
      const [width, height] = pngSize(icon.src);
      expect(`${String(width)}x${String(height)}`).toBe(icon.sizes);
    }
    expect(pngSize('icons/apple-touch-icon.png')).toEqual([180, 180]);
    const svg = manifest.icons.find((icon) => icon.type === 'image/svg+xml');
    expect(readFileSync(new URL(svg?.src ?? '', publicDir), 'utf8')).toContain('<svg');
  });
});
