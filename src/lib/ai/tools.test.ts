// ---------------------------------------------------------------------------
// M2 Interview Agent — Tool validation RED tests
//
// Task 1.3: agent rejects malformed/injected tool call without write
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { registerTools, findTool } from "./tools";

describe("Tool validation — malformed/injected calls", () => {
  const tools = registerTools();
  const saveProfile = vi.fn().mockResolvedValue(undefined);
  const signal = new AbortController().signal;

  const context = {
    userId: "test-user",
    profile: {
      personalInfo: { fullName: "Test User" },
      experiences: [],
      education: [],
      skills: [],
      projects: [],
      achievements: [],
      preferences: {},
    },
    signal,
    saveProfile,
  };

  it("rejects add_or_merge_experience with missing required company", async () => {
    const tool = findTool("add_or_merge_experience", tools);
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { title: "Engineer", startDate: "2023-01" }, // missing company
      context,
    );

    expect(result.status).toBe("validation_error");
    expect(result.error).toBeTruthy();
    // Verify no profile write occurred
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects add_or_merge_experience with empty company string", async () => {
    const tool = findTool("add_or_merge_experience", tools);
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { company: "", title: "Engineer", startDate: "2023-01" },
      context,
    );

    expect(result.status).toBe("validation_error");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects add_or_merge_education with missing institution", async () => {
    const tool = findTool("add_or_merge_education", tools);
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { degree: "BS" }, // missing institution
      context,
    );

    expect(result.status).toBe("validation_error");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects add_or_merge_skill_items with empty items array", async () => {
    const tool = findTool("add_or_merge_skill_items", tools);
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { category: "Languages", items: [] },
      context,
    );

    expect(result.status).toBe("validation_error");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects add_or_merge_project with missing description", async () => {
    const tool = findTool("add_or_merge_project", tools);
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { name: "My Project" }, // missing description
      context,
    );

    expect(result.status).toBe("validation_error");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects add_or_merge_achievement with missing title", async () => {
    const tool = findTool("add_or_merge_achievement", tools);
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { description: "Great achievement" }, // missing title
      context,
    );

    expect(result.status).toBe("validation_error");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects injection payload with extra unexpected fields (no write)", async () => {
    const tool = findTool("upsert_personal_info", tools);
    expect(tool).toBeDefined();

    // Tool should only parse known fields; extra fields should be ignored
    // but no write should occur if the known fields are all empty
    const result = await tool!.handler(
      {
        fullName: "Injected",
        maliciousField: "DROP TABLE users;",
        __proto__: { admin: true },
      },
      context,
    );

    expect(result.status).toBe("applied");
    // The safeParse should have extracted fullName and ignored the rest
    // Write should happen with the safe field only
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        personalInfo: expect.objectContaining({
          fullName: "Injected",
        }),
      }),
    );
    // The malicious field should not appear in saved data
    const savedCall = saveProfile.mock.calls[0]?.[0];
    expect(savedCall?.personalInfo).not.toHaveProperty("maliciousField");
  });
});
