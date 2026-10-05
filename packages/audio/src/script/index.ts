/** Narration script builder (L-080): the Listen queue's segments and their audio keys. */
export { AUDIO_EXTENSION, AUDIO_KEY_VERSION, AUDIO_PREFIX, audioKey } from './key.ts';
export type { AudioKey } from './key.ts';
export { NARRATION_STRINGS, SEGMENT_KINDS, buildSegments, narrationStrings, passagesOf } from './segments.ts';
export type {
  BuildSegmentsOptions,
  NarrationDay,
  NarrationSegment,
  NarrationStrings,
  OriginalLanguage,
  PassageLookup,
  SegmentKind,
} from './segments.ts';
export { asSentence, speakOriginals, speakReferences, speakable, stripClaimMarkers, stripUrls, tidy } from './text.ts';
export type { Transliteration } from './text.ts';
