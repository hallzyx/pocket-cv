import { describe, expect, it } from "vitest";
import { selectContent } from "../selection";
import type { CvContent } from "@/lib/db/schema";

const profile: CvContent = {
  personalInfo: {},
  experiences: ["exp-1", "exp-2", "exp-3", "exp-4", "exp-5"].map((id) => ({ id, company: id === "exp-2" ? "Acme" : "Other", title: "React Engineer", startDate: "2020-01", bullets: ["TypeScript"] })),
  education: [{ id: "edu-1", institution: "React University", degree: "BSc", field: "CS" }],
  skills: [{ id: "skill-1", category: "Frameworks", items: ["React", "TypeScript"] }],
  projects: [{ id: "proj-1", name: "Web", description: "web app", tags: ["web"] }, { id: "proj-2", name: "ML", description: "model", tags: ["ml"] }, { id: "proj-3", name: "Mobile", description: "app", tags: ["mobile"] }],
  achievements: [{ id: "ach-1", title: "React award" }],
};

describe("selectContent", () => {
  it("returns only source IDs and preserves duplicate names", () => {
    const result = selectContent(profile, { category: "engineering", keywords: ["React", "TypeScript"], confidence: 0.9 });
    const ids = new Set(profile.experiences.map((item) => item.id));
    expect(result.experiences.every((item) => ids.has(item.id))).toBe(true);
    expect(result.experiences).toHaveLength(5);
    expect(result.experiences.map((item) => item.id)).not.toContain("experience-1");
  });

  it("omits unmatched low-confidence projects with exact records", () => {
    const result = selectContent(profile, { category: "ML", keywords: [], confidence: 0.5 });
    expect(result.projects).toEqual([profile.projects![1]]);
    expect(result.lowConfidenceOmissions).toContainEqual({ profileItemId: "proj-1", section: "projects", reason: "confidence<0.6" });
    expect(result.lowConfidenceOmissions).toContainEqual({ profileItemId: "proj-3", section: "projects", reason: "confidence<0.6" });
  });

  it("deduplicates by source ID, not display name", () => {
    const duplicate = { ...profile, experiences: [profile.experiences[1], { ...profile.experiences[1], id: "exp-6" }] };
    expect(selectContent(duplicate, { category: "engineering", keywords: ["React"], confidence: 0.9 }).experiences).toHaveLength(2);
  });
});
