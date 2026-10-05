/**
 * Test helpers: serve recorded Anthropic Messages API responses through msw.
 *
 * The `*.json` files next to this one are complete `Message` objects as the API returns
 * them (ids and encrypted fields shortened). The client streams, so `sseResponse` replays a
 * message as the server-sent-event sequence the API emits for it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpResponse } from 'msw';

export const BASE_URL = 'https://api.anthropic.test';
export const MESSAGES_URL = `${BASE_URL}/v1/messages`;

export type RecordedMessage = Record<string, unknown> & {
  content: Record<string, unknown>[];
  usage: Record<string, unknown>;
};

const here = dirname(fileURLToPath(import.meta.url));

export function loadRecorded(name: string): RecordedMessage {
  return JSON.parse(readFileSync(join(here, `${name}.json`), 'utf8')) as RecordedMessage;
}

function event(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The SSE body the API streams for `message`. */
export function sseBody(message: RecordedMessage): string {
  const { content, usage, stop_reason, stop_sequence, stop_details, ...rest } = message;
  const parts = [
    event('message_start', {
      type: 'message_start',
      message: {
        ...rest,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: { ...usage, output_tokens: 1 },
      },
    }),
  ];
  content.forEach((block, index) => {
    if (block['type'] === 'text') {
      const text = String(block['text']);
      const half = Math.ceil(text.length / 2);
      parts.push(
        event('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '', citations: null },
        }),
      );
      for (const chunk of [text.slice(0, half), text.slice(half)]) {
        if (chunk.length === 0) continue;
        parts.push(
          event('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: chunk },
          }),
        );
      }
      for (const citation of (block['citations'] as unknown[] | null | undefined) ?? []) {
        parts.push(
          event('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'citations_delta', citation },
          }),
        );
      }
    } else {
      parts.push(event('content_block_start', { type: 'content_block_start', index, content_block: block }));
    }
    parts.push(event('content_block_stop', { type: 'content_block_stop', index }));
  });
  parts.push(
    event('message_delta', {
      type: 'message_delta',
      delta: { stop_reason, stop_sequence: stop_sequence ?? null, stop_details: stop_details ?? null },
      usage,
    }),
    event('message_stop', { type: 'message_stop' }),
  );
  return parts.join('');
}

export function sseResponse(message: RecordedMessage): HttpResponse<string> {
  return new HttpResponse(sseBody(message), { headers: { 'content-type': 'text/event-stream' } });
}

/** An HTTP error response in the API's error shape. */
export function errorResponse(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
): HttpResponse<string> {
  return new HttpResponse(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A stream that starts and then fails with an `error` event (how mid-stream overloads arrive). */
export function streamErrorResponse(type: string, message: string): HttpResponse<string> {
  const start = loadRecorded('text');
  const body =
    event('message_start', { type: 'message_start', message: { ...start, content: [], stop_reason: null } }) +
    event('error', { type: 'error', error: { type, message } });
  return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } });
}

/** A message with `content`, `stop_reason` and usage overridden on top of a recorded one. */
export function variant(name: string, overrides: Partial<RecordedMessage>): RecordedMessage {
  return { ...loadRecorded(name), ...overrides };
}
