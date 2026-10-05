/**
 * Post-build check of the share images (L-088) on the fixture build: day, reading and insight pages carry Open Graph
 * tags with an absolute `og:image` and its size and alt text, and each image is served from the build as a
 * 1200×630 PNG of at most 300 KB. The `og:image` URLs name the configured site; the check fetches the same path
 * from the preview server. (The build itself also checks every page: src/integrations/og.ts.)
 */
import { BUILD_DATE, expect, test } from './fixtures.ts';

const MAX_BYTES = 300 * 1024;

const pages = [
  { name: 'day', path: `${BUILD_DATE}/`, image: `og/${BUILD_DATE}.png`, type: 'website' },
  { name: 'reading', path: `${BUILD_DATE}/gospel/`, image: `og/${BUILD_DATE}/gospel.png`, type: 'article' },
  {
    name: 'insight',
    path: `${BUILD_DATE}/gospel/notes/v15-evil-eye/`,
    image: `og/${BUILD_DATE}/gospel/v15-evil-eye.png`,
    type: 'article',
  },
  // No approved notes yet: the page shares its day's card.
  { name: 'pending reading', path: `${BUILD_DATE}/first-reading/`, image: `og/${BUILD_DATE}.png`, type: 'article' },
];

/** `<meta property|name="key" content="…">` values of a document. */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)) {
    tags.set(match[1] ?? '', (match[2] ?? '').replaceAll('&amp;', '&'));
  }
  return tags;
}

for (const { name, path, image, type } of pages) {
  test(`og: ${name} page has its share image`, async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the images do not depend on the viewport');
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const tags = metaTags(await response.text());

    expect(tags.get('og:type')).toBe(type);
    expect(tags.get('og:title')).toBeTruthy();
    expect(tags.get('og:description')).toBeTruthy();
    expect(tags.get('og:url')).toMatch(new RegExp(`^https?://[^/]+/(?:.+/)?${path}$`));
    expect(tags.get('twitter:card')).toBe('summary_large_image');
    expect(tags.get('og:image:width')).toBe('1200');
    expect(tags.get('og:image:height')).toBe('630');
    expect(tags.get('og:image:alt')).toMatch(/^Lectio card for /);

    const url = new URL(tags.get('og:image') ?? '');
    expect(url.protocol).toMatch(/^https?:$/);
    expect(url.pathname.endsWith(`/${image}`)).toBe(true);

    const png = await request.get(url.pathname);
    expect(png.ok()).toBe(true);
    expect(png.headers()['content-type']).toContain('image/png');
    const body = await png.body();
    expect(body.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(body.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(body.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]);
  });
}
