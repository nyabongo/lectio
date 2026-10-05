/**
 * Narration in the static API (L-082). The e2e build reads the fixture audio manifest (LECTIO_AUDIO_MANIFEST in
 * playwright.config.ts), so the day document carries segment lists with audio URLs, each backed by a tiny WAV file
 * in test/fixtures/audio. The player itself is L-085.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD_DATE, expect, test } from './fixtures.ts';

const AUDIO_HOST = 'https://audio.lectio.test/audio/';
const FIXTURE_AUDIO = join(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/audio');

interface Audio {
  readonly url: string;
  readonly durationSeconds: number | null;
}

interface Segment {
  readonly id: string;
  readonly kind: string;
  readonly script: string;
  readonly audio: Audio | null;
}

interface Day {
  readonly masses: readonly { readonly segments: readonly Segment[] }[];
}

test('the day API lists the Listen queue with an audio file for every segment', async ({ request }) => {
  const response = await request.get(`api/v1/days/${BUILD_DATE}.json`);
  expect(response.status()).toBe(200);
  const day = (await response.json()) as Day;
  const segments = day.masses.flatMap((mass) => mass.segments);
  expect(segments.map((segment) => segment.kind)).toEqual(['context', 'translation-note', 'translation-note']);
  for (const segment of segments) {
    expect(segment.script.length).toBeGreaterThan(0);
    const url = segment.audio?.url ?? '';
    expect(url.startsWith(AUDIO_HOST), `${segment.id} has an audio URL`).toBe(true);
    expect(existsSync(join(FIXTURE_AUDIO, url.slice(AUDIO_HOST.length))), `${url} is a fixture file`).toBe(true);
  }
});

test('a day without approved notes has an empty queue', async ({ request }) => {
  const day = (await (await request.get('api/v1/days/2026-09-19.json')).json()) as Day;
  expect(day.masses.flatMap((mass) => mass.segments)).toEqual([]);
});
