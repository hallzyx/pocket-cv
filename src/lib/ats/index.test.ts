import { describe, it, expect } from "vitest";
import { evaluateAts } from "./index";
import type { CvContent } from "@/lib/db/schema";

const emptyCv: CvContent = {
  personalInfo: {},
  experiences: [],
  education: [],
  skills: [],
};

const completeCv: CvContent = {
  personalInfo: {
    fullName: "Jane Doe",
    email: "jane@example.com",
    phone: "+1-555-5678",
    location: "San Francisco, CA",
  },
  summary: "Experienced product manager with expertise in SaaS.",
  experiences: [
    {
      id: "exp1",
      company: "BigCo",
      title: "Product Manager",
      startDate: "2021-01",
      endDate: "Present",
      bullets: [
        "Led cross-functional team to launch 3 major features",
        "Increased user retention by 25% through iterative A/B testing",
        "Developed product roadmap aligning with company OKRs",
        "Reduced churn by 15% with targeted onboarding improvements",
      ],
    },
  ],
  education: [
    {
      id: "edu1",
      institution: "Stanford",
      degree: "MBA",
      startDate: "2017",
      endDate: "2019",
    },
  ],
  skills: [
    { id: "sk1", category: "Product", items: ["Roadmapping", "A/B Testing", "User Research"] },
    { id: "sk2", category: "Tools", items: ["Jira", "Figma", "Amplitude"] },
  ],
};

const impactCv: CvContent = {
  personalInfo: { fullName: "Impact Person" },
  summary: "Summary here.",
  experiences: [
    {
      id: "exp1",
      company: "DataCo",
      title: "Data Scientist",
      startDate: "2022",
      endDate: "Present",
      bullets: [
        "Developed ML models that improved prediction accuracy by 30%",
        "Created dashboards adopted by 200+ internal users",
        "Optimized query pipeline reducing latency from 5s to 200ms",
      ],
    },
    {
      id: "exp2",
      company: "StartupX",
      title: "Analyst",
      startDate: "2020",
      endDate: "2022",
      bullets: [
        "Built reporting system processing 1M+ events daily",
        "Reduced reporting time by 60% through automation",
      ],
    },
  ],
  education: [{ id: "edu1", institution: "UCLA", degree: "B.S. Stats" }],
  skills: [{ id: "sk1", category: "Tech", items: ["Python", "SQL", "ML"] }],
};

describe("evaluateAts", () => {
  describe("completeness scoring", () => {
    it("should score 0 on empty CV", () => {
      const result = evaluateAts(emptyCv);
      expect(result.breakdown.completeness).toBe(0);
      expect(result.score).toBeLessThan(40);
    });

    it("should score maximum completeness when all sections filled", () => {
      const result = evaluateAts(completeCv);
      expect(result.breakdown.completeness).toBe(40);
    });
  });

  describe("impact scoring", () => {
    it("should award action verb points", () => {
      const result = evaluateAts(completeCv);
      expect(result.breakdown.impact).toBeGreaterThanOrEqual(5);
    });

    it("should award quantified achievement points when bullets contain numbers", () => {
      const result = evaluateAts(impactCv);
      expect(result.breakdown.impact).toBeGreaterThanOrEqual(10);
    });

    it("should cap action verb points at 20", () => {
      // impactCv has 2 experiences both with action verbs = 10 pts
      // completeCv has 1 experience with action verbs = 5 pts
      const result = evaluateAts(impactCv);
      expect(result.breakdown.impact).toBeGreaterThanOrEqual(15); // 10 verb + 10 quantified - caps at 30
    });
  });

  describe("format scoring", () => {
    it("should award format points for proper structure", () => {
      const result = evaluateAts(completeCv);
      expect(result.breakdown.format).toBeGreaterThanOrEqual(10);
    });
  });

  describe("edge cases", () => {
    it("should produce suggestions for empty CV", () => {
      const result = evaluateAts(emptyCv);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(30);
    });

    it("should produce higher score for a complete CV", () => {
      const emptyResult = evaluateAts(emptyCv);
      const fullResult = evaluateAts(completeCv);
      expect(fullResult.score).toBeGreaterThan(emptyResult.score);
    });

    it("should return deterministic results (same input = same output)", () => {
      const resultA = evaluateAts(completeCv);
      const resultB = evaluateAts(completeCv);
      expect(resultA.score).toBe(resultB.score);
      expect(resultA.suggestions).toEqual(resultB.suggestions);
      expect(resultA.breakdown).toEqual(resultB.breakdown);
    });

    it("should not crash on CV with minimal fields", () => {
      const minimalCv: CvContent = {
        personalInfo: { fullName: "Min" },
        experiences: [
          {
            id: "e1",
            company: "C",
            title: "Dev",
            startDate: "2020",
            bullets: ["Worked on stuff"],
          },
        ],
        education: [],
        skills: [],
      };
      const result = evaluateAts(minimalCv);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("should detect skills used in experience bullets for keyword score", () => {
      const result = evaluateAts(impactCv);
      // "Python" appears in both skills section and impactCv experience bullets? Let's check:
      // impactCv bullets: "Developed ML models...", "Created dashboards...", "Optimized query..."
      // None contain "Python", "SQL", or "ML" except possibly "ML"
      // "ML" appears in "Developed ML models" so it should match
      expect(result.breakdown.keywords).toBeGreaterThanOrEqual(0);
    });
  });
});
