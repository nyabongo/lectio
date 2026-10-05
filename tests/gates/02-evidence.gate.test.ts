/**
 * Gate 2, evidence tests, over the real repository content: cited excerpts appear in the fetched
 * source, and quoted Greek, Hebrew, Aramaic or Latin words occur in that verse of the in-repo
 * corpus. One named test per rule (see ./helpers/gate-test.ts).
 *
 * The suite runs with the providers' fake fetcher, as unit tests and ci.yml always do, so web pages
 * are not fetched and their sources are flagged for review (a warning, allowed here). Only the
 * content-gates workflow (L-031) injects the live fetcher (L-030). Print sources are flagged by
 * design. Scripture sources and translation notes are checked in full against the corpus.
 */
import { describe } from 'vitest';

import { gateTest } from './helpers/gate-test.ts';

describe('gate 2: evidence', () => {
  gateTest('evidence/web-excerpt-found', { allow: ['warning', 'info'] });
  gateTest('evidence/scripture-source-real');
  gateTest('evidence/original-word-in-verse');
  gateTest('evidence/print-source-flag', { allow: ['warning', 'info'] });
});
