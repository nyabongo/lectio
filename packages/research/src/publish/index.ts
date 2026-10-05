/**
 * Publishing (step 5 of a research run, L-037): one PR per passage through the `GitHubClient`
 * interface. The CLI entry point (L-038) injects the `gh` client and re-exports this from the
 * package root.
 */
export {
  BODY_MARKER,
  GATES_END,
  GATES_START,
  GATE_SLUGS,
  RESEARCH_TRAILER,
  bodyMarker,
  code,
  commitMessage,
  hashInBody,
  inline,
  keepGates,
  prBody,
  prTitle,
} from './body.ts';
export type { PrTextInput } from './body.ts';
export { PRINT_WIDTH, formatJson, textWidth } from './format-json.ts';
export {
  APPROVAL_AUTHOR,
  APPROVAL_TRAILER,
  PublishRefusedError,
  RESEARCH_LABEL,
  filesHash,
  groupItems,
  isReplaceableHead,
  passageFiles,
  passagePath,
  publishAll,
  publishPassage,
} from './publish.ts';
export type { PublishItem, PublishOptions, PublishOutcome, PublishResult, RefusalReason } from './publish.ts';
