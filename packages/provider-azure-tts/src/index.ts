/**
 * @lectio/provider-azure-tts: the Azure AI Speech `TtsProvider` (L-083).
 *
 * Not registered in `createProviders`; the deploy pipeline (L-082) injects it when the
 * secrets are present: `createProviders(config, env, { tts: azureTts })`.
 */
export const packageName = '@lectio/provider-azure-tts';

export {
  AZURE_MP3_BITRATE,
  AZURE_OUTPUT_FORMAT,
  AZURE_SPEECH_KEY_ENV,
  AZURE_SPEECH_REGION_ENV,
  AzureTtsProvider,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_CHUNK_CHARS_LIMIT,
  azureTts,
  azureTtsEndpoint,
  azureTtsFromEnv,
  errorForStatus,
  hasAzureTtsSecrets,
  mp3DurationMs,
  retryAfterMs,
  voiceFor,
} from './client.ts';
export type { AzureTtsOptions } from './client.ts';
export { chunkText, codePointLength } from './chunk.ts';
export { buildSsml, escapeXml, stripInvalidXmlChars, voiceLocale } from './ssml.ts';
