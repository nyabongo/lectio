/** TTS rendering pipeline (L-081): plan the missing narration files, render them, keep the manifest. */
export {
  MANIFEST_KEY,
  MANIFEST_VERSION,
  charactersThisMonth,
  emptyManifest,
  parseManifest,
  readManifest,
  serializeManifest,
  writeManifest,
} from './manifest.ts';
export type { AudioManifest, ManifestEntry } from './manifest.ts';
export { findOrphans, objectKeyFor, pickFormat, planRender } from './plan.ts';
export type { Orphan, PlanRenderOptions, RenderPlan, RenderPlanItem, SkippedSegment } from './plan.ts';
export { AUDIO_CACHE_CONTROL, CharacterBudgetError, render, wavDurationMs } from './render.ts';
export type { RenderFailure, RenderOptions, RenderResult } from './render.ts';
