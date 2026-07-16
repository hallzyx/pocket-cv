// ---------------------------------------------------------------------------
// M2 Interview Agent — Client-side SSE parser and reducer tests
//
// Tests the pure functions: parseSseBuffer, reduceClientState, deriveGrowth.
// No React dependencies — fast unit tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  parseSseBuffer,
  reduceClientState,
  deriveGrowth,
  sortEvents,
  filterEventsByCursor,
  type StreamEvent,
  type ClientState,
} from "./sse-client";

// ── Fixtures ──

const eventA: StreamEvent = {
  type: "message.delta",
  version: 1,
  payload: { content: "Hello!", role: "assistant" },
};

const eventB: StreamEvent = {
  type: "tool.started",
  version: 2,
  payload: { name: "get_profile" },
};

const eventC: StreamEvent = {
  type: "tool.completed",
  version: 3,
  payload: { name: "get_profile", status: "applied", summary: "Profile loaded" },
};

const eventD: StreamEvent = {
  type: "profile.updated",
  version: 4,
  payload: { section: "personal_info" },
};

const eventE: StreamEvent = {
  type: "run.completed",
  version: 5,
  payload: { runId: "run-1" },
};

const eventF: StreamEvent = {
  type: "message.delta",
  version: 6,
  payload: { content: "More text", role: "assistant" },
};

const eventDone: StreamEvent = {
  type: "done",
  version: 7,
  payload: { success: true, runId: "run-1" },
};

const emptyState: ClientState = {
  messages: [],
  profileChanges: [],
  lastKnownVersion: 0,
  runId: null,
};

// ── parseSseBuffer ──

describe("parseSseBuffer", () => {
  it("parses a single complete SSE event", () => {
    const input = 'event: message.delta\ndata: {"version":1,"type":"message.delta","payload":{"content":"Hi"}}\n\n';
    const { events, remainder } = parseSseBuffer(input);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message.delta");
    expect(events[0].version).toBe(1);
    expect((events[0].payload as Record<string, unknown>).content).toBe("Hi");
    expect(remainder).toBe("");
  });

  it("parses multiple events in one buffer", () => {
    const input = [
      'event: message.delta\ndata: {"version":1,"type":"message.delta","payload":{"content":"A"}}',
      '',
      'event: tool.started\ndata: {"version":2,"type":"tool.started","payload":{"name":"x"}}',
      '',
    ].join("\n\n");
    const { events, remainder } = parseSseBuffer(input);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("message.delta");
    expect(events[1].type).toBe("tool.started");
  });

  it("handles partial chunk (remainder)", () => {
    const input = 'event: message.delta\ndata: {"version":1,"type":"message.delta","payload":{"content":"Hi"}}\n\nevent: tool.s';
    const { events, remainder } = parseSseBuffer(input);
    expect(events).toHaveLength(1);
    expect(remainder).toBe("event: tool.s");
  });

  it("accumulates across partial chunks", () => {
    // First chunk: partial event
    const chunk1 = 'event: message.delta\ndata: {"version":1,"type":"message.delta"';
    const r1 = parseSseBuffer(chunk1);
    expect(r1.events).toHaveLength(0);
    expect(r1.remainder).toBe(chunk1);

    // Second chunk: completes the event
    const chunk2 = r1.remainder + ',"payload":{"content":"Hi"}}\n\n';
    const r2 = parseSseBuffer(chunk2);
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0].type).toBe("message.delta");
    expect((r2.events[0].payload as Record<string, unknown>).content).toBe("Hi");
  });

  it("handles empty buffer", () => {
    const { events, remainder } = parseSseBuffer("");
    expect(events).toHaveLength(0);
    expect(remainder).toBe("");
  });

  it("skips malformed JSON gracefully", () => {
    const input = 'event: message.delta\ndata: {invalid-json}\n\n';
    const { events } = parseSseBuffer(input);
    expect(events).toHaveLength(0);
  });

  it("parses runId from event payload", () => {
    const input = 'event: tool.started\ndata: {"version":2,"type":"tool.started","payload":{"name":"x","runId":"run-abc"}}\n\n';
    const { events } = parseSseBuffer(input);
    expect(events[0].payload.runId).toBe("run-abc");
  });
});

// ── sortEvents ──

describe("sortEvents", () => {
  it("sorts events by version ascending", () => {
    const unsorted = [eventF, eventD, eventB, eventA, eventC, eventE];
    const sorted = sortEvents(unsorted);
    expect(sorted.map((e) => e.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("preserves original for already-sorted", () => {
    const sorted = sortEvents([eventA, eventB, eventC]);
    expect(sorted.map((e) => e.version)).toEqual([1, 2, 3]);
  });

  it("returns empty for empty input", () => {
    expect(sortEvents([])).toEqual([]);
  });
});

// ── filterEventsByCursor ──

describe("filterEventsByCursor", () => {
  const events = [eventA, eventB, eventC, eventD, eventE, eventF];

  it("returns all events when cursor is 0", () => {
    const filtered = filterEventsByCursor(events, 0);
    expect(filtered).toHaveLength(6);
  });

  it("filters out events <= cursor", () => {
    const filtered = filterEventsByCursor(events, 3);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((e) => e.version)).toEqual([4, 5, 6]);
  });

  it("returns empty when cursor >= max version", () => {
    const filtered = filterEventsByCursor(events, 10);
    expect(filtered).toHaveLength(0);
  });

  it("does not mutate input", () => {
    const copy = [...events];
    filterEventsByCursor(events, 3);
    expect(events).toEqual(copy);
  });
});

// ── reduceClientState ──

describe("reduceClientState", () => {
  it("applies message.delta for assistant", () => {
    const next = reduceClientState(emptyState, [eventA]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("assistant");
    expect(next.messages[0].content).toBe("Hello!");
    expect(next.lastKnownVersion).toBe(1);
  });

  it("appends assistant deltas to the last assistant message", () => {
    const state: ClientState = {
      messages: [
        { id: "1", role: "assistant", content: "Hello ", version: 1 },
      ],
      profileChanges: [],
      lastKnownVersion: 1,
      runId: null,
    };

    const delta2: StreamEvent = {
      type: "message.delta",
      version: 2,
      payload: { content: "World!", role: "assistant" },
    };

    const next = reduceClientState(state, [delta2]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("Hello World!");
    expect(next.lastKnownVersion).toBe(2);
  });

  it("applies user message.delta", () => {
    const userMsg: StreamEvent = {
      type: "message.delta",
      version: 1,
      payload: { content: "My message", role: "user" },
    };
    const next = reduceClientState(emptyState, [userMsg]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("user");
    expect(next.messages[0].content).toBe("My message");
  });

  it("applies tool.started and tool.completed", () => {
    const next1 = reduceClientState(emptyState, [eventB]);
    expect(next1.messages).toHaveLength(1);
    expect(next1.messages[0].role).toBe("tool");
    expect(next1.messages[0].toolName).toBe("get_profile");
    expect(next1.messages[0].toolStatus).toBe("running");

    const next2 = reduceClientState(next1, [eventC]);
    expect(next2.messages).toHaveLength(1);
    expect(next2.messages[0].toolStatus).toBe("applied");
    expect(next2.messages[0].content).toBe("Profile loaded");
  });

  it("tracks profileChanges from profile.updated", () => {
    const next = reduceClientState(emptyState, [eventD]);
    expect(next.profileChanges).toEqual(["personal_info"]);
  });

  it("deduplicates profileChanges entries while advancing cursor", () => {
    const dup: StreamEvent = {
      type: "profile.updated",
      version: 5,
      payload: { section: "personal_info" },
    };
    const state: ClientState = {
      messages: [],
      profileChanges: ["personal_info"],
      lastKnownVersion: 4,
      runId: null,
    };
    const next = reduceClientState(state, [dup]);
    expect(next.profileChanges).toEqual(["personal_info"]);
    // Cursor MUST advance even though section is already tracked
    expect(next.lastKnownVersion).toBe(5);
  });

  it("profile.updated with duplicate section advances cursor without regressing old behavior", () => {
    // First profile.updated adds the section
    const first: StreamEvent = { type: "profile.updated", version: 4, payload: { section: "personal_info" } };
    // Second profile.updated for the SAME section at a higher version
    const second: StreamEvent = { type: "profile.updated", version: 6, payload: { section: "personal_info" } };

    const firstState = reduceClientState(emptyState, [first]);
    expect(firstState.profileChanges).toEqual(["personal_info"]);
    expect(firstState.lastKnownVersion).toBe(4);

    const secondState = reduceClientState(firstState, [second]);
    // profileChanges unchanged — no duplicate entry
    expect(secondState.profileChanges).toEqual(["personal_info"]);
    // BUT cursor advanced — this would FAIL with old isDuplicate block
    expect(secondState.lastKnownVersion).toBe(6);
  });

  it("applies run.completed and tracks runId", () => {
    const next = reduceClientState(emptyState, [eventE]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("system");
    expect(next.messages[0].content).toBe("run.completed");
    expect(next.runId).toBe("run-1");
  });

  it("applies run.failed", () => {
    const failed: StreamEvent = {
      type: "run.failed",
      version: 1,
      payload: { error: "Provider error", runId: "run-1" },
    };
    const next = reduceClientState(emptyState, [failed]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("system");
    expect(next.messages[0].content).toContain("Provider error");
    expect(next.runId).toBe("run-1");
  });

  it("applies run.cancelled", () => {
    const cancelled: StreamEvent = {
      type: "run.cancelled",
      version: 1,
      payload: { runId: "run-1", reason: "user request" },
    };
    const next = reduceClientState(emptyState, [cancelled]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("run.cancelled");
    expect(next.runId).toBe("run-1");
  });

  it("does not display 'done' events", () => {
    const next = reduceClientState(emptyState, [eventDone]);
    expect(next.messages).toHaveLength(0);
    expect(next.lastKnownVersion).toBe(7);
    expect(next.runId).toBe("run-1");
  });

  it("rejects events with version <= lastKnownVersion", () => {
    const state: ClientState = {
      messages: [],
      profileChanges: [],
      lastKnownVersion: 5,
      runId: "run-1",
    };
    const next = reduceClientState(state, [eventA, eventC]);
    expect(next.messages).toHaveLength(0);
    expect(next.lastKnownVersion).toBe(5);
  });

  it("processes events in version order even if input is unsorted", () => {
    // Input is version 6, 2, 1, 3, 5, 4
    const next = reduceClientState(emptyState, [
      eventF, // v6 - message.delta More text
      eventB, // v2 - tool.started
      eventA, // v1 - message.delta Hello!
      eventC, // v3 - tool.completed (updates tool to applied)
      eventE, // v5 - run.completed
      eventD, // v4 - profile.updated
    ]);

    // Sorted: v1, v2, v3, v4, v5, v6
    // v1: message.delta → assistant "Hello!"
    // v2: tool.started → get_profile running
    // v3: tool.completed → get_profile → applied
    // v4: profile.updated
    // v5: run.completed → system msg
    // v6: message.delta → appended to assistant

    // Messages order: [assistant("Hello!"), tool(applied), system("run.completed"), assistant("More text")]
    // The v6 delta creates a NEW assistant message because the last message is
    // "system" (run.completed), not "assistant" — so it doesn't append.
    expect(next.messages).toHaveLength(4);
    expect(next.messages[0].role).toBe("assistant");
    expect(next.messages[0].content).toBe("Hello!");
    expect(next.messages[1].role).toBe("tool");
    expect(next.messages[1].toolName).toBe("get_profile");
    expect(next.messages[1].toolStatus).toBe("applied");
    expect(next.messages[2].role).toBe("system");
    expect(next.messages[2].content).toBe("run.completed");
    expect(next.messages[3].role).toBe("assistant");
    expect(next.messages[3].content).toBe("More text");

    expect(next.profileChanges).toEqual(["personal_info"]);
    expect(next.lastKnownVersion).toBe(6);
    expect(next.runId).toBe("run-1");
  });

  it("deduplicates message.delta at same version+role", () => {
    const state: ClientState = {
      messages: [
        { id: "m1", role: "assistant", content: "Hello!", version: 1 },
      ],
      profileChanges: [],
      lastKnownVersion: 1,
      runId: null,
    };
    const dup: StreamEvent = {
      type: "message.delta",
      version: 1,
      payload: { content: "Hello!", role: "assistant" },
    };
    const next = reduceClientState(state, [dup]);
    expect(next.messages).toHaveLength(1);
    expect(next.lastKnownVersion).toBe(1);
  });

  it("deduplicates tool.completed when already completed at >= version", () => {
    const state: ClientState = {
      messages: [
        {
          id: "t1", role: "tool", toolName: "get_profile",
          toolStatus: "applied", content: "Done", version: 3,
        },
      ],
      profileChanges: [],
      lastKnownVersion: 3,
      runId: null,
    };
    const dup: StreamEvent = {
      type: "tool.completed",
      version: 3,
      payload: { name: "get_profile", status: "applied", summary: "Done" },
    };
    const next = reduceClientState(state, [dup]);
    expect(next.messages).toHaveLength(1);
    expect(next.lastKnownVersion).toBe(3);
  });

  it("deduplicates tool.started at same name+version+status", () => {
    const state: ClientState = {
      messages: [
        {
          id: "t1", role: "tool", toolName: "get_profile",
          toolStatus: "running", content: "", version: 2,
        },
      ],
      profileChanges: [],
      lastKnownVersion: 2,
      runId: null,
    };
    const dup: StreamEvent = {
      type: "tool.started",
      version: 2,
      payload: { name: "get_profile" },
    };
    const next = reduceClientState(state, [dup]);
    expect(next.messages).toHaveLength(1);
  });
});

// ── deriveGrowth ──

describe("deriveGrowth", () => {
  it("returns null when no changes", () => {
    expect(deriveGrowth([])).toBeNull();
  });

  it("returns summary for single change", () => {
    const g = deriveGrowth(["personalInfo"]);
    expect(g).not.toBeNull();
    expect(g!.summary).toContain("Personal Info");
    expect(g!.sectionsUpdated).toContain("Personal Info");
  });

  it("returns summary for multiple changes", () => {
    const g = deriveGrowth(["personalInfo", "experiences", "skills"]);
    expect(g).not.toBeNull();
    expect(g!.sectionsUpdated).toHaveLength(3);
    expect(g!.summary).toContain("3 areas");
  });

  it("deduplicates section labels", () => {
    const g = deriveGrowth(["personalInfo", "personal_info"]);
    // Both map to "Personal Info" — deduplicated
    expect(g!.sectionsUpdated).toHaveLength(1);
  });

  it("handles unknown section names", () => {
    const g = deriveGrowth(["custom_section"]);
    expect(g!.sectionsUpdated).toContain("Custom_section");
  });
});

// ── Incremental chunks (key PR2 requirement) ──

describe("incremental partial chunks", () => {
  it("applies partial assistant delta progressively", () => {
    const chunk1: StreamEvent = {
      type: "message.delta",
      version: 1,
      payload: { content: "Build", role: "assistant" },
    };
    const chunk2: StreamEvent = {
      type: "message.delta",
      version: 1, // Same version — server sends the same version for deltas
      payload: { content: "ing", role: "assistant" },
    };
    const chunk3: StreamEvent = {
      type: "message.delta",
      version: 1,
      payload: { content: " profile", role: "assistant" },
    };

    const s1 = reduceClientState(emptyState, [chunk1]);
    expect(s1.messages[0].content).toBe("Build");

    // Deduplication: same version+role should suppress — but these are
    // incremental deltas of the same version. The dedup rule prevents
    // duplicate message.deltas at the SAME version. But the real server
    // increments version for each delta. So let's test with increasing versions.
  });

  it("accumulates incremental deltas with increasing versions", () => {
    const incrementalEvents: StreamEvent[] = [
      { type: "message.delta", version: 1, payload: { content: "Build", role: "assistant" } },
      { type: "message.delta", version: 2, payload: { content: "ing", role: "assistant" } },
      { type: "message.delta", version: 3, payload: { content: " profile", role: "assistant" } },
    ];

    let state = emptyState;
    for (const ev of incrementalEvents) {
      state = reduceClientState(state, [ev]);
    }

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Building profile");
    expect(state.lastKnownVersion).toBe(3);
  });
});

// ── Replay idempotency (key PR2 requirement) ──

describe("replay idempotency", () => {
  it("replaying same events is idempotent", () => {
    // Apply events once
    const allEvents = [eventA, eventB, eventC, eventD, eventE];
    const first = reduceClientState(emptyState, allEvents);

    // "Reconnect" — fetch from version 0 via GET /events
    // The GET returns only events > cursor (which is 0 for fresh state)
    // But when reconnecting, we use the LAST known version
    const reconnectState: ClientState = {
      messages: first.messages,
      profileChanges: first.profileChanges,
      lastKnownVersion: first.lastKnownVersion,
      runId: first.runId,
    };

    // Replaying the same events should produce no changes
    const replay = reduceClientState(reconnectState, allEvents);
    expect(replay.messages).toHaveLength(first.messages.length);
    expect(replay.profileChanges).toEqual(first.profileChanges);
    expect(replay.lastKnownVersion).toBe(first.lastKnownVersion);
  });

  it("replaying only newer events after reconnect", () => {
    // Simulate a disconnect after v3. When the reconnect happens,
    // the client state should be at v3. The GET /events?lastKnownVersion=3
    // returns only v4 and v5.
    const stateAtV3: ClientState = {
      messages: [
        { id: "m1", role: "assistant", content: "Hello!", version: 1 },
        { id: "t1", role: "tool", content: "", toolName: "get_profile", toolStatus: "running", version: 2 },
        { id: "t2", role: "tool", content: "Profile loaded", toolName: "get_profile", toolStatus: "applied", version: 3 },
      ],
      profileChanges: [],
      lastKnownVersion: 3,
      runId: null,
    };

    // Events returned from GET /events?lastKnownVersion=3
    const newerEvents = [eventD, eventE]; // v4 (profile.updated), v5 (run.completed)

    const replay = reduceClientState(stateAtV3, newerEvents);

    // v4 profile.updated → profileChanges updated
    expect(replay.profileChanges).toEqual(["personal_info"]);
    // v5 run.completed → system message added
    expect(replay.messages).toHaveLength(4);
    expect(replay.messages[3].role).toBe("system");
    expect(replay.messages[3].content).toBe("run.completed");
    // Cursor advanced to v5
    expect(replay.lastKnownVersion).toBe(5);
    // runId tracked
    expect(replay.runId).toBe("run-1");
  });
});
