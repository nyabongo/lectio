import { describe, expect, it } from 'vitest';

import {
  TTS_VERSIONS,
  audioKey,
  buildSegments,
  packageName,
  parseManifest,
  passagesOf,
  planRender,
  render,
  resolveAudio,
  speakable,
} from './index.ts';

describe('@lectio/audio', () => {
  it('exports its package name and the narration script builder', () => {
    expect(packageName).toBe('@lectio/audio');
    expect([audioKey, buildSegments, passagesOf, speakable].every((fn) => typeof fn === 'function')).toBe(true);
  });

  it('exports the render pipeline and the manifest resolver', () => {
    expect([planRender, render, parseManifest, resolveAudio].every((fn) => typeof fn === 'function')).toBe(true);
    expect(TTS_VERSIONS).toMatchObject({ azure: 'azure-1', fake: 'fake-1' });
  });
});
