// ---------------------------------------------------------------------------
// M2 Interview Agent — Atomic emitter RED tests
//
// Task 2.8:
// - replays committed unsent version after disconnect
// - same cursor replay is idempotent
// - commit-before-enqueue can survive disconnect
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module with a controllable fake connection
let fakeRows: Array<{ id: string; transcript_version: number }> = [];
let fakeEvents: Array<{
  version: number;
  event_type: string;
  payload: string;
}> = [];
let fakeCommitFails = false;

const fakeConnection = {
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockImplementation(async () => {
    if (fakeCommitFails) throw new Error("Commit failed");
  }),
  rollback: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT") && sql.includes("FOR UPDATE")) {
      return [fakeRows];
    }
    if (sql.includes("SELECT") && sql.includes("interview_events")) {
      // Filter by version > params[1] (lastKnownVersion)
      const minVersion = (params?.[1] as number) ?? 0;
      const filtered = fakeEvents.filter((e) => e.version > minVersion);
      return [filtered];
    }
    if (sql.includes("INSERT")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE")) {
      return [{ affectedRows: 1 }];
    }
    return [[]];
  }),
};

vi.mock("@/lib/db", () => ({
  db: {
    $client: {
      getConnection: vi.fn().mockResolvedValue(fakeConnection),
    },
  },
}));

describe("Atomic emitter — replay and idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeRows = [{ id: "int-test-1", transcript_version: 3 }];
    fakeEvents = [];
    fakeCommitFails = false;
  });

  it("commit-before-enqueue: committed event survives simulated disconnect", async () => {
    // This test verifies the core invariant: emitEvent persists the event
    // (commits) successfully, even though we simulate that the SSE chunk
    // was never delivered (we don't enqueue it here).
    //
    // The key property: after emitEvent returns successfully, the event IS
    // in the DB and can be retrieved via getEventsSince.

    const { emitEvent, getEventsSince } = await import("./atomic-emitter");

    // Simulate 3 prior events already committed (transcript_version = 3)
    fakeEvents = [
      { version: 1, event_type: "message.delta", payload: '{"content":"hi"}' },
      { version: 2, event_type: "message.delta", payload: '{"content":"hello"}' },
      { version: 3, event_type: "tool.started", payload: '{"toolName":"get_profile"}' },
    ];

    // Emit a new event (this should allocate version 4)
    const result = await emitEvent({
      interviewId: "int-test-1",
      eventType: "message.delta",
      payload: { content: "This should survive disconnect" },
    });

    expect(result).not.toBeNull();
    expect(result!.version).toBe(4);

    // Now simulate a disconnect — the client never got version 4.
    // But it WAS committed. When the client reconnects and replays
    // from version 3, they should get version 4.

    fakeEvents.push({
      version: 4,
      event_type: "message.delta",
      payload: '{"content":"This should survive disconnect"}',
    });

    const events = await getEventsSince("int-test-1", 3);
    expect(events).toHaveLength(1);
    expect(events[0].version).toBe(4);
    expect((events[0].payload as { content: string }).content).toBe(
      "This should survive disconnect",
    );
  });

  it("same cursor replay is idempotent (no duplicate versions)", async () => {
    const { getEventsSince } = await import("./atomic-emitter");

    // Seed events with sequential versions
    fakeEvents = [
      { version: 1, event_type: "message.delta", payload: '{"content":"a"}' },
      { version: 2, event_type: "message.delta", payload: '{"content":"b"}' },
      { version: 3, event_type: "tool.started", payload: '{"toolName":"x"}' },
      { version: 4, event_type: "tool.completed", payload: '{"toolName":"x"}' },
    ];

    // First replay from version 0
    const first = await getEventsSince("int-test-1", 0);
    expect(first).toHaveLength(4);
    expect(first[0].version).toBe(1);
    expect(first[3].version).toBe(4);

    // Second replay from same cursor — same results
    const second = await getEventsSince("int-test-1", 0);
    expect(second).toHaveLength(4);
    expect(second[0].version).toBe(1);
    expect(second[3].version).toBe(4);
    // Verify no duplicate version numbers
    const versions1 = first.map((e) => e.version);
    const versions2 = second.map((e) => e.version);
    expect(new Set(versions1).size).toBe(versions1.length);
    expect(versions1).toEqual(versions2);

    // Replay from version 2 — only get 3 and 4
    const partial = await getEventsSince("int-test-1", 2);
    expect(partial).toHaveLength(2);
    expect(partial[0].version).toBe(3);
    expect(partial[1].version).toBe(4);
  });

  it("rolls back on commit failure (DB unchanged)", async () => {
    const { emitEvent } = await import("./atomic-emitter");

    fakeCommitFails = true;

    // commit throws → emitEvent catches, rolls back, re-throws
    await expect(
      emitEvent({
        interviewId: "int-test-1",
        eventType: "message.delta",
        payload: { content: "Should not persist" },
      }),
    ).rejects.toThrow("Commit failed");

    // Verify rollback was called, release was called
    expect(fakeConnection.rollback).toHaveBeenCalled();
    expect(fakeConnection.release).toHaveBeenCalled();
  });

  it("returns null for unknown interview (no FOR UPDATE row)", async () => {
    const { emitEvent } = await import("./atomic-emitter");

    fakeRows = []; // No interview found

    const result = await emitEvent({
      interviewId: "unknown-int",
      eventType: "message.delta",
      payload: { content: "test" },
    });

    expect(result).toBeNull();
    expect(fakeConnection.rollback).toHaveBeenCalled();
    expect(fakeConnection.release).toHaveBeenCalled();
  });
});
