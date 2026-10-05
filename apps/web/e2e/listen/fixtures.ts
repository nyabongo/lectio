/**
 * Fixtures for the Listen e2e suite (L-085): a tiny WAV file, a day API document with segment audio, and a stub of
 * the Web Speech API, so the suite never depends on a real voice (or on the narration files the deploy renders).
 */
import type { Page, Route } from '@playwright/test';

/** Where the suite serves its narration files, under the preview's base path (answered by `page.route`). */
export const AUDIO_PREFIX = '/lectio/__e2e__/audio/';

/** A mono 16-bit PCM WAV of `seconds` of a quiet tone: small, and decodable by every browser. */
export function wav(seconds = 0.6, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 800), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Serves `<AUDIO_PREFIX>present.wav` and answers 404 for any other file there. */
export async function serveAudio(page: Page): Promise<void> {
  const file = wav();
  await page.route(`**${AUDIO_PREFIX}*`, (route: Route) =>
    route.request().url().endsWith('/present.wav')
      ? route.fulfill({ status: 200, contentType: 'audio/wav', body: file })
      : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }),
  );
}

/** The audio each segment id gets: a URL under `AUDIO_PREFIX`, or `null` (device speech). */
export type SegmentAudio = Readonly<Record<string, string | null>>;

/**
 * Answers the day API document for `path` (e.g. `api/v1/days/2026-09-20.json`) with the built one plus a
 * `segments` list (L-082's shape) for the first Mass: one entry per id in `audio`, in that order.
 */
export async function routeDay(page: Page, path: string, locale: string, audio: SegmentAudio): Promise<void> {
  await page.route(`**/lectio/${path}`, async (route) => {
    const response = await route.fetch();
    const document = (await response.json()) as { masses: Record<string, unknown>[] };
    const segments = Object.entries(audio).map(([id, file]) => ({
      id,
      locale,
      audio: file === null ? null : { url: `${AUDIO_PREFIX}${file}`, durationSeconds: null },
    }));
    document.masses = document.masses.map((mass, i) => ({ ...mass, segments: i === 0 ? segments : [] }));
    await route.fulfill({ response, json: document });
  });
}

/** What the stubbed `speechSynthesis` was asked to say. */
export interface Spoken {
  readonly text: string;
  readonly lang: string;
  readonly rate: number;
  readonly voice: string | null;
}

/**
 * Replaces `speechSynthesis` and `SpeechSynthesisUtterance` before any page script runs. Each utterance "speaks"
 * for `ms` milliseconds, then ends; `cancel()` raises `interrupted`, as Chromium does. What was said is kept in
 * `window.__spoken`.
 */
export async function stubSpeech(page: Page, ms = 150): Promise<void> {
  await page.addInitScript((duration: number) => {
    interface FakeUtterance {
      text: string;
      lang: string;
      rate: number;
      voice: { name: string } | null;
      onend: ((event: unknown) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onboundary: ((event: { charIndex: number }) => void) | null;
    }
    const spoken: unknown[] = [];
    let current: FakeUtterance | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const voices = [
      { name: 'Stub English', lang: 'en-GB', localService: true, default: true },
      { name: 'Stub Kiswahili', lang: 'sw-KE', localService: true, default: false },
    ];
    const synth = {
      getVoices: () => voices,
      speak(utterance: FakeUtterance) {
        spoken.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          voice: utterance.voice?.name ?? null,
        });
        current = utterance;
        timer = setTimeout(() => {
          if (current !== utterance) return;
          current = null;
          utterance.onboundary?.({ charIndex: Math.floor(utterance.text.length / 2) });
          utterance.onend?.({});
        }, duration);
      },
      cancel() {
        const utterance = current;
        current = null;
        clearTimeout(timer);
        utterance?.onerror?.({ error: 'interrupted' });
      },
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
    };
    class Utterance {
      lang = '';
      rate = 1;
      voice = null;
      onend = null;
      onerror = null;
      onboundary = null;
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
    Object.defineProperty(window, '__spoken', { value: spoken, configurable: true });
  }, ms);
}

/** Everything the stubbed voice was asked to say so far. */
export function spoken(page: Page): Promise<Spoken[]> {
  return page.evaluate(() => (window as unknown as { __spoken: Spoken[] }).__spoken);
}
