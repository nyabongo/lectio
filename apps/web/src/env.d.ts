/**
 * Lets plain `tsc` (npm run typecheck) import `.astro` components in tests; `npm run check -w apps/web`
 * (astro check) types their props.
 */
declare module '*.astro' {
  import type { experimental_AstroContainer } from 'astro/container';

  const Component: Parameters<experimental_AstroContainer['renderToString']>[0];
  export default Component;
}
