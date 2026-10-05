/**
 * Link-outs (L-007, decision 001): the URL of the page where a reading can be
 * read. The built-in `drbo` provider links to the public-domain Douay-Rheims
 * chapter page; any other site is a `linkout.providers` template entry. Only
 * builds URLs; nothing is fetched and no reading text is stored (ADR 0003).
 */
export { DRBO_BASE, drboChapterUrl, drboUrl, firstChapter } from './drbo.ts';
export { LinkoutError } from './errors.ts';
export type { LinkoutErrorCode } from './errors.ts';
export { REFERENCE_SCHEME, activeProvider, linkoutUrl } from './linkout.ts';
export type { Linkout } from './linkout.ts';
export { TEMPLATE_TOKENS, compactDate, fillTemplate, templateTokens, templateValues } from './template.ts';
export type { TemplateToken } from './template.ts';
