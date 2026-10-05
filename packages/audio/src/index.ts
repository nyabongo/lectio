/**
 * @lectio/audio: the narration script builder (L-080) and the TTS rendering pipeline with its
 * manifest (L-081), and narration in other languages from approved translations (L-115). Narration
 * covers Lectio's own notes only, never the reading text.
 */
export const packageName = '@lectio/audio';

export * from './script/index.ts';
export * from './render/index.ts';
export * from './locale/index.ts';
