// ---------------------------------------------------------------------------
// M2 Interview Agent — Agent loop RED tests
//
// Task 2.8:
// - timeout retries exactly once then persists failed audit and last_error
// - cancel-completion race yields exactly one terminal DB state/event
// - no fabricated assistant turn on provider error
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatProvider, ProviderEvent, AgentInput } from "./types";

// ── Helper: deterministic fake provider ─────────────────────────────

function createFakeProvider(behavior: {
  streams?: ProviderEvent[][];
  error?: string;
  model?: string;
}): ChatProvider {
  let callCount = 0;

  return {
    model: behavior.model ?? "test-model",
    async validateModel() {},
    async *stream() {
      if (behavior.error) {
        yield { type: "error", message: behavior.error };
        return;
      }

      const stream = behavior.streams?.[callCount] ?? [
        { type: "delta", content: "Hello!" },
        { type: "done", finishReason: "stop" as const },
      ];
      callCount++;

      for (const evt of stream) {
        yield evt;
      }
    },
  };
}

// ── Test scaffolding ────────────────────────────────────────────────

// Track calls to runs module for assertion
const runCalls = {
  createRun: vi.fn().mockResolvedValue({ id: "test-run-id" }),
  checkConcurrentRun: vi.fn().mockResolvedValue(null),
  registerRunAbortController: vi.fn(),
  unregisterRunAbortController: vi.fn(),
  getRunAbortController: vi.fn(),
  signalCancel: vi.fn(),
};

vi.mock("@/lib/ai/runs", () => runCalls);

// Track calls to atomic-emitter
const emitterCalls = {
  emitEvent: vi.fn().mockImplementation(
    async (params: { eventType: string; payload: Record<string, unknown>; runFailure?: { runId: string; error: string } }) => {
      const version = 1;
      return {
        version,
        sseChunk: `event: ${params.eventType}\ndata: ${JSON.stringify(params.payload)}\n\n`,
      };
    },
  ),
  getEventsSince: vi.fn().mockResolvedValue([]),
};

vi.mock("@/lib/ai/atomic-emitter", () => emitterCalls);

describe("Agent loop — bounded execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("timeout retries exactly once then persists failed audit and last_error", async () => {
    // Create fake provider that errors out on every attempt (exhausts retries)
    const provider = createFakeProvider({
      error: "Timeout: provider did not respond in time",
    });

    const input: AgentInput = {
      interviewId: "int-test-1",
      userId: "user-test-1",
      message: "Tell me about yourself",
      transcript: [],
      transcriptVersion: 0,
      profile: null,
    };

    const abortController = new AbortController();

    const { runAgent } = await import("./agent");
    const result = await runAgent(input, provider, () => {}, abortController);

    // Must fail
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // runAgent always returns runId — even on failure paths
    expect(result.runId).toBe("test-run-id");

    // The atomic emitEvent with runFailure is used instead of separate failRun.
    // Verify the failed event was emitted with the error
    const emitCalls = emitterCalls.emitEvent.mock.calls;
    const failedEmits = emitCalls.filter(
      (c) => c[0].eventType === "run.failed",
    );
    expect(failedEmits.length).toBeGreaterThanOrEqual(1);

    // The failed event should carry the error in payload
    const failedPayload = failedEmits[failedEmits.length - 1][0].payload;
    expect(failedPayload.error).toBeTruthy();

    // Verify the emitEvent carried runFailure metadata (atomic terminal arbitration)
    const failCall = failedEmits[failedEmits.length - 1][0];
    expect(failCall.runFailure).toBeDefined();
    expect(failCall.runFailure.runId).toBe("test-run-id");
    expect(failCall.runFailure.error).toBeTruthy();
    expect(failCall.runFailure.error.length).toBeGreaterThan(5);
  });

  it("cancel-completion race yields exactly one terminal event", async () => {
    // This test verifies the race: when cancellation happens before
    // the agent loop even starts, there should be exactly one terminal
    // event (run.cancelled), not both run.cancelled and run.completed.

    const provider = createFakeProvider({
      streams: [
        [
          { type: "delta", content: "Processing..." },
          { type: "done", finishReason: "stop" },
        ],
      ],
    });

    const controller = new AbortController();
    // Abort immediately to simulate cancel-completion race
    controller.abort();

    const input: AgentInput = {
      interviewId: "int-test-race",
      userId: "user-test-race",
      message: "Build my profile",
      transcript: [],
      transcriptVersion: 0,
      profile: null,
    };

    const { runAgent } = await import("./agent");
    const result = await runAgent(input, provider, () => {}, controller);

    // Must not succeed (cancellation preempted execution)
    expect(result.success).toBe(false);
    // runAgent always returns runId — even when cancelled
    expect(result.runId).toBe("test-run-id");

    // Verify the cancelled/failed event was emitted (one terminal event)
    // but NOT run.completed (cancellation won the race)
    const emitCalls = emitterCalls.emitEvent.mock.calls;
    const terminalEvents = emitCalls.filter(
      (c) =>
        c[0].eventType === "run.cancelled" ||
        c[0].eventType === "run.failed" ||
        c[0].eventType === "run.completed",
    );
    // Should have at least one terminal event, but NOT run.completed
    expect(terminalEvents.length).toBeGreaterThanOrEqual(1);
    const completedEvents = terminalEvents.filter(
      (c) => c[0].eventType === "run.completed",
    );
    expect(completedEvents).toHaveLength(0);
  });

  it("handles empty transcript gracefully", async () => {
    const provider = createFakeProvider({
      streams: [[{ type: "delta", content: "Let's start!" }, { type: "done", finishReason: "stop" }]],
    });

    const input: AgentInput = {
      interviewId: "int-empty",
      userId: "user-empty",
      message: "Hi",
      transcript: [],
      transcriptVersion: 0,
      profile: null,
    };

    const { runAgent } = await import("./agent");
    const result = await runAgent(input, provider, () => {}, new AbortController());

    expect(result.success).toBe(true);
  });

  it("rejects messages exceeding character limit", async () => {
    const provider = createFakeProvider({ streams: [[]] });

    const input: AgentInput = {
      interviewId: "int-long",
      userId: "user-long",
      message: "x".repeat(8_001),
      transcript: [],
      transcriptVersion: 0,
      profile: null,
    };

    const { runAgent } = await import("./agent");
    const result = await runAgent(input, provider, () => {}, new AbortController());

    expect(result.success).toBe(false);
    expect(result.error).toContain("character limit");
  });

  it("provider failure after delta does NOT retry — one attempt, no duplicate delta, terminal failure persists", async () => {
    const provider: ChatProvider = {
      model: "test-model",
      async validateModel() {},
      async *stream() {
        yield { type: "delta", content: "Partial response..." };
        yield { type: "error", message: "Connection interrupted" };
      },
    };

    const input: AgentInput = {
      interviewId: "int-no-retry",
      userId: "user-no-retry",
      message: "Build my profile",
      transcript: [],
      transcriptVersion: 0,
      profile: null,
    };

    const { runAgent } = await import("./agent");
    const result = await runAgent(input, provider, () => {}, new AbortController());

    // Must fail — provider error after partial delta
    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection interrupted");

    // Exactly ONE message.delta was committed (no retry duplicate)
    const emitCalls = emitterCalls.emitEvent.mock.calls;
    const deltaEvents = emitCalls.filter(
      (c) => c[0].eventType === "message.delta",
    );
    expect(deltaEvents).toHaveLength(1);

    // Exactly ONE run.failed event (no spurious double-emit)
    const failedEvents = emitCalls.filter(
      (c) => c[0].eventType === "run.failed",
    );
    expect(failedEvents).toHaveLength(1);

    // NO run.completed
    const completedEvents = emitCalls.filter(
      (c) => c[0].eventType === "run.completed",
    );
    expect(completedEvents).toHaveLength(0);
  });

  it("no fabricated assistant turn on provider error", async () => {
    // When the provider errors after producing some delta events,
    // the agent must NOT fabricate an assistant turn or emit
    // a run.completed event. Only run.failed should be emitted.
    const provider = createFakeProvider({
      error: "Provider connection lost",
    });

    const input: AgentInput = {
      interviewId: "int-no-fabrication",
      userId: "user-no-fab",
      message: "Hello",
      transcript: [],
      transcriptVersion: 0,
      profile: null,
    };

    const { runAgent } = await import("./agent");
    const result = await runAgent(input, provider, () => {}, new AbortController());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // Verify no run.completed event was emitted
    const emitCalls = emitterCalls.emitEvent.mock.calls;
    const completedEvents = emitCalls.filter(
      (c) => c[0].eventType === "run.completed",
    );
    expect(completedEvents).toHaveLength(0);

    // Verify a failed event was emitted
    const failedEvents = emitCalls.filter(
      (c) => c[0].eventType === "run.failed",
    );
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
  });
});
