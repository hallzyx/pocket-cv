import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — shared across test blocks
// ---------------------------------------------------------------------------
const { mockGetUserOrNull, dbChain } = vi.hoisted(() => {
  let _dbData: unknown[] = [];

  const thenable = {
    then: (resolve: (v: unknown[]) => void) => resolve(_dbData),
    catch: () => {},
  };

  const whereFn = vi.fn(() => ({ limit: vi.fn(() => thenable), orderBy: vi.fn(() => thenable) }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const insertValues = vi.fn(() => Promise.resolve());
  const insertFn = vi.fn(() => ({ values: insertValues }));
  const updateSet = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
  const updateFn = vi.fn(() => ({ set: updateSet }));
  const deleteFn = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));

  return {
    mockGetUserOrNull: vi.fn(),
    dbChain: {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
      delete: deleteFn,
      _setData: (d: unknown[]) => { _dbData = d; },
    },
  };
});

vi.mock("@/lib/auth/session", () => ({ getUserOrNull: mockGetUserOrNull }));
vi.mock("@/lib/db", () => ({ db: { select: dbChain.select, insert: dbChain.insert, update: dbChain.update, delete: dbChain.delete } }));

// Minimal profile sync mock to avoid errors — the real merge logic is tested in
// profile/sync.test.ts (Phase 1 covers it structurally).
vi.mock("@/lib/profile/sync", () => ({ mergeCvIntoProfile: () => ({}) }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Auth scoping — CV routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated as Alice
    mockGetUserOrNull.mockResolvedValue({ id: "alice", email: "alice@test.com", name: "Alice" });
    // Default CV data: owned by Bob
    dbChain._setData([
      { id: "cv-bob-1", userId: "bob", title: "Bob's CV", contentJson: { personalInfo: {}, experiences: [], education: [], skills: [] } },
    ]);
  });

  // ── GET /api/cvs/[cvId] ──
  describe("GET /api/cvs/[cvId]", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { GET } = await import("./[cvId]/route");
      const response = await GET(
        new Request("http://localhost:3000/api/cvs/cv-bob-1") as never,
        { params: Promise.resolve({ cvId: "cv-bob-1" }) },
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should return 403 when Alice tries to access Bob's CV", async () => {
      const { GET } = await import("./[cvId]/route");
      const response = await GET(
        new Request("http://localhost:3000/api/cvs/cv-bob-1") as never,
        { params: Promise.resolve({ cvId: "cv-bob-1" }) },
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });

  // ── PATCH /api/cvs/[cvId] ──
  describe("PATCH /api/cvs/[cvId]", () => {
    it("should return 403 when Alice tries to update Bob's CV", async () => {
      const { PATCH } = await import("./[cvId]/route");
      const response = await PATCH(
        new Request("http://localhost:3000/api/cvs/cv-bob-1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Stolen CV" }),
        }) as never,
        { params: Promise.resolve({ cvId: "cv-bob-1" }) },
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });

  // ── DELETE /api/cvs/[cvId] ──
  describe("DELETE /api/cvs/[cvId]", () => {
    it("should return 403 when Alice tries to delete Bob's CV", async () => {
      const { DELETE } = await import("./[cvId]/route");
      const response = await DELETE(
        new Request("http://localhost:3000/api/cvs/cv-bob-1", { method: "DELETE" }) as never,
        { params: Promise.resolve({ cvId: "cv-bob-1" }) },
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });
});

// ---------------------------------------------------------------------------
// Profile auth scoping
// ---------------------------------------------------------------------------
describe("Auth scoping — profile routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/profile", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);
      dbChain._setData([]);

      const { GET } = await import("../profile/route");
      const response = await GET();

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("PATCH /api/profile", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);
      dbChain._setData([]);

      const { PATCH } = await import("../profile/route");
      const response = await PATCH(
        new Request("http://localhost:3000/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personalInfo: { fullName: "Test" } }),
        }) as never,
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });
  });
});

// ---------------------------------------------------------------------------
// CV CRUD — list / create
// ---------------------------------------------------------------------------
describe("Auth scoping — CV list & create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/cvs", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { GET } = await import("./route");
      const response = await GET();

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("POST /api/cvs", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetUserOrNull.mockResolvedValue(null);

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost:3000/api/cvs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New CV" }),
        }) as never,
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });
  });
});
