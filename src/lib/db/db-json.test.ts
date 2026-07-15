// ---------------------------------------------------------------------------
// DB regression tests for safe JSON column parsing.
// Confirms that:
//  - Known JSON columns (e.g. personal_info, experiences) are parsed as JS objects
//  - LONGTEXT columns like job_offers.raw_text remain as plain strings even
//    when their content starts with `{` or `[`
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Override DB URL before any module loads
vi.hoisted(() => {
  process.env.POCKETCV_DATABASE_URL =
    "mysql://root:@localhost:33065/pocketcv_test";
});

import { db } from "@/lib/db/index";
import { professionalProfile, jobOffers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const TEST_USER = "test-db-json-user";
let profileId: string;

async function cleanTestData() {
  await db
    .delete(professionalProfile)
    .where(eq(professionalProfile.userId, TEST_USER));
  await db
    .delete(jobOffers)
    .where(eq(jobOffers.userId, TEST_USER));
}

describe("DB JSON column parsing", () => {
  beforeAll(async () => {
    await cleanTestData();
    await db.execute("SELECT 1");
  });

  beforeEach(async () => {
    await cleanTestData();
    profileId = createId();
  });

  it("parses known JSON columns (personal_info) as JS objects", async () => {
    await db.insert(professionalProfile).values({
      id: profileId,
      userId: TEST_USER,
      personalInfo: {
        fullName: "Alice",
        headline: "Developer",
        email: "alice@test.com",
      },
      experiences: [],
      education: [],
      skills: [],
    });

    const [saved] = await db
      .select()
      .from(professionalProfile)
      .where(eq(professionalProfile.id, profileId))
      .limit(1);

    expect(saved).toBeDefined();
    // personal_info should be an object, not a string
    expect(typeof saved.personalInfo).toBe("object");
    expect(saved.personalInfo).not.toBeNull();
    expect(Array.isArray(saved.personalInfo)).toBe(false);
    expect(saved.personalInfo).toHaveProperty("fullName", "Alice");
    expect(saved.personalInfo).toHaveProperty("headline", "Developer");
  });

  it("parses JSON array columns (experiences, skills) as JS arrays", async () => {
    await db.insert(professionalProfile).values({
      id: profileId,
      userId: TEST_USER,
      personalInfo: { fullName: "Bob" },
      experiences: [
        {
          id: "exp-json-1",
          company: "DataCorp",
          title: "Analyst",
          startDate: "2022-01",
          bullets: ["Analyzed data"],
        },
      ],
      education: [],
      skills: [
        { id: "sk-json-1", category: "Languages", items: ["Python"] },
      ],
    });

    const [saved] = await db
      .select()
      .from(professionalProfile)
      .where(eq(professionalProfile.id, profileId))
      .limit(1);

    expect(Array.isArray(saved.experiences)).toBe(true);
    expect(saved.experiences!).toHaveLength(1);
    expect(saved.experiences![0].company).toBe("DataCorp");

    expect(Array.isArray(saved.skills)).toBe(true);
    expect(saved.skills!).toHaveLength(1);
    expect(saved.skills![0].items).toEqual(["Python"]);
  });

  it("leaves job_offers.raw_text as a plain string when it starts with {", async () => {
    const rawTextContent = '{"company": "Acme Corp", "title": "Engineer"}';

    await db.insert(jobOffers).values({
      id: createId(),
      userId: TEST_USER,
      rawText: rawTextContent,
    });

    const [saved] = await db
      .select()
      .from(jobOffers)
      .where(eq(jobOffers.userId, TEST_USER))
      .limit(1);

    expect(saved).toBeDefined();
    // raw_text MUST remain a string, NOT parsed into an object
    expect(typeof saved.rawText).toBe("string");
    expect(saved.rawText).toBe(rawTextContent);
    // Verify it's not an object — checking that JSON.parse would work differently
    expect(saved.rawText).toEqual(expect.stringContaining("Acme Corp"));
  });

  it("leaves job_offers.raw_text as a plain string when it starts with [", async () => {
    const rawTextContent = '["item1", "item2", "item3"]';

    await db.insert(jobOffers).values({
      id: createId(),
      userId: TEST_USER,
      rawText: rawTextContent,
    });

    const [saved] = await db
      .select()
      .from(jobOffers)
      .where(eq(jobOffers.userId, TEST_USER))
      .limit(1);

    expect(saved).toBeDefined();
    expect(typeof saved.rawText).toBe("string");
    expect(saved.rawText).toBe(rawTextContent);
    // Confirm it's a string, not a parsed array
    expect(typeof saved.rawText === "string" && !Array.isArray(saved.rawText)).toBe(true);
  });

  it("correctly returns extracted_keywords as JSON array", async () => {
    await db.insert(jobOffers).values({
      id: createId(),
      userId: TEST_USER,
      rawText: "Some job description text",
      extractedKeywords: ["Python", "React", "AWS"],
    });

    const [saved] = await db
      .select()
      .from(jobOffers)
      .where(eq(jobOffers.userId, TEST_USER))
      .limit(1);

    expect(Array.isArray(saved.extractedKeywords)).toBe(true);
    expect(saved.extractedKeywords).toContain("Python");
    expect(saved.extractedKeywords).toContain("AWS");
  });
});
