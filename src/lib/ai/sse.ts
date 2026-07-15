// ---------------------------------------------------------------------------
// M2 Interview Agent — SSE framing helpers
//
// Produces UTF-8 SSE frames conforming to the typed SSE contract.
// Each event is a complete UTF-8 JSON line.
// ---------------------------------------------------------------------------

import type { SseFrame, InterviewEvent } from "./types";

/**
 * Format a single SSE frame.
 * Each frame has the form:
 *   event: {type}\n
 *   data: {json}\n\n
 */
export function formatSse(frame: SseFrame): string {
  return `event: ${frame.event}\ndata: ${frame.data}\n\n`;
}

/**
 * Encode an InterviewEvent into an SSE frame.
 * The event name is the event type, data is JSON-serialized payload.
 */
export function encodeEvent(event: InterviewEvent): string {
  return formatSse({
    event: event.type,
    data: JSON.stringify({
      version: event.version,
      type: event.type,
      payload: event.payload,
    }),
  });
}

/**
 * Check if a string is valid UTF-8.
 * SSE must be valid UTF-8 — this is a lightweight check.
 */
export function isValidUtf8(text: string): boolean {
  try {
    // Encode and decode to verify round-trip
    const encoded = new TextEncoder().encode(text);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
    return decoded === text;
  } catch {
    return false;
  }
}
