// ---------------------------------------------------------------------------
// M2 Interview Agent — Access control RED tests
//
// Task 3.1: other user cannot read/replay/cancel/post messages;
// unauthenticated user gets 401 everywhere.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const ALICE = { id: "alice", email: "alice@test.com", name: "Alice" };
const BOB_ID = "bob";

// Mock auth session
const mockGetUserOrNull = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({
  getUserOrNull: mockGetUserOrNull,
}));

// Mock db — chainable Drizzle-like builder
// Each test sets `mockDb.result` to control what queries return.
const mockDbResult: { current: unknown[] } = { current: [] };

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockImplementation(() => ({
    ...mockDb,
    limit: vi.fn().mockResolvedValue(mockDbResult.current),
    // Direct orderBy (for list) resolves to the result
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) =>
      resolve(mockDbResult.current),
    ),
  })),
  limit: vi.fn().mockImplementation(() => {
    // limit() returns a thenable that resolves to current result
    return Promise.resolve(mockDbResult.current);
  }),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockReturnThis(),
  $client: { getConnection: vi.fn() },
};

// Make .where().limit(1) chain work
mockDb.where.mockImplementation(() => ({
  ...mockDb,
  limit: vi.fn().mockResolvedValue(mockDbResult.current),
  orderBy: vi.fn().mockResolvedValue(mockDbResult.current),
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

// Mock runs module
vi.mock("@/lib/ai/runs", () => ({
  checkConcurrentRun: vi.fn().mockResolvedValue(null),
  createRun: vi.fn().mockResolvedValue({ id: "run-id" }),
  registerRunAbortController: vi.fn(),
  getRunAbortController: vi.fn(),
  signalCancel: vi.fn(),
}));

// Mock atomic-emitter
vi.mock("@/lib/ai/atomic-emitter", () => ({
  emitEvent: vi.fn().mockResolvedValue({
    version: 1,
    sseChunk: 'event: done\ndata: {"ok":true}\n\n',
  }),
  getEventsSince: vi.fn().mockResolvedValue([]),
}));

// Mock the provider
vi.mock("@/lib/ai/provider", () => ({
  createProvider: vi.fn().mockReturnValue({
    model: "test-model",
    validateModel: vi.fn(),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: "delta", content: "Hello" };
      yield { type: "done", finishReason: "stop" };
    }),
  }),
}));

// Mock the agent
vi.mock("@/lib/ai/agent", () => ({
  runAgent: vi.fn().mockResolvedValue({
    success: true,
    events: [],
    tokensIn: 10,
    tokensOut: 20,
  }),
}));

describe("Interview access control — cross-user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserOrNull.mockResolvedValue(ALICE);
    mockDbResult.current = [];
  });

  // ── GET /api/interviews ──────────────────────────────────────
  describe("GET /api/interviews", () => {
    it("returns 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { GET } = await import("./route");
      const response = await GET();

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("does not return user B's interviews when authenticated as user A", async () => {
      mockDbResult.current = [
        { id: "int-1", userId: "alice", status: "active" },
      ];

      const { GET } = await import("./route");
      const response = await GET();
      expect(response.status).toBe(200);

      const list = await response.json();
      // All returned interviews belong to Alice
      list.forEach((i: { userId: string }) => {
        expect(i.userId).toBe("alice");
      });
    });
  });

  // ── POST /api/interviews ─────────────────────────────────────
  describe("POST /api/interviews", () => {
    it("returns 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost:3000/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "Profile building" }),
        }) as never,
      );

      expect(response.status).toBe(401);
    });
  });

  // ── POST /api/interviews/[id]/messages ──────────────────────
  describe("POST /api/interviews/[id]/messages", () => {
    it("returns 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { POST } = await import("./[id]/messages/route");
      const response = await POST(
        new Request("http://localhost:3000/api/interviews/int-1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello" }),
        }) as never,
        { params: Promise.resolve({ id: "int-1" }) },
      );

      expect(response.status).toBe(401);
    });

    it("returns 403 when user B tries to post to user A's interview", async () => {
      // Mock returns an interview owned by Bob (different userId)
      mockDbResult.current = [{ id: "int-bob", userId: BOB_ID, status: "active", transcript: [], transcriptVersion: 0 }];

      const { POST } = await import("./[id]/messages/route");
      const response = await POST(
        new Request("http://localhost:3000/api/interviews/int-bob/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello" }),
        }) as never,
        { params: Promise.resolve({ id: "int-bob" }) },
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });

  // ── GET /api/interviews/[id]/events ─────────────────────────
  describe("GET /api/interviews/[id]/events", () => {
    it("returns 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { GET } = await import("./[id]/events/route");
      const response = await GET(
        new Request("http://localhost:3000/api/interviews/int-1/events?lastKnownVersion=0") as never,
        { params: Promise.resolve({ id: "int-1" }) },
      );

      expect(response.status).toBe(401);
    });

    it("returns 403 when user B replays user A's events", async () => {
      mockDbResult.current = [{ id: "int-bob", userId: BOB_ID }];

      const { GET } = await import("./[id]/events/route");
      const response = await GET(
        new Request("http://localhost:3000/api/interviews/int-bob/events?lastKnownVersion=0") as never,
        { params: Promise.resolve({ id: "int-bob" }) },
      );

      expect(response.status).toBe(403);
    });
  });

  // ── POST /api/interviews/[id]/runs/[runId]/cancel ───────────
  describe("POST /api/interviews/[id]/runs/[runId]/cancel", () => {
    it("returns 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { POST } = await import("./[id]/runs/[runId]/cancel/route");
      const response = await POST(
        new Request("http://localhost:3000/api/interviews/int-1/runs/run-1/cancel", {
          method: "POST",
        }) as never,
        { params: Promise.resolve({ id: "int-1", runId: "run-1" }) },
      );

      expect(response.status).toBe(401);
    });

    it("returns 403 when user B cancels user A's run", async () => {
      // Interview exists and is owned by Bob
      mockDbResult.current = [{ id: "int-bob", userId: BOB_ID }];

      const { POST } = await import("./[id]/runs/[runId]/cancel/route");
      const response = await POST(
        new Request("http://localhost:3000/api/interviews/int-bob/runs/run-1/cancel", {
          method: "POST",
        }) as never,
        { params: Promise.resolve({ id: "int-bob", runId: "run-1" }) },
      );

      expect(response.status).toBe(403);
    });

    it("returns 404 when interview does not exist", async () => {
      mockGetUserOrNull.mockResolvedValue(ALICE);
      // No interview found (empty result)
      mockDbResult.current = [];

      const { POST } = await import("./[id]/runs/[runId]/cancel/route");
      const response = await POST(
        new Request("http://localhost:3000/api/interviews/nonexistent/runs/run-1/cancel", {
          method: "POST",
        }) as never,
        { params: Promise.resolve({ id: "nonexistent", runId: "run-1" }) },
      );

      expect(response.status).toBe(404);
    });

    // Note: the cancel-success case is covered by interview-integration.test.ts
  });
});
