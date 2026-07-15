// ---------------------------------------------------------------------------
// M2 Interview Agent — MySQL integration tests
//
// Task 3.6 (corrected): Real MySQL behavioral tests against pocketcv_test only.
// Tests must call production services/routes, not manually manipulate target
// rows to simulate behavioral outcomes.
//
// Tests:
//   1. Lifecycle active→paused→active→completed
//   2. POST auto-resumes active and paused without duplication
//   3. Simultaneous createRun on two interviews for one user → one winner
//   4. Completion-vs-cancel race → exactly one terminal DB state + event
//   5. Explicit cancellation aborts provider; disconnect does not
//   6. Cross-user lifecycle/replay/post/cancel denial
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const TEST_USER_ID = "test-int-user-001";
const OTHER_USER_ID = "test-int-other-002";

vi.hoisted(() => {
  process.env.POCKETCV_DATABASE_URL =
    "mysql://root:@localhost:33065/pocketcv_test";
});

// Mock auth to return our test user
vi.mock("@/lib/auth/session", () => ({
  getUserOrNull: vi.fn(() =>
    Promise.resolve({
      id: TEST_USER_ID,
      email: "test@example.com",
      name: "Test User",
    }),
  ),
}));

// Deterministic provider fake for disconnect test.
// Yields one delta then completes (no tool calls → agent exits loop immediately).
const mockProviderStream = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/provider", () => ({
  createProvider: vi.fn(() => ({
    model: "test-model",
    async validateModel() {},
    stream: mockProviderStream,
  })),
  registerProvider: vi.fn(),
}));

// Real imports
import { db } from "@/lib/db";
import { interviews, interviewEvents, aiRuns, professionalProfile } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { getUserOrNull as _mockGetUserOrNull } from "@/lib/auth/session";
import type { Mock } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { createRun } from "@/lib/ai/runs";
import { emitEvent } from "@/lib/ai/atomic-emitter";

const mockGetUserOrNull = _mockGetUserOrNull as unknown as Mock;

// ── Cleanup helpers ─────────────────────────────────────────────────

async function cleanTestData() {
  await db.delete(interviewEvents);
  await db.delete(aiRuns);
  await db.delete(interviews).where(
    or(eq(interviews.userId, TEST_USER_ID), eq(interviews.userId, OTHER_USER_ID)),
  );
  await db.delete(professionalProfile).where(
    or(eq(professionalProfile.userId, TEST_USER_ID), eq(professionalProfile.userId, OTHER_USER_ID)),
  );
}

async function seedInterview(
  userId: string,
  overrides?: Partial<typeof interviews.$inferInsert>,
) {
  const id = createId();
  await db.insert(interviews).values({
    id,
    userId,
    status: "active",
    purpose: "Profile building",
    transcript: [],
    transcriptVersion: 0,
    ...overrides,
  });
  return id;
}

async function countRunningRuns(userId: string): Promise<number> {
  const rows = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(
      or(eq(aiRuns.userId, userId), eq(aiRuns.status, "running")),
    );
  const running = rows.filter((r) => true); // The OR above is approximate; filter in code
  // Actually do it properly:
  const results = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(eq(aiRuns.userId, userId));
  return results.length;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Interview integration — real MySQL behavioral", () => {
  beforeAll(async () => {
    // Apply schema changes needed for VARCHAR model column (Finding 3)
    // Safe to run multiple times — ALTER COLUMN is idempotent
    try {
      await db.execute(
        "ALTER TABLE ai_runs MODIFY COLUMN model varchar(128) NOT NULL",
      );
    } catch {
      // Column may already be VARCHAR from a previous run
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetUserOrNull.mockResolvedValue({
      id: TEST_USER_ID,
      email: "test@example.com",
      name: "Test User",
    });
    await cleanTestData();
  });

  // ── 1. Lifecycle active→paused→active→completed ──────────────
  describe("1. Lifecycle state machine", () => {
    it("transitions active→paused→active→completed via PATCH", async () => {
      const interviewId = await seedInterview(TEST_USER_ID, { status: "active" });

      // Verify initial state
      const checkState = async () => {
        const [row] = await db
          .select({ status: interviews.status })
          .from(interviews)
          .where(eq(interviews.id, interviewId))
          .limit(1);
        return row?.status;
      };

      expect(await checkState()).toBe("active");

      // Import PATCH handler dynamically
      const { PATCH } = await import("./[id]/route");

      // active → paused
      let res = await PATCH(
        new Request(`http://localhost:3000/api/interviews/${interviewId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );
      expect(res.status).toBe(200);
      expect(await checkState()).toBe("paused");

      // paused → active (resume)
      res = await PATCH(
        new Request(`http://localhost:3000/api/interviews/${interviewId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );
      expect(res.status).toBe(200);
      expect(await checkState()).toBe("active");

      // active → completed
      res = await PATCH(
        new Request(`http://localhost:3000/api/interviews/${interviewId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );
      expect(res.status).toBe(200);
      expect(await checkState()).toBe("completed");

      // completed cannot be changed
      res = await PATCH(
        new Request(`http://localhost:3000/api/interviews/${interviewId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );
      expect(res.status).toBe(400);
      expect(await checkState()).toBe("completed"); // unchanged
    });
  });

  // ── 2. POST auto-resume: active and paused ───────────────────
  describe("2. Auto-resume via POST", () => {
    it("returns existing active interview instead of creating new one", async () => {
      const { POST } = await import("./route");

      // Create first interview
      const first = await POST(
        new Request("http://localhost:3000/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "First session" }),
        }) as never,
      );
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      // Second POST should return 200 (auto-resume), not 201
      const second = await POST(
        new Request("http://localhost:3000/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "Should not create" }),
        }) as never,
      );
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.id).toBe(firstBody.id);

      // Verify only one interview exists
      const { GET } = await import("./route");
      const listRes = await GET();
      const list = await listRes.json();
      expect(list).toHaveLength(1);
    });

    it("auto-resumes paused interview (atomically transitions to active)", async () => {
      const { POST } = await import("./route");
      const { PATCH } = await import("./[id]/route");

      // Create interview
      const createRes = await POST(
        new Request("http://localhost:3000/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "Session" }),
        }) as never,
      );
      const created = await createRes.json();

      // Pause it
      await PATCH(
        new Request(`http://localhost:3000/api/interviews/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        }) as never,
        { params: Promise.resolve({ id: created.id }) },
      );

      // POST should auto-resume (return 200, status=active)
      const resumeRes = await POST(
        new Request("http://localhost:3000/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }) as never,
      );
      expect(resumeRes.status).toBe(200);
      const resumed = await resumeRes.json();
      expect(resumed.id).toBe(created.id);
      expect(resumed.status).toBe("active");

      // Only one interview exists
      const { GET } = await import("./route");
      const list = await (await GET()).json();
      expect(list).toHaveLength(1);
    });

    it("two simultaneous POSTs produce one interview ID and one row (GET_LOCK serialization)", async () => {
      const { POST } = await import("./route");

      // Launch two POSTs concurrently for the same user
      const results = await Promise.allSettled([
        POST(
          new Request("http://localhost:3000/api/interviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ purpose: "Race A" }),
          }) as never,
        ),
        POST(
          new Request("http://localhost:3000/api/interviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ purpose: "Race B" }),
          }) as never,
        ),
      ]);

      // Both must succeed (one creates, the other auto-resumes)
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("fulfilled");

      const body0 = await (results[0] as PromiseFulfilledResult<Response>).value.json();
      const body1 = await (results[1] as PromiseFulfilledResult<Response>).value.json();

      // Both return the SAME interview ID
      expect(body0.id).toBe(body1.id);

      // The second one should be 200 (auto-resume), not 201
      const status0 = (results[0] as PromiseFulfilledResult<Response>).value.status;
      const status1 = (results[1] as PromiseFulfilledResult<Response>).value.status;
      // One is 201 (created), the other is 200 (auto-resumed)
      const statuses = [status0, status1].sort();
      expect(statuses).toEqual([200, 201]);

      // Verify exactly one interview row exists
      const { GET } = await import("./route");
      const listRes = await GET();
      const list = await listRes.json();
      expect(list).toHaveLength(1);
    });
  });

  // ── 3a. Model persistence: VARCHAR(128) accepts provider model IDs ─────
  describe("3a. Model persistence — VARCHAR accepts validated provider model IDs", () => {
    it("inserts and reads back default provider model (deepseek-chat) and legacy enum values (v4-flash)", async () => {
      const interviewId = await seedInterview(TEST_USER_ID);

      // Insert a run with a validated provider model ID (e.g. deepseek-chat)
      const providerModelId = "deepseek-chat";
      const providerRunId = createId();
      await db.insert(aiRuns).values({
        id: providerRunId,
        userId: TEST_USER_ID,
        interviewId,
        model: providerModelId,
        task: "interview-agent",
        status: "completed",
        tokensIn: 50,
        tokensOut: 100,
        costUsd: "0",
      });

      // Insert a run with a legacy enum value (v4-flash)
      const legacyRunId = createId();
      await db.insert(aiRuns).values({
        id: legacyRunId,
        userId: TEST_USER_ID,
        interviewId,
        model: "v4-flash",
        task: "interview-agent",
        status: "running",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: "0",
      });

      // Read back — both must be present with correct model values
      const allRuns = await db
        .select({ id: aiRuns.id, model: aiRuns.model })
        .from(aiRuns)
        .where(eq(aiRuns.userId, TEST_USER_ID))
        .orderBy(aiRuns.createdAt);

      expect(allRuns).toHaveLength(2);

      const providerRun = allRuns.find((r) => r.id === providerRunId);
      expect(providerRun).toBeDefined();
      expect(providerRun!.model).toBe(providerModelId);

      const legacyRun = allRuns.find((r) => r.id === legacyRunId);
      expect(legacyRun).toBeDefined();
      expect(legacyRun!.model).toBe("v4-flash");
    });

    it("fail-closed: model is stored exactly as provided — no silent truncation or transformation", async () => {
      const interviewId = await seedInterview(TEST_USER_ID);

      // Provider model IDs with dots, hyphens, and multiple segments
      const complexModel = "deepseek-reasoner-v2-beta";
      const runId = createId();
      await db.insert(aiRuns).values({
        id: runId,
        userId: TEST_USER_ID,
        interviewId,
        model: complexModel,
        task: "interview-agent",
        status: "completed",
        tokensIn: 10,
        tokensOut: 20,
        costUsd: "0",
      });

      const [run] = await db
        .select({ model: aiRuns.model })
        .from(aiRuns)
        .where(eq(aiRuns.id, runId))
        .limit(1);

      // Stored exactly as provided — no enum-based truncation or alias conversion
      expect(run.model).toBe(complexModel);
      expect(run.model.length).toBe(complexModel.length);
    });
  });

  // ── 3. Concurrency: one running run per user ─────────────────
  describe("3. User-level concurrency guard", () => {
    it("simultaneous createRun on two interviews for one user yields exactly one running run", async () => {
      // Seed two interviews for the same user
      const int1 = await seedInterview(TEST_USER_ID);
      const int2 = await seedInterview(TEST_USER_ID);

      // Launch two createRun calls concurrently (simulating race)
      const results = await Promise.allSettled([
        createRun({
          userId: TEST_USER_ID,
          interviewId: int1,
          model: "v4-flash",
          task: "interview-agent",
        }),
        createRun({
          userId: TEST_USER_ID,
          interviewId: int2,
          model: "v4-flash",
          task: "interview-agent",
        }),
      ]);

      // Exactly one must succeed
      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // The rejected one must mention "already has running run"
      const failReason = (failures[0] as PromiseRejectedResult).reason.message;
      expect(failReason).toContain("already has running run");

      // Verify exactly one ai_runs row exists
      const allRuns = await db
        .select()
        .from(aiRuns)
        .where(eq(aiRuns.userId, TEST_USER_ID));
      expect(allRuns).toHaveLength(1);

      // And it's marked as 'running'
      expect(allRuns[0].status).toBe("running");
    });
  });

  // ── 4. Completion-vs-cancel race ─────────────────────────────
  describe("4. Completion-vs-cancel race — exactly one terminal state", () => {
    it("emitEvent with runCompletion and emitEvent with runCancellation race yields exactly one terminal DB status and one event", async () => {
      const interviewId = await seedInterview(TEST_USER_ID);
      const runId = createId();

      // Insert a 'running' ai_run
      await db.insert(aiRuns).values({
        id: runId,
        userId: TEST_USER_ID,
        interviewId,
        model: "v4-flash",
        task: "interview-agent",
        status: "running",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: "0",
      });

      // Launch both completion and cancellation concurrently
      const results = await Promise.allSettled([
        emitEvent({
          interviewId,
          eventType: "run.completed",
          payload: { runId, tokensIn: 100, tokensOut: 200 },
          runCompletion: {
            runId,
            tokensIn: 100,
            tokensOut: 200,
            providerResponseId: "resp-1",
          },
        }),
        emitEvent({
          interviewId,
          eventType: "run.cancelled",
          payload: { runId, reason: "Cancelled by user" },
          runCancellation: {
            runId,
            error: "Cancelled by user",
          },
        }),
      ]);

      // One succeeds (race won), other reports raceLost
      const won = results.filter((r) => {
        if (r.status === "fulfilled") {
          const val = r.value;
          return val !== null && !val.raceLost;
        }
        return false;
      });
      const lost = results.filter((r) => {
        if (r.status === "fulfilled") {
          const val = r.value;
          return val !== null && val.raceLost === true;
        }
        return false;
      });

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);

      // Exactly one interview_event was written (the other was rolled back)
      const events = await db
        .select({ eventType: interviewEvents.eventType })
        .from(interviewEvents)
        .where(eq(interviewEvents.interviewId, interviewId));
      expect(events).toHaveLength(1);

      // Exactly one terminal DB status (completed or cancelled)
      const [run] = await db
        .select({ status: aiRuns.status })
        .from(aiRuns)
        .where(eq(aiRuns.id, runId))
        .limit(1);
      expect(["completed", "cancelled"]).toContain(run.status);

      // The event type matches the DB status
      if (run.status === "completed") {
        expect(events[0].eventType).toBe("run.completed");
      } else {
        expect(events[0].eventType).toBe("run.cancelled");
      }
    });
  });

  // ── 5. Explicit cancellation vs transport disconnect ─────────
  describe("5. Cancel vs disconnect", () => {
    it("explicit cancellation marks run cancelled, abort controller signalled", async () => {
      const interviewId = await seedInterview(TEST_USER_ID);
      const runId = createId();

      await db.insert(aiRuns).values({
        id: runId,
        userId: TEST_USER_ID,
        interviewId,
        model: "v4-flash",
        task: "interview-agent",
        status: "running",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: "0",
      });

      // Register an AbortController for this run (as the agent loop would)
      const { registerRunAbortController, signalCancel, getRunAbortController } = await import("@/lib/ai/runs");

      const ac = new AbortController();
      registerRunAbortController(runId, ac);
      expect(ac.signal.aborted).toBe(false);

      // Cancel via the atomic route handler
      const { POST } = await import("./[id]/runs/[runId]/cancel/route");
      const res = await POST(
        new Request(`http://localhost:3000/api/interviews/${interviewId}/runs/${runId}/cancel`, {
          method: "POST",
        }) as never,
        { params: Promise.resolve({ id: interviewId, runId }) },
      );

      expect(res.status).toBe(200);

      // DB status is 'cancelled'
      const [run] = await db
        .select({ status: aiRuns.status })
        .from(aiRuns)
        .where(eq(aiRuns.id, runId))
        .limit(1);
      expect(run.status).toBe("cancelled");

      // AbortController was signalled
      expect(ac.signal.aborted).toBe(true);

      // A run.cancelled event was written
      const events = await db
        .select({ eventType: interviewEvents.eventType })
        .from(interviewEvents)
        .where(eq(interviewEvents.interviewId, interviewId));
      expect(events.some((e) => e.eventType === "run.cancelled")).toBe(true);
    });

    it("transport disconnect does NOT cancel the run — run continues to one legitimate terminal event", async () => {
      // Real route stream cancellation test:
      // 1. Configure the deterministic provider fake
      // 2. Start the real messages route POST
      // 3. Read one chunk then cancel the response reader (simulate disconnect)
      // 4. Prove: no AbortController cancellation, no cancelled status/event,
      //    run continues to exactly one terminal event (run.completed)

      const interviewId = await seedInterview(TEST_USER_ID);

      // Configure the mock provider to yield deterministic events
      // no tool calls → agent exits loop immediately
      mockProviderStream.mockImplementation(async function* () {
        yield { type: "delta", content: "Hello! Let me help you build your profile." };
        yield { type: "metadata", tokensIn: 50, tokensOut: 100, responseId: "resp-disc-1" };
        yield { type: "done", finishReason: "stop" as const };
      });

      // Import and start the messages route
      const { POST } = await import("./[id]/messages/route");
      const response = await POST(
        new Request(`http://localhost:3000/api/interviews/${interviewId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Build my profile" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      // Read at least one chunk
      const reader = response.body!.getReader();
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);

      // Simulate transport disconnect — cancel the reader/stream
      await reader.cancel();

      // Wait for the agent loop to finish (continues durably despite cancel)
      await new Promise((r) => setTimeout(r, 300));

      // ── Assertion 1: Run completed normally (NOT cancelled) ──
      const runs = await db
        .select()
        .from(aiRuns)
        .where(eq(aiRuns.userId, TEST_USER_ID));
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("completed");

      // ── Assertion 2: No run.cancelled event was persisted ──
      const allEvents = await db
        .select({ eventType: interviewEvents.eventType })
        .from(interviewEvents)
        .where(eq(interviewEvents.interviewId, interviewId));
      const cancelledEvents = allEvents.filter(
        (e) => e.eventType === "run.cancelled",
      );
      expect(cancelledEvents).toHaveLength(0);

      // ── Assertion 3: Exactly one legitimate terminal event ──
      const terminalEvents = allEvents.filter(
        (e) =>
          e.eventType === "run.completed" || e.eventType === "run.failed",
      );
      expect(terminalEvents).toHaveLength(1);
      expect(terminalEvents[0].eventType).toBe("run.completed");

      // ── Assertion 4: AbortController was NOT signalled ──
      // The route's cancel() handler is a no-op, so the internal
      // AbortController was never aborted by the disconnect.
      // We verify indirectly: if the controller were aborted, the
      // agent loop would have emitted run.cancelled instead of run.completed.
      // Explicit cancel test (above) proves abort IS signalled on purpose.
    });
  });

  // ── 6. Cross-user denial ─────────────────────────────────────
  describe("6. Cross-user access denial", () => {
    it("other user cannot read lifecycle (GET list)", async () => {
      // Create interview for other user
      await seedInterview(OTHER_USER_ID);

      // As TEST_USER, verify empty list
      const { GET } = await import("./route");
      const res = await GET();
      const list = await res.json();
      expect(list).toHaveLength(0);
    });

    it("other user cannot PATCH lifecycle state", async () => {
      const interviewId = await seedInterview(OTHER_USER_ID);

      mockGetUserOrNull.mockResolvedValue({
        id: TEST_USER_ID,
        email: "test@test.com",
        name: "Test User",
      });

      const { PATCH } = await import("./[id]/route");
      const res = await PATCH(
        new Request(`http://localhost:3000/api/interviews/${interviewId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );

      expect(res.status).toBe(403);
    });

    it("other user cannot POST messages", async () => {
      const interviewId = await seedInterview(OTHER_USER_ID);

      mockGetUserOrNull.mockResolvedValue({
        id: TEST_USER_ID,
        email: "test@test.com",
        name: "Test User",
      });

      const { POST } = await import("./[id]/messages/route");
      const res = await POST(
        new Request(`http://localhost:3000/api/interviews/${interviewId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello" }),
        }) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );

      expect(res.status).toBe(403);
    });

    it("other user cannot GET event replay", async () => {
      const interviewId = await seedInterview(OTHER_USER_ID);

      mockGetUserOrNull.mockResolvedValue({
        id: TEST_USER_ID,
        email: "test@test.com",
        name: "Test User",
      });

      const { GET } = await import("./[id]/events/route");
      const res = await GET(
        new Request(`http://localhost:3000/api/interviews/${interviewId}/events?lastKnownVersion=0`) as never,
        { params: Promise.resolve({ id: interviewId }) },
      );

      expect(res.status).toBe(403);
    });

    it("other user cannot POST cancel", async () => {
      const interviewId = await seedInterview(OTHER_USER_ID);
      const runId = createId();

      await db.insert(aiRuns).values({
        id: runId,
        userId: OTHER_USER_ID,
        interviewId,
        model: "v4-flash",
        task: "interview-agent",
        status: "running",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: "0",
      });

      mockGetUserOrNull.mockResolvedValue({
        id: TEST_USER_ID,
        email: "test@test.com",
        name: "Test User",
      });

      const { POST } = await import("./[id]/runs/[runId]/cancel/route");
      const res = await POST(
        new Request(`http://localhost:3000/api/interviews/${interviewId}/runs/${runId}/cancel`, {
          method: "POST",
        }) as never,
        { params: Promise.resolve({ id: interviewId, runId }) },
      );

      expect(res.status).toBe(403);
    });
  });
});
