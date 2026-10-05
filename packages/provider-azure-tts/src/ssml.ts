/**
 * SSML documents for Azure AI Speech. Text is always escaped, so narration can never
 * inject markup (or break the request) with `<`, `&` or quotes.
 */
import { ProviderError } from '@lectio/providers';

/** Characters XML 1.0 forbids anywhere in a document (C0 controls other than tab, LF, CR; U+FFFE/U+FFFF). */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Removes characters XML forbids, which Azure would otherwise reject the whole request for. */
export function stripInvalidXmlChars(text: string): string {
  return text.replace(INVALID_XML_CHARS, '');
}

/** Escapes text for use in SSML element content or attribute values, dropping characters XML forbids. */
export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text).replace(/[&<>"']/g, (char) => ENTITIES[char] as string);
}

/** An Azure neural voice name: `<language>-<region>-<Name>`, for example `en-KE-AsiliaNeural`. */
const VOICE_NAME = /^([a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2})-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/**
 * The BCP 47 locale of an Azure voice name (`en-KE-AsiliaNeural` → `en-KE`), with its script
 * subtag when it has one (`sr-Latn-RS-NicholasNeural` → `sr-Latn-RS`).
 */
export function voiceLocale(voice: string): string {
  const match = VOICE_NAME.exec(voice);
  if (!match) {
    throw new ProviderError(
      'invalid-request',
      `not an Azure voice name: "${voice}" (expected e.g. en-KE-AsiliaNeural)`,
    );
  }
  return match[1] as string;
}

/** One `<speak>` document that reads `text` (plain text, escaped here) with `voice`. */
export function buildSsml(text: string, voice: string): string {
  const locale = voiceLocale(voice);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${escapeXml(voice)}">${escapeXml(text)}</voice>` +
    `</speak>`
  );
}
