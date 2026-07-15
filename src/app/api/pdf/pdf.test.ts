import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — use vi.hoisted so factories can reference these variables
// ---------------------------------------------------------------------------
const { mockGetUserOrNull, dbChain } = vi.hoisted(() => {
  // Track the last-set db data so each test can control what the fake chain
  // resolves to.
  let _dbData: unknown[] = [];

  const thenable = {
    then: (resolve: (v: unknown[]) => void) => resolve(_dbData),
    catch: () => {},
  };

  // Build the lowest-level mock once; inner functions capture _dbData by ref.
  const whereFn = vi.fn(() => ({ limit: vi.fn(() => thenable), orderBy: vi.fn(() => thenable) }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const insert = vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }));
  const del = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));

  return {
    mockGetUserOrNull: vi.fn(),
    dbChain: { select: selectFn, insert, update, delete: del, _setData: (d: unknown[]) => { _dbData = d; } },
  };
});

// Hoisted mocks registered with vitest
vi.mock("@/lib/auth/session", () => ({ getUserOrNull: mockGetUserOrNull }));
vi.mock("@/lib/db", () => ({ db: { select: dbChain.select, insert: dbChain.insert, update: dbChain.update, delete: dbChain.delete } }));
vi.mock("@/lib/latex/compile", () => ({
  compileLatex: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 fake")),
  CompileError: class extends Error { log?: string; constructor(m: string, log?: string) { super(m); this.name = "CompileError"; this.log = log; } },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/pdf/[cvId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated as user-1
    mockGetUserOrNull.mockResolvedValue({ id: "user-1", email: "a@b.com", name: "User A" });

    // Default: CV belongs to user-1
    dbChain._setData([
      { id: "cv-1", userId: "user-1", title: "My CV", contentJson: { personalInfo: {}, experiences: [], education: [], skills: [] }, texSource: null },
    ]);
  });

  it("should return 401 when not authenticated", async () => {
    mockGetUserOrNull.mockResolvedValue(null);

    const { GET } = await import("./[cvId]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/pdf/cv-1") as never,
      { params: Promise.resolve({ cvId: "cv-1" }) },
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when CV does not exist", async () => {
    dbChain._setData([]);

    const { GET } = await import("./[cvId]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/pdf/cv-999") as never,
      { params: Promise.resolve({ cvId: "cv-999" }) },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Not found");
  });

  it("should return 403 when CV belongs to another user", async () => {
    dbChain._setData([
      { id: "cv-2", userId: "user-2", title: "Other CV", contentJson: {} },
    ]);

    const { GET } = await import("./[cvId]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/pdf/cv-2") as never,
      { params: Promise.resolve({ cvId: "cv-2" }) },
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });

  it("should handle compile errors gracefully (500)", async () => {
    // Override compile mock to throw
    const compile = await import("@/lib/latex/compile");
    vi.mocked(compile.compileLatex).mockRejectedValue(
      new compile.CompileError("Tectonic crashed", "stderr output"),
    );

    const { GET } = await import("./[cvId]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/pdf/cv-1") as never,
      { params: Promise.resolve({ cvId: "cv-1" }) },
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Compilation failed");
    expect(body.details).toContain("Tectonic crashed");
  });

  it("should return a PDF binary with correct content headers on success", async () => {
    // Ensure compile mock returns a fake PDF
    const compile = await import("@/lib/latex/compile");
    vi.mocked(compile.compileLatex).mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const { GET } = await import("./[cvId]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/pdf/cv-1") as never,
      { params: Promise.resolve({ cvId: "cv-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="cv.pdf"');
  });
});
