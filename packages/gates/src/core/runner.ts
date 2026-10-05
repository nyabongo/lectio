/**
 * Runs gates in order and collects one report. A gate that throws, returns a result that does not
 * validate, or reports a rule it never declared does not stop the run: the runner turns that into
 * a `fail` result for the gate, so the PR comment still explains every gate.
 */
import { formatErrors } from '@lectio/schema/common';
import { validateGateResult } from '@lectio/schema/gate-result';

import type { Gate, GateContext } from './gate.ts';
import { finding, resultFromFindings } from './result.ts';
import type { GateResult, GateStatus } from './result.ts';
import { RUNNER_GATE_ID, RUNNER_RULES } from './rules.ts';

/** Version of the JSON report written by `lectio-gates run --json`. */
export const REPORT_VERSION = 1;

export interface GateReport {
  readonly reportVersion: typeof REPORT_VERSION;
  /** `fail` if any gate failed, else `flag` if any flagged, else `pass`; `skipped` when every gate skipped. */
  readonly status: GateStatus;
  readonly base: string;
  readonly head: string;
  /** Changed file paths, sorted. */
  readonly changedFiles: readonly string[];
  /** One result per gate run, in run order. */
  readonly results: readonly GateResult[];
}

/** The overall status of a set of results. */
export function overallStatus(results: readonly GateResult[]): GateStatus {
  const statuses = new Set(results.map((result) => result.status));
  if (statuses.has('fail')) return 'fail';
  if (statuses.has('flag')) return 'flag';
  if (statuses.has('pass')) return 'pass';
  return 'skipped';
}

function crashed(gate: Gate, error: unknown): GateResult {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
  const message = `${gate.id} threw: ${text === '' ? '(no message)' : text}`;
  return resultFromFindings(gate.id, [finding(RUNNER_RULES.crashed, { message })], { crashed: true });
}

/**
 * The failed runner result for changed paths that are not regular files (symbolic links,
 * submodules). The gates do not run on such a PR: a link could point anywhere on the runner.
 */
export function nonRegularResult(paths: readonly string[]): GateResult {
  return resultFromFindings(
    RUNNER_GATE_ID,
    paths.map((file) => finding(RUNNER_RULES.regularFiles, { file, message: `${file} is not a regular file` })),
  );
}

/** Checks a gate's result; problems become runner findings and the result fails. */
function checked(gate: Gate, result: unknown): GateResult {
  if (!validateGateResult(result)) {
    const message = `${gate.id} returned an invalid result: ${formatErrors(validateGateResult.errors).join('; ')}`;
    return resultFromFindings(gate.id, [finding(RUNNER_RULES.invalidResult, { message })]);
  }
  if (result.gate !== gate.id) {
    const message = `${gate.id} returned a result for "${result.gate}"`;
    return resultFromFindings(gate.id, [finding(RUNNER_RULES.invalidResult, { message })]);
  }
  if (result.status === 'skipped' && result.items.length > 0) {
    // The schema allows it, but a skipped gate that reports findings would hide them: overall
    // status ignores skipped results. Surface them as a failure instead.
    const message = `${gate.id} reported ${String(result.items.length)} findings but status skipped`;
    return { ...result, status: 'fail', items: [...result.items, finding(RUNNER_RULES.invalidResult, { message })] };
  }
  const declared = new Set(gate.rules.map((rule) => rule.id));
  const unknown = [...new Set(result.items.map((item) => item.ruleId).filter((id) => !declared.has(id)))];
  if (unknown.length === 0) return result;
  const extra = unknown.map((id) =>
    finding(RUNNER_RULES.unknownRule, { message: `${gate.id} reported undeclared rule ${id}` }),
  );
  return { ...result, status: 'fail', items: [...result.items, ...extra] };
}

/** Runs `gates` in order against `context`; each gate sees the results of those before it. */
export async function runGates(gates: readonly Gate[], context: GateContext): Promise<GateReport> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    let result: GateResult;
    try {
      result = checked(gate, await gate.run({ ...context, results: [...results] }));
    } catch (error) {
      result = crashed(gate, error);
    }
    results.push(result);
  }
  return {
    reportVersion: REPORT_VERSION,
    status: overallStatus(results),
    base: context.base,
    head: context.head,
    changedFiles: context.changedFiles.map((file) => file.path),
    results,
  };
}
