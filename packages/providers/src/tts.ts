import { ProviderError } from './errors.ts';
import { seededRandom } from './hash.ts';

export type TtsFormat = 'wav' | 'mp3';

export interface TtsRequest {
  /** Plain text to speak (commentary only; never a translation's reading text). */
  readonly text: string;
  /** Provider voice name (from `config.tts.voices`). */
  readonly voice: string;
  readonly format: TtsFormat;
}

export interface TtsResult {
  readonly audio: Uint8Array;
  readonly format: TtsFormat;
  readonly contentType: string;
  readonly durationMs: number;
  /** Characters billed for this request. */
  readonly characters: number;
}

export interface TtsProvider {
  /** The formats this provider can produce. */
  readonly formats: readonly TtsFormat[];
  synthesize(request: TtsRequest): Promise<TtsResult>;
}

/** Samples per second of the fake's audio: low, so files stay tiny. */
export const FAKE_TTS_SAMPLE_RATE = 1000;
/** Milliseconds of fake audio per character of text. */
export const FAKE_TTS_MS_PER_CHAR = 50;

/**
 * Deterministic text-to-speech double: an 8-bit mono WAV whose length follows the
 * text and whose samples are derived from (voice, text). Identical input, identical bytes.
 */
export class FakeTtsProvider implements TtsProvider {
  readonly formats: readonly TtsFormat[] = ['wav'];
  readonly requests: TtsRequest[] = [];

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    this.requests.push(request);
    if (request.format !== 'wav') {
      throw new ProviderError('unsupported', `the fake TTS provider only produces wav, not ${request.format}`);
    }
    if (request.text.trim() === '') throw new ProviderError('invalid-request', 'nothing to synthesize');
    const characters = [...request.text].length;
    const durationMs = characters * FAKE_TTS_MS_PER_CHAR;
    const samples = (durationMs * FAKE_TTS_SAMPLE_RATE) / 1000;
    const random = seededRandom(`${request.voice}\n${request.text}`);
    const pcm = Uint8Array.from({ length: samples }, () => 96 + Math.floor(random() * 64));
    return { audio: wav(pcm, FAKE_TTS_SAMPLE_RATE), format: 'wav', contentType: 'audio/wav', durationMs, characters };
  }
}

/** A RIFF/WAVE file around 8-bit mono PCM. */
export function wav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
