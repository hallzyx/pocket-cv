// ---------------------------------------------------------------------------
// M2 Interview Agent — Client-side SSE parser and event reducer
//
// Pure functions for parsing SSE streams (handling arbitrary partial chunks),
// ordering/gating events by version, deduplicating message/tool/terminal
// events, and deriving profile-growth summaries.
//
// Separated from the React component for testability and to reduce the
// 745-line monolith.
// ---------------------------------------------------------------------------

// ── Types ──

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolStatus?: "running" | "applied" | "confirmation_required" | "validation_error";
  version: number;
};

export type StreamEvent =
  | { type: "message.delta"; version: number; payload: { content?: string; role?: string; runId?: string } }
  | { type: "tool.started"; version: number; payload: { name?: string; toolName?: string; toolId?: string; runId?: string } }
  | { type: "tool.completed"; version: number; payload: { name?: string; toolName?: string; toolId?: string; status?: string; summary?: string; runId?: string } }
  | { type: "profile.updated"; version: number; payload: { section?: string; updates?: Record<string, unknown>; runId?: string } }
  | { type: "run.completed"; version: number; payload: { runId?: string; tokensIn?: number; tokensOut?: number } }
  | { type: "run.failed"; version: number; payload: { error?: string; runId?: string } }
  | { type: "run.cancelled"; version: number; payload: { runId?: string; reason?: string } }
  | { type: "done"; version: number; payload: { success?: boolean; runId?: string } };

export interface ProfileGrowth {
  sectionsUpdated: string[];
  summary: string;
}

export interface ClientState {
  messages: ChatMessage[];
  profileChanges: string[];
  lastKnownVersion: number;
  runId: string | null;
}

// ── SSE Parser (handles arbitrary partial chunks) ──

/**
 * Parse a buffer of SSE text, extracting complete events.
 * Returns the parsed events and any remaining partial data.
 *
 * Handles:
 *   - Partial chunks split at arbitrary byte boundaries
 *   - Multiple complete events in one chunk
 *   - Events split across multiple chunks
 *   - Malformed lines gracefully
 */
export function parseSseBuffer(buffer: string): { events: StreamEvent[]; remainder: string } {
  const events: StreamEvent[] = [];

  // Split on double newline — the SSE event boundary (supports both \n\n and \r\n\r\n)
  const parts = buffer.split(/\r?\n\r?\n/);
  // The last part is either empty or incomplete — keep as remainder
  const complete = parts.slice(0, -1);
  const remainder = parts[parts.length - 1] ?? "";

  for (const block of complete) {
    if (!block.trim()) continue;
    const ev = parseSingleSseBlock(block);
    if (ev) events.push(ev);
  }

  return { events, remainder };
}

/**
 * Parse a single complete SSE block (between \n\n boundaries).
 */
function parseSingleSseBlock(block: string): StreamEvent | null {
  const lines = block.split("\n");
  let eventType = "";
  let dataStr = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event: ")) {
      eventType = trimmed.slice(7).trim();
    } else if (trimmed.startsWith("data: ")) {
      dataStr = trimmed.slice(6).trim();
    }
  }

  if (!dataStr) return null;

  try {
    const parsed = JSON.parse(dataStr) as {
      version: number;
      type: string;
      payload: Record<string, unknown>;
    };

    if (typeof parsed.version !== "number" || !parsed.type) return null;

    return {
      type: parsed.type,
      version: parsed.version,
      payload: parsed.payload,
    } as StreamEvent;
  } catch {
    return null;
  }
}

// ── Event Reducer (pure state transformation) ──

let _counter = 0;
function makeId(): string {
  _counter++;
  return `msg-${_counter}-${Date.now().toString(36)}`;
}

/**
 * Sort events by version (ascending — oldest first, which is the order
 * they should be applied in).
 */
export function sortEvents(events: StreamEvent[]): StreamEvent[] {
  return [...events].sort((a, b) => a.version - b.version);
}

/**
 * Filter out events whose version <= lastKnownVersion.
 */
export function filterEventsByCursor(
  events: StreamEvent[],
  lastKnownVersion: number,
): StreamEvent[] {
  return events.filter((e) => e.version > lastKnownVersion);
}

/**
 * Check whether an event would be a duplicate of an already-applied event.
 *
 * Deduplication rules:
 *   - A "message.delta" is a duplicate if the last message at the same role
 *     and version already exists.
 *   - A "tool.started" is a duplicate if a tool with the same name/version
 *     already exists in "running" status.
 *   - A "tool.completed" is a duplicate if the matching tool is already
 *     completed at >= version.
 *   - Terminal events (run.completed/failed/cancelled/done) are cumulative:
 *     the latest version wins, but we never show two of the same type.
 */
function isDuplicate(
  event: StreamEvent,
  state: ClientState,
): boolean {
  const { messages } = state;

  switch (event.type) {
    case "message.delta": {
      const role = (event.payload.role as string) ?? "assistant";
      // If we already have a message at exactly this version + role, skip
      return messages.some(
        (m) => m.version === event.version && m.role === role,
      );
    }
    case "tool.started": {
      const name = (event.payload.name ?? event.payload.toolName ?? "") as string;
      return messages.some(
        (m) =>
          m.role === "tool" &&
          m.toolName === name &&
          m.version === event.version &&
          m.toolStatus === "running",
      );
    }
    case "tool.completed": {
      const name = (event.payload.name ?? event.payload.toolName ?? "") as string;
      return messages.some(
        (m) =>
          m.role === "tool" &&
          m.toolName === name &&
          m.version >= event.version &&
          m.toolStatus !== "running",
      );
    }
    // profile.updated is NOT handled here — isDuplicate must not skip cursor
    // advancement. applyEvent() already deduplicates profileChanges while
    // still advancing lastKnownVersion.
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
    case "done":
      // Only one of each per version
      return messages.some(
        (m) => m.role === "system" && m.version === event.version,
      );
    default:
      return false;
  }
}

/**
 * Apply a single event to the client state, producing a new state.
 * Pure function — does not mutate the input.
 */
function applyEvent(state: ClientState, event: StreamEvent): ClientState {
  const { messages, profileChanges, lastKnownVersion, runId } = state;

  // Track runId from any event that carries it
  const newRunId = event.payload.runId ?? runId;

  // Update cursor to the event version
  const newVersion = Math.max(lastKnownVersion, event.version);

  switch (event.type) {
    case "message.delta": {
      const content = (event.payload.content as string) ?? "";
      const role = (event.payload.role as string) ?? "assistant";
      if (role === "user") {
        return {
          messages: [
            ...messages,
            { id: makeId(), role: "user", content, version: event.version },
          ],
          profileChanges,
          lastKnownVersion: newVersion,
          runId: newRunId,
        };
      }
      // Assistant delta — append to last assistant message if exists
      const copy = [...messages];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") {
        copy[copy.length - 1] = {
          ...last,
          content: last.content + content,
          version: event.version,
        };
      } else {
        copy.push({
          id: makeId(),
          role: "assistant",
          content,
          version: event.version,
        });
      }
      return { messages: copy, profileChanges, lastKnownVersion: newVersion, runId: newRunId };
    }

    case "tool.started": {
      const toolName = (event.payload.name ?? event.payload.toolName ?? "") as string;
      return {
        messages: [
          ...messages,
          {
            id: makeId(),
            role: "tool",
            content: "",
            toolName,
            toolStatus: "running",
            version: event.version,
          },
        ],
        profileChanges,
        lastKnownVersion: newVersion,
        runId: newRunId,
      };
    }

    case "tool.completed": {
      const tName = (event.payload.name ?? event.payload.toolName ?? "") as string;
      const tStatus = (event.payload.status as ChatMessage["toolStatus"]) ?? "applied";
      const summary = (event.payload.summary as string) ?? "";
      const copy = [...messages];
      // Find the LAST running tool with this name
      for (let i = copy.length - 1; i >= 0; i--) {
        if (
          copy[i].role === "tool" &&
          copy[i].toolName === tName &&
          copy[i].toolStatus === "running"
        ) {
          copy[i] = { ...copy[i], toolStatus: tStatus, content: summary, version: event.version };
          break;
        }
      }
      return { messages: copy, profileChanges, lastKnownVersion: newVersion, runId: newRunId };
    }

    case "profile.updated": {
      const section = (event.payload.section as string) ?? "profile";
      if (profileChanges.includes(section)) {
        return { messages, profileChanges, lastKnownVersion: newVersion, runId: newRunId };
      }
      return {
        messages,
        profileChanges: [...profileChanges, section],
        lastKnownVersion: newVersion,
        runId: newRunId,
      };
    }

    case "run.completed": {
      return {
        messages: [
          ...messages,
          { id: makeId(), role: "system", content: "run.completed", version: event.version },
        ],
        profileChanges,
        lastKnownVersion: newVersion,
        runId: newRunId,
      };
    }

    case "run.failed": {
      const errMsg = (event.payload.error as string) ?? "Unknown error";
      return {
        messages: [
          ...messages,
          { id: makeId(), role: "system", content: `run.failed: ${errMsg}`, version: event.version },
        ],
        profileChanges,
        lastKnownVersion: newVersion,
        runId: newRunId,
      };
    }

    case "run.cancelled": {
      return {
        messages: [
          ...messages,
          { id: makeId(), role: "system", content: "run.cancelled", version: event.version },
        ],
        profileChanges,
        lastKnownVersion: newVersion,
        runId: newRunId,
      };
    }

    case "done":
      // Don't display "done" — it's a stream terminator only
      return { messages, profileChanges, lastKnownVersion: newVersion, runId: newRunId };
  }
}

/**
 * Reduce new events into the client state.
 *
 * Behaviour:
 *   1. Sort events by version (ascending)
 *   2. Filter out events <= lastKnownVersion
 *   3. Deduplicate per the rules in isDuplicate
 *   4. Apply each accepted event, updating cursor immediately
 *
 * Pure function — does not mutate state.
 */
export function reduceClientState(
  state: ClientState,
  rawEvents: StreamEvent[],
): ClientState {
  let current = state;

  const sorted = sortEvents(rawEvents);
  const gated = filterEventsByCursor(sorted, state.lastKnownVersion);

  for (const event of gated) {
    if (isDuplicate(event, current)) continue;
    current = applyEvent(current, event);
  }

  return current;
}

/**
 * Derive a human-readable profile growth summary from profileChanges.
 */
export function deriveGrowth(profileChanges: string[]): ProfileGrowth | null {
  if (profileChanges.length === 0) return null;

  const sectionLabels: Record<string, string> = {
    personal_info: "Personal Info",
    personalInfo: "Personal Info",
    experiences: "Experience",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    skill: "Skills",
    projects: "Projects",
    project: "Projects",
    achievements: "Achievements",
    achievement: "Achievements",
    preferences: "Preferences",
    profile: "Profile",
  };

  const labeled = profileChanges.map(
    (s) => sectionLabels[s] ?? s.charAt(0).toUpperCase() + s.slice(1),
  );

  return {
    sectionsUpdated: [...new Set(labeled)],
    summary:
      profileChanges.length === 1
        ? `Profile updated: ${labeled[0]}`
        : `Profile updated in ${profileChanges.length} areas: ${labeled.join(", ")}`,
  };
}
