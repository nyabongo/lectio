/**
 * The shared axe-core check (L-064): one rule set and one blocking threshold for every suite that runs axe (the
 * page-type gate in axe.spec.ts, the Listen player in ../listen/listen.spec.ts, and later suites such as L-092).
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/** The WCAG rule sets the gate runs (axe tags): 2.0, 2.1 and 2.2, levels A and AA. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Impacts that fail the gate; minor and moderate findings are reported but do not fail it. */
export const BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);

/** One axe violation, reduced to what a reviewer needs. */
export interface AxeFinding {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: string[];
}

export interface AxeOptions {
  /** Attach every finding (blocking or not) to the report under this name, when there are any. */
  readonly attach?: { readonly testInfo: TestInfo; readonly name: string };
}

/** Runs axe with `WCAG_TAGS` on the page as it is now; returns every violation found. */
export async function axeFindings(page: Page, options: AxeOptions = {}): Promise<AxeFinding[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const findings = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
  if (options.attach !== undefined && findings.length > 0) {
    await options.attach.testInfo.attach(options.attach.name, {
      body: JSON.stringify(findings, null, 2),
      contentType: 'application/json',
    });
  }
  return findings;
}

/** The violations that fail the gate (serious or critical). Expect it to equal `[]`. */
export async function blockingAxeFindings(page: Page, options: AxeOptions = {}): Promise<AxeFinding[]> {
  return (await axeFindings(page, options)).filter((finding) => BLOCKING_IMPACTS.has(finding.impact ?? ''));
}
