/**
 * Test-only msw helpers that answer `POST /v1/responses` from the JSON fixtures next to
 * this file (see README.md). Lives under `fixtures/` so it is excluded from coverage.
 */
import { readFileSync } from 'node:fs';

import { http, HttpResponse } from 'msw';

export const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export type FixtureName =
  'text' | 'structured' | 'web-search' | 'refusal' | 'malformed' | 'off-schema' | 'rate-limit' | 'insufficient-quota';

/** A fresh copy of a fixture body. */
export function fixture(name: FixtureName): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

/** A request body the client sent, as parsed JSON. */
export type SentBody = Record<string, unknown> & {
  readonly model?: string;
  readonly input?: unknown[];
  readonly tools?: unknown[];
  readonly text?: { readonly format?: Record<string, unknown> };
};

/**
 * Answers like the recorded API: a web-search answer when tools are sent, a structured
 * answer when a JSON schema is requested, plain text otherwise. Every body sent is
 * pushed onto `sent`.
 */
export function recordedHandler(sent: SentBody[] = []) {
  return http.post(RESPONSES_URL, async ({ request }) => {
    const body = (await request.json()) as SentBody;
    sent.push(body);
    if (Array.isArray(body.tools) && body.tools.length > 0) return HttpResponse.json(fixture('web-search'));
    if (body.text?.format?.['type'] === 'json_schema') return HttpResponse.json(fixture('structured'));
    return HttpResponse.json(fixture('text'));
  });
}

/** Answers each call with the next body in `replies` (the last one repeats), recording what was sent. */
export function sequenceHandler(
  replies: readonly (Record<string, unknown> | { status: number; body: unknown; headers?: Record<string, string> })[],
  sent: SentBody[] = [],
) {
  let call = 0;
  return http.post(RESPONSES_URL, async ({ request }) => {
    sent.push((await request.json()) as SentBody);
    const reply = replies[Math.min(call++, replies.length - 1)] as Record<string, unknown>;
    if (typeof reply['status'] === 'number' && 'body' in reply) {
      const { status, body, headers } = reply as { status: number; body: unknown; headers?: Record<string, string> };
      return HttpResponse.json(body as Record<string, unknown>, { status, headers });
    }
    return HttpResponse.json(reply);
  });
}
