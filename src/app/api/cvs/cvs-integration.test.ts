// ---------------------------------------------------------------------------
// MySQL-backed integration tests for PocketCV M1 routes.
// Uses pocketcv_test — never touches the development database.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ---- Hoisted setup: override DB URL before any module loads ---------------
const TEST_USER_ID = "test-user-int-001";
const OTHER_USER_ID = "test-user-other-002";

vi.hoisted(() => {
  process.env.POCKETCV_DATABASE_URL =
    "mysql://root:@localhost:33065/pocketcv_test";
});

// Mock auth to return our test user (we cannot set up real Better-Auth sessions
// without a running Next.js server, but we need real DB reads/writes).
vi.mock("@/lib/auth/session", () => ({
  getUserOrNull: vi.fn(() =>
    Promise.resolve({
      id: TEST_USER_ID,
      email: "test@example.com",
      name: "Test User",
    }),
  ),
}));

// ---- Real imports (after env is configured) --------------------------------
import { db } from "@/lib/db";
import { cvs, professionalProfile } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull as _mockGetUserOrNull } from "@/lib/auth/session";
import type { Mock } from "vitest";
import { createId } from "@paralleldrive/cuid2";

// cast to Mock so we can call mockResolvedValue etc.
const mockGetUserOrNull = _mockGetUserOrNull as unknown as Mock;

// ---------- Helper: sample CV content factory -------------------------------
function sampleContent(overrides?: Record<string, unknown>) {
  return {
    personalInfo: {
      fullName: "Test User",
      headline: "Senior Engineer",
      email: "test@example.com",
    },
    summary: "A test summary",
    experiences: [
      {
        id: "exp-1",
        company: "Acme Corp",
        title: "Engineer",
        startDate: "2020-01",
        bullets: ["Did stuff"],
      },
    ],
    education: [],
    skills: [{ id: "sk-1", category: "Languages", items: ["TypeScript"] }],
    projects: [],
    achievements: [],
    ...overrides,
  };
}

// ---------- Cleanup helper --------------------------------------------------
async function cleanTestData() {
  await db.delete(cvs).where(eq(cvs.userId, TEST_USER_ID));
  await db.delete(cvs).where(eq(cvs.userId, OTHER_USER_ID));
  await db
    .delete(professionalProfile)
    .where(eq(professionalProfile.userId, TEST_USER_ID));
  await db
    .delete(professionalProfile)
    .where(eq(professionalProfile.userId, OTHER_USER_ID));
}

// ===========================================================================
// Tests
// ===========================================================================
describe("CV CRUD — integration (MySQL-backed)", () => {
  beforeAll(async () => {
    // Ensure the DB connection works
    await db.execute("SELECT 1");
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-stub getUserOrNull because clearAllMocks clears the mock implementation
    mockGetUserOrNull.mockResolvedValue({
      id: TEST_USER_ID,
      email: "test@example.com",
      name: "Test User",
    });
    await cleanTestData();
  });

  // ----- 1. GET /api/cvs returns the user's CVs and excludes others --------
  describe("GET /api/cvs", () => {
    it("returns only the authenticated user's CVs", async () => {
      // Create 2 CVs for our test user
      const { GET } = await import("./route");
      const userCvId = createId();
      const userCvId2 = createId();
      await db.insert(cvs).values([
        {
          id: userCvId,
          userId: TEST_USER_ID,
          title: "My CV",
          contentJson: sampleContent(),
          source: "manual",
        },
        {
          id: userCvId2,
          userId: TEST_USER_ID,
          title: "My Second CV",
          contentJson: sampleContent(),
          source: "manual",
        },
      ]);
      // Create a CV for another user
      await db.insert(cvs).values({
        id: createId(),
        userId: OTHER_USER_ID,
        title: "Other's CV",
        contentJson: sampleContent(),
        source: "manual",
      });

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toBeInstanceOf(Array);
      expect(body).toHaveLength(2);
      expect(body.map((c: { title: string }) => c.title)).toEqual(
        expect.arrayContaining(["My CV", "My Second CV"]),
      );
      expect(body.map((c: { userId: string }) => c.userId)).toEqual([
        TEST_USER_ID,
        TEST_USER_ID,
      ]);
    });
  });

  // ----- 2. POST /api/cvs creates a CV seeded from professional_profile -----
  describe("POST /api/cvs", () => {
    it("creates a CV seeded from the user's professional_profile", async () => {
      // Seed a profile first
      const profileId = createId();
      await db.insert(professionalProfile).values({
        id: profileId,
        userId: TEST_USER_ID,
        personalInfo: {
          fullName: "Profile Name",
          headline: "Senior Dev",
        },
        experiences: [
          {
            id: "prof-exp-1",
            company: "ProfileCorp",
            title: "Senior Engineer",
            startDate: "2019-06",
            bullets: ["Built things"],
          },
        ],
        education: [
          {
            id: "prof-edu-1",
            institution: "MIT",
            degree: "BS",
            field: "CS",
          },
        ],
        skills: [{ id: "prof-sk-1", category: "Tools", items: ["Go"] }],
      });

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost:3000/api/cvs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "My Derived CV",
            jobOfferId: null,
          }),
        }) as never,
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.title).toBe("My Derived CV");
      expect(body.userId).toBe(TEST_USER_ID);
      expect(body.source).toBe("manual");

      // contentJson should be seeded from profile
      expect(body.contentJson.personalInfo.fullName).toBe("Profile Name");
      expect(body.contentJson.experiences).toHaveLength(1);
      expect(body.contentJson.experiences[0].company).toBe("ProfileCorp");
      expect(body.contentJson.education).toHaveLength(1);
      expect(body.contentJson.skills).toHaveLength(1);

      // Verify it's persisted
      const [saved] = await db
        .select()
        .from(cvs)
        .where(eq(cvs.id, body.id))
        .limit(1);
      expect(saved).toBeDefined();
    });

    it("returns 400 when title is missing", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost:3000/api/cvs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }) as never,
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Title is required");
    });
  });

  // ----- 3. GET /api/cvs/[cvId] returns an owned CV -----------------------
  describe("GET /api/cvs/[cvId]", () => {
    it("returns a CV owned by the user", async () => {
      const cvId = createId();
      await db.insert(cvs).values({
        id: cvId,
        userId: TEST_USER_ID,
        title: "My CV",
        contentJson: sampleContent(),
        source: "manual",
      });

      const { GET } = await import("./[cvId]/route");
      const response = await GET(
        new Request(`http://localhost:3000/api/cvs/${cvId}`) as never,
        { params: Promise.resolve({ cvId }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(cvId);
      expect(body.title).toBe("My CV");
      expect(body.userId).toBe(TEST_USER_ID);
    });

    it("returns 404 for non-existent CV", async () => {
      const { GET } = await import("./[cvId]/route");
      const response = await GET(
        new Request("http://localhost:3000/api/cvs/nonexistent") as never,
        { params: Promise.resolve({ cvId: "nonexistent" }) },
      );
      expect(response.status).toBe(404);
    });
  });

  // ----- 4. PATCH /api/cvs/[cvId] persists changes and grows profile -------
  describe("PATCH /api/cvs/[cvId]", () => {
    it("persists changes to title, contentJson, and texSource", async () => {
      const cvId = createId();
      await db.insert(cvs).values({
        id: cvId,
        userId: TEST_USER_ID,
        title: "Original Title",
        contentJson: sampleContent(),
        source: "manual",
      });

      // Ensure profile exists so sync works
      const profileId = createId();
      await db.insert(professionalProfile).values({
        id: profileId,
        userId: TEST_USER_ID,
        personalInfo: { fullName: "Original" },
        experiences: [],
        education: [],
        skills: [],
      });

      const { PATCH } = await import("./[cvId]/route");
      const response = await PATCH(
        new Request(`http://localhost:3000/api/cvs/${cvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Updated Title",
            contentJson: {
              ...sampleContent(),
              personalInfo: { fullName: "Updated Name" },
            },
            texSource: "\\LaTeX source",
          }),
        }) as never,
        { params: Promise.resolve({ cvId }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.title).toBe("Updated Title");
      expect(body.texSource).toBe("\\LaTeX source");
      expect(body.contentJson.personalInfo.fullName).toBe("Updated Name");

      // Verify DB was updated
      const [saved] = await db
        .select()
        .from(cvs)
        .where(eq(cvs.id, cvId))
        .limit(1);
      expect(saved.title).toBe("Updated Title");

      // Verify profile grew (sync happened)
      const [profile] = await db
        .select()
        .from(professionalProfile)
        .where(eq(professionalProfile.userId, TEST_USER_ID))
        .limit(1);
      expect(profile.personalInfo).toEqual(
        expect.objectContaining({ fullName: "Updated Name" }),
      );
    });
  });

  // ----- 5. DELETE /api/cvs/[cvId] deletes the owned CV and returns 204 ----
  describe("DELETE /api/cvs/[cvId]", () => {
    it("deletes a CV owned by the user and returns 204", async () => {
      const cvId = createId();
      await db.insert(cvs).values({
        id: cvId,
        userId: TEST_USER_ID,
        title: "To Delete",
        contentJson: sampleContent(),
        source: "manual",
      });

      const { DELETE } = await import("./[cvId]/route");
      const response = await DELETE(
        new Request(`http://localhost:3000/api/cvs/${cvId}`, {
          method: "DELETE",
        }) as never,
        { params: Promise.resolve({ cvId }) },
      );

      expect(response.status).toBe(204);

      // Verify deleted from DB
      const [saved] = await db
        .select()
        .from(cvs)
        .where(eq(cvs.id, cvId))
        .limit(1);
      expect(saved).toBeUndefined();
    });
  });

  // ----- 6. PATCH /api/profile upserts the profile -------------------------
  describe("PATCH /api/profile", () => {
    it("creates a profile when none exists (upsert)", async () => {
      const { PATCH } = await import("../profile/route");
      const response = await PATCH(
        new Request("http://localhost:3000/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personalInfo: { fullName: "New User" },
            experiences: [],
            education: [],
            skills: [],
          }),
        }) as never,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.personalInfo.fullName).toBe("New User");

      // Verify persisted
      const [saved] = await db
        .select()
        .from(professionalProfile)
        .where(eq(professionalProfile.userId, TEST_USER_ID))
        .limit(1);
      expect(saved).toBeDefined();
      expect(saved.personalInfo).toEqual(
        expect.objectContaining({ fullName: "New User" }),
      );
    });

    it("updates an existing profile", async () => {
      const profileId = createId();
      await db.insert(professionalProfile).values({
        id: profileId,
        userId: TEST_USER_ID,
        personalInfo: { fullName: "Old Name" },
        experiences: [],
        education: [],
        skills: [],
      });

      const { PATCH } = await import("../profile/route");
      const response = await PATCH(
        new Request("http://localhost:3000/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personalInfo: { fullName: "Updated Name", headline: "Lead" },
          }),
        }) as never,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.personalInfo.fullName).toBe("Updated Name");
      expect(body.personalInfo.headline).toBe("Lead");
    });
  });

  // ----- 7. POST /api/profile/sync merges without duplicating --------------
  describe("POST /api/profile/sync", () => {
    it("merges new experiences, education, skills, and projects without duplicating existing entries", async () => {
      // Create a profile with initial entries
      const profileId = createId();
      await db.insert(professionalProfile).values({
        id: profileId,
        userId: TEST_USER_ID,
        personalInfo: { fullName: "Original" },
        experiences: [
          {
            id: "existing-exp",
            company: "OldCo",
            title: "Junior",
            startDate: "2020-01",
            bullets: [],
          },
        ],
        education: [],
        skills: [{ id: "existing-sk", category: "Tools", items: ["Git"] }],
        projects: [
          {
            id: "existing-proj",
            name: "Legacy",
            description: "Old project",
            tags: [],
          },
        ],
        achievements: [],
      });

      const { POST } = await import("../profile/sync/route");
      const response = await POST(
        new Request("http://localhost:3000/api/profile/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentJson: {
              personalInfo: { fullName: "Merged Name" },
              experiences: [
                // Existing item (same id) — should NOT duplicate
                {
                  id: "existing-exp",
                  company: "OldCo",
                  title: "Junior",
                  startDate: "2020-01",
                  bullets: [],
                },
                // New item — should be appended
                {
                  id: "new-exp",
                  company: "NewCo",
                  title: "Senior",
                  startDate: "2023-01",
                  bullets: ["Led team"],
                },
              ],
              education: [
                { id: "new-edu", institution: "Harvard", degree: "MBA", field: "Business" },
              ],
              skills: [
                // Existing — no duplicate
                { id: "existing-sk", category: "Tools", items: ["Git"] },
                // New — appended
                { id: "new-sk", category: "Languages", items: ["Rust"] },
              ],
              projects: [
                // Existing — no duplicate
                { id: "existing-proj", name: "Legacy", description: "Old project", tags: [] },
                // New — appended
                { id: "new-proj", name: "Greenfield", description: "New project", tags: ["AI"] },
              ],
              achievements: [
                { id: "new-ach", title: "Award", description: "Best dev" },
              ],
            },
          }),
        }) as never,
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      // personalInfo should be overwritten
      expect(body.personalInfo.fullName).toBe("Merged Name");

      // experiences: should have both existing and new (2 total, no duplicates)
      expect(body.experiences).toHaveLength(2);
      const expIds = body.experiences.map((e: { id: string }) => e.id);
      expect(expIds).toContain("existing-exp");
      expect(expIds).toContain("new-exp");

      // skills: should have both (2 total)
      expect(body.skills).toHaveLength(2);
      const skIds = body.skills.map((s: { id: string }) => s.id);
      expect(skIds).toContain("existing-sk");
      expect(skIds).toContain("new-sk");

      // projects: should have both (2 total)
      expect(body.projects).toHaveLength(2);
      const projIds = body.projects.map((p: { id: string }) => p.id);
      expect(projIds).toContain("existing-proj");
      expect(projIds).toContain("new-proj");

      // education: just the new one
      expect(body.education).toHaveLength(1);
      expect(body.education[0].id).toBe("new-edu");

      // achievements: just the new one
      expect(body.achievements).toHaveLength(1);
      expect(body.achievements[0].id).toBe("new-ach");
    });
  });
});
