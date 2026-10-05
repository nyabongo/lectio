/**
 * Checks on the committed index `corpus/guard/en-pd-8.bin` (built by `npm run guard:build`).
 * The samples are the shingle keys the builder recorded from World English Bible verses (the
 * same keys the index holds), so no verse text, word or per-word hash lives in this
 * repository, tests included.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GuardManifest } from './build.ts';
import { loadIndex } from './index-file.ts';
import { NORMALISER_VERSION } from './normalise.ts';
import { longestRun, longestRunOfKeys } from './run.ts';

const guardDir = new URL('../../../corpus/guard/', import.meta.url);
const bytes = new Uint8Array(readFileSync(new URL('en-pd-8.bin', guardDir)));
const manifestText = readFileSync(new URL('SOURCE.json', guardDir), 'utf8');
const manifest = JSON.parse(manifestText) as GuardManifest;
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const index = loadIndex(bytes);

// Original commentary prose written for this test (not quoted from any translation or commentary).
const COMMENTARY = [
  'Luke frames this scene as a meal that goes wrong in an instructive way: the host keeps score, the guest ' +
    'keeps nothing back, and the narrator lets the contrast do the arguing.',
  'The Greek verb here suggests a debt written off rather than a fault overlooked, which is why the parable ' +
    'of the two debtors sits so naturally beside it.',
  'Readers in a Kenyan parish will recognise the dynamics of hospitality at a funeral or a harambee, where ' +
    'who serves whom says more than any speech.',
  'Paul writes to a community he founded and misses, and the warmth of his opening greetings is part of the ' +
    'argument he is about to make about unity.',
].join(' ');

describe('committed guard index', () => {
  it('stores no English text: no printable ASCII run longer than 20 bytes', () => {
    let run = 0;
    let longest = 0;
    for (const byte of bytes) {
      run = byte >= 0x20 && byte <= 0x7e ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(20);
  });

  it('is at most 20 MB (5 MB target) and matches SOURCE.json', () => {
    expect(bytes.length).toBeLessThanOrEqual(20 * 1024 * 1024);
    expect(bytes.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(manifest.format.keyBits).toBe(40);
    expect(manifest.format.falsePositiveRate).toBeLessThan(1e-5);
    expect(manifest.bytes).toBe(bytes.length);
    expect(manifest.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(manifest.shingles).toBe(index.size);
    expect(manifest.shingleSize).toBe(8);
    expect(index.shingleSize).toBe(8);
    expect(index.normaliserVersion).toBe(NORMALISER_VERSION);
    expect(manifest.editions.map((e) => [e.id, e.licence])).toEqual([
      ['eng-web', 'Public Domain'],
      ['engDRA', 'Public Domain'],
    ]);
  });

  it('finds every recorded 15-word World English Bible sample as a run of at least 15 words', () => {
    const webSamples = manifest.selfCheck.filter((s) => s.source === 'eng-web');
    expect(webSamples.length).toBeGreaterThanOrEqual(5);
    for (const sample of manifest.selfCheck) {
      expect(sample.shingleKeys).toHaveLength(15 - 8 + 1);
      const keys = sample.shingleKeys.map((hex) => parseInt(hex, 16));
      expect(longestRunOfKeys(keys, index).words).toBeGreaterThanOrEqual(15);
    }
  });

  it('records no words or per-word hashes in SOURCE.json', () => {
    expect(manifestText).not.toContain('wordHashes');
    // Per-word FNV-1a 64 hashes would be 16 hex digits; shingle keys are 10.
    expect(manifestText).not.toMatch(/"[0-9a-f]{16}"/);
    for (const sample of manifest.selfCheck) {
      expect(Object.keys(sample).sort()).toEqual(['book', 'chapter', 'longestRun', 'shingleKeys', 'source']);
      for (const key of sample.shingleKeys) expect(key).toMatch(/^[0-9a-f]{10}$/);
    }
  });

  it('gives original commentary prose a run shorter than 8 words, on an index that really discriminates', () => {
    // Controls, so an empty, truncated or always-true index fails here too.
    expect(index.size).toBeGreaterThan(1_000_000);
    const sample = manifest.selfCheck[0]!.shingleKeys.map((hex) => parseInt(hex, 16));
    expect(sample.every((key) => index.has(key))).toBe(true);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (index.has(Math.floor(((i + 0.5) / 10_000) * 2 ** 40) + 12_345)) hits++;
    expect(hits).toBeLessThanOrEqual(1);
    // Commentary that borrows a 15-word WEB sample keeps it as a run; the original prose has none.
    expect(longestRunOfKeys([...sample.slice(0, 3), 1, ...sample], index).words).toBe(15);
    expect(longestRun(COMMENTARY, index).words).toBeLessThan(8);
  });

  it('documents its limitation', () => {
    expect(manifest.limitation).toMatch(/only detects overlap with World English Bible and Douay-Rheims/);
    expect(readme).toContain('only detects overlap with World English Bible and Douay-Rheims wording');
    expect(readme).toMatch(/NABRE, RSV-2CE, Jerusalem Bible/);
  });
});
