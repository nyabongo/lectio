/**
 * Rendering tests: dimensions, size budget, determinism, Hebrew right-to-left layout and a
 * pixelmatch comparison against committed goldens.
 *
 * After an intentional design change, regenerate the goldens and review them by eye:
 *   UPDATE_GOLDEN=1 npx vitest run --project @lectio/sharecards
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import type { ShareCard } from './cards.ts';
import { dayFixture, hebrewInsightFixture, insightFixture, readingFixture } from './fixtures/cards.ts';
import { loadFonts } from './fonts.ts';
import { MAX_PNG_BYTES, renderCard, renderCardSvg, renderNodeSvg, svgToPng } from './render.ts';
import { CARD_HEIGHT, CARD_WIDTH, el, originalNode } from './templates.ts';
import type { CardNode } from './templates.ts';

const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/golden/', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
/** Per-pixel colour tolerance (pixelmatch's YIQ threshold) and the share of pixels allowed to differ. */
const PIXEL_THRESHOLD = 0.1;
const MAX_DIFF_RATIO = 0.002;

const goldens: readonly (readonly [string, ShareCard])[] = [
  ['day', dayFixture],
  ['reading', readingFixture],
  ['insight', insightFixture],
  ['insight-hebrew', hebrewInsightFixture],
];

function decode(png: Buffer): PNG {
  return PNG.sync.read(png);
}

/** Number of pixels that differ beyond the tolerance. */
function diffPixels(a: PNG, b: PNG): number {
  return pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: PIXEL_THRESHOLD });
}

describe('renderCard', () => {
  describe.each(goldens)('%s card', (name, card) => {
    it('is a 1200×630 PNG within the size budget that matches its golden', async () => {
      const png = await renderCard(card);
      const image = decode(png);
      expect([image.width, image.height]).toEqual([1200, 630]);
      expect(png.length).toBeLessThanOrEqual(MAX_PNG_BYTES);

      const goldenPath = `${GOLDEN_DIR}${name}.png`;
      if (UPDATE || !existsSync(goldenPath)) {
        // A missing golden fails the run (below) so CI never passes without one.
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(goldenPath, png);
        expect.soft(UPDATE, `wrote missing golden ${goldenPath}; review it and commit`).toBe(true);
        return;
      }
      const golden = decode(readFileSync(goldenPath));
      expect([golden.width, golden.height]).toEqual([image.width, image.height]);
      expect(diffPixels(image, golden)).toBeLessThanOrEqual(Math.floor(CARD_WIDTH * CARD_HEIGHT * MAX_DIFF_RATIO));
    });
  });

  it('is deterministic: the same card renders to identical bytes', async () => {
    const [first, second] = await Promise.all([renderCard(insightFixture), renderCard(insightFixture)]);
    expect(first.equals(second)).toBe(true);
  });

  it('draws text as paths, so the PNG does not depend on installed fonts', async () => {
    const svg = await renderCardSvg(dayFixture);
    expect(svg).toMatch(/^<svg[^>]+width="1200"[^>]+height="630"/);
    expect(svg).not.toContain('<text');
  });

  it('accepts explicit fonts', async () => {
    const fonts = await loadFonts();
    expect(await renderCardSvg(readingFixture, { fonts })).toBe(await renderCardSvg(readingFixture));
  });

  it('throws when the PNG exceeds the size budget', async () => {
    await expect(renderCard(dayFixture, { maxBytes: 1000 })).rejects.toThrow(
      /day card for https:\/\/lectio\.example\/2026-09-20 is \d+ bytes, over the 1000-byte budget/,
    );
  });

  it('renders the transliteration when Hebrew is forced off', async () => {
    const visual = decode(await renderCard(hebrewInsightFixture));
    const translit = decode(await renderCard(hebrewInsightFixture, { hebrew: 'transliteration' }));
    expect([translit.width, translit.height]).toEqual([1200, 630]);
    expect(diffPixels(visual, translit)).toBeGreaterThan(0);
  });

  it('keeps every field inside the card however long the input', async () => {
    const long = 'Extraordinarily long words keep coming '.repeat(20);
    const card: ShareCard = {
      ...insightFixture,
      quote: long,
      caption: long,
      url: `https://lectio.example/${'x'.repeat(200)}`,
    };
    const png = await renderCard(card);
    expect(decode(png).width).toBe(1200);
  });
});

describe('Hebrew right-to-left rendering', () => {
  const [width, height] = [500, 120];
  const box = { width, height, backgroundColor: '#fff' };
  const render = async (node: CardNode) => decode(svgToPng(await renderNodeSvg(node, width, height)));
  const hebrew = (value: string) => el({ fontFamily: "'Noto Serif Hebrew'", fontSize: 40 }, value);

  /** Widths of the runs of inked columns, left to right (a run ends at a fully blank column). */
  function inkRuns(image: PNG): number[] {
    const runs: number[] = [];
    let run = 0;
    for (let x = 0; x < image.width; x += 1) {
      let inked = false;
      for (let y = 0; y < image.height && !inked; y += 1) inked = (image.data[(y * image.width + x) * 4] ?? 255) < 128;
      if (inked) run += 1;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    return runs;
  }

  /** Widths of the blank stretches between inked runs, left to right. */
  function inkGaps(image: PNG): number[] {
    const gaps: number[] = [];
    let gap = -1;
    for (let x = 0; x < image.width; x += 1) {
      let inked = false;
      for (let y = 0; y < image.height && !inked; y += 1) inked = (image.data[(y * image.width + x) * 4] ?? 255) < 128;
      if (inked) {
        if (gap > 0) gaps.push(gap);
        gap = 0;
      } else if (gap >= 0) gap += 1;
    }
    return gaps;
  }

  /** Ink width of one letter rendered on its own. */
  async function letterWidth(letter: string): Promise<number> {
    const runs = inkRuns(await render(el(box, hebrew(letter))));
    expect(runs).toHaveLength(1);
    return runs[0] ?? 0;
  }

  /**
   * The letters of a rendered line, left to right, told apart by ink width (alef is wide,
   * gimel narrow; anti-aliasing can move a width by a pixel).
   */
  async function lettersOf(node: CardNode): Promise<string> {
    const [alef, gimel] = [await letterWidth('א'), await letterWidth('ג')];
    expect(alef).toBeGreaterThan(gimel + 4);
    const runs = inkRuns(await render(el(box, node)));
    return runs.map((run) => (Math.abs(run - alef) < Math.abs(run - gimel) ? 'א' : 'ג')).join('');
  }

  it('satori alone shapes one word right to left but lays several words out left to right', async () => {
    expect(await lettersOf(hebrew('אג'))).toBe('גא');
    // Wrong for Hebrew: the first word should be on the right. This is why the card places words itself.
    expect(await lettersOf(hebrew('א גג'))).toBe('אגג');
  });

  it('the card draws the first letter of a word rightmost', async () => {
    expect(await lettersOf(originalNode({ text: 'אג', language: 'hbo' }))).toBe('גא');
  });

  it('the card draws the first word rightmost, with a space between words', async () => {
    const node = originalNode({ text: 'א גג', language: 'hbo' });
    expect(await lettersOf(node)).toBe('גגא');
    const gaps = inkGaps(await render(el(box, node)));
    expect(gaps[1]).toBeGreaterThan((gaps[0] ?? 0) + 8);
  });
});
