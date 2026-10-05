import { describe, expect, it } from 'vitest';

import { astroSiteOptions, packageName, themeCss } from './index.ts';

describe('@lectio/web', () => {
  it('exports its package name and the site helpers', () => {
    expect(packageName).toBe('@lectio/web');
    expect(typeof astroSiteOptions).toBe('function');
    expect(typeof themeCss).toBe('function');
  });
});
