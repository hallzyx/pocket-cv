import { describe, it, expect } from "vitest";
import { generateHarvardCv } from "./template";
import type { CvContent } from "@/lib/db/schema";

const emptyCv: CvContent = {
  personalInfo: {},
  experiences: [],
  education: [],
  skills: [],
};

const sampleCv: CvContent = {
  personalInfo: {
    fullName: "John Doe",
    headline: "Senior Engineer",
    email: "john@example.com",
    phone: "+1-555-1234",
    location: "New York, NY",
    linkedin: "https://linkedin.com/in/johndoe",
  },
  summary: "Experienced software engineer with 10+ years in full-stack development.",
  experiences: [
    {
      id: "exp1",
      company: "Acme Corp",
      title: "Senior Developer",
      startDate: "2020-01",
      endDate: "Present",
      location: "New York, NY",
      bullets: [
        "Led a team of 5 engineers to deliver a microservices platform",
        "Reduced deployment time by 40% via CI/CD automation",
      ],
    },
  ],
  education: [
    {
      id: "edu1",
      institution: "MIT",
      degree: "B.S. Computer Science",
      startDate: "2012",
      endDate: "2016",
      details: "Cum laude, GPA 3.8",
    },
  ],
  skills: [
    { id: "sk1", category: "Languages", items: ["TypeScript", "Python", "Go"] },
    { id: "sk2", category: "Frameworks", items: ["React", "Next.js", "Express"] },
  ],
  projects: [
    {
      id: "proj1",
      name: "OpenSource CLI",
      description: "A CLI tool for managing cloud resources",
      url: "https://github.com/johndoe/cli-tool",
      tags: ["cli", "go"],
      bullets: ["500+ GitHub stars", "Used by 3 companies in production"],
    },
  ],
  achievements: [
    {
      id: "ach1",
      title: "Patent Holder",
      description: "US Patent #12345678 for distributed caching system",
      date: "2023",
    },
  ],
  languages: [
    { language: "English", level: "Native" },
    { language: "Spanish", level: "Professional" },
  ],
};

describe("generateHarvardCv", () => {
  it("should produce a valid LaTeX document structure", () => {
    const result = generateHarvardCv(sampleCv);
    expect(result).toContain("\\documentclass[11pt]{article}");
    expect(result).toContain("\\begin{document}");
    expect(result).toContain("\\end{document}");
    expect(result).toContain("\\section*{Experience}");
    expect(result).toContain("\\section*{Education}");
    expect(result).toContain("\\section*{Skills}");
    expect(result).toContain("\\section*{Projects}");
    expect(result).toContain("\\section*{Achievements}");
    expect(result).toContain("\\section*{Languages}");
  });

  it("should include personal info at the top", () => {
    const result = generateHarvardCv(sampleCv);
    expect(result).toContain("John Doe");
    expect(result).toContain("Senior Engineer");
    expect(result).toContain("john@example.com");
  });

  it("should include experience section with bullets", () => {
    const result = generateHarvardCv(sampleCv);
    expect(result).toContain("Acme Corp");
    expect(result).toContain("Senior Developer");
    expect(result).toContain("\\item Led a team");
    expect(result).toContain("\\item Reduced deployment time");
  });

  it("should escape special LaTeX characters", () => {
    const cvWithSpecialChars: CvContent = {
      ...emptyCv,
      personalInfo: { fullName: "Test & Co. (100%)" },
      summary: "C/C++ & Rust developer, 100% match #1",
      experiences: [],
      education: [],
      skills: [],
    };
    const result = generateHarvardCv(cvWithSpecialChars);
    // The source should contain escaped versions
    expect(result).toContain("Test \\& Co.");
    expect(result).toContain("100\\%");
    // Check summary escaping
    expect(result).toContain("C/C++");
    expect(result).toContain("100\\%");
    expect(result).toContain("match \\#1");
  });

  it("should escape dollar signs and underscores", () => {
    const cvWithSymbols: CvContent = {
      ...emptyCv,
      personalInfo: { fullName: "Salary: $100k+_bonus" },
      experiences: [],
      education: [],
      skills: [],
    };
    const result = generateHarvardCv(cvWithSymbols);
    expect(result).toContain("\\$100k+\\_bonus");
  });

  it("should escape braces and backslash in text", () => {
    const cvWithBraces: CvContent = {
      ...emptyCv,
      personalInfo: { fullName: "Test {escaped} \\text" },
      experiences: [],
      education: [],
      skills: [],
    };
    const result = generateHarvardCv(cvWithBraces);
    expect(result).toContain("\\{escaped\\}");
    expect(result).toContain("\\textbackslash{}text");
  });

  it("should handle empty sections gracefully", () => {
    const result = generateHarvardCv(emptyCv);
    expect(result).toContain("\\documentclass");
    expect(result).toContain("\\begin{document}");
    expect(result).toContain("\\end{document}");
    // Should NOT contain section titles for empty sections
    expect(result).not.toContain("\\section*{Experience}");
    expect(result).not.toContain("\\section*{Education}");
    expect(result).not.toContain("\\section*{Skills}");
    expect(result).not.toContain("\\section*{Summary}");
  });

  it("should include summary section when provided", () => {
    const result = generateHarvardCv(sampleCv);
    expect(result).toContain("\\section*{Summary}");
    expect(result).toContain("Experienced software engineer");
  });

  it("should include projects section when provided", () => {
    const result = generateHarvardCv(sampleCv);
    expect(result).toContain("\\section*{Projects}");
    expect(result).toContain("OpenSource CLI");
    expect(result).toContain("\\href");
  });

  it("should include languages section when provided", () => {
    const result = generateHarvardCv(sampleCv);
    expect(result).toContain("\\section*{Languages}");
    expect(result).toContain("English");
    expect(result).toContain("Spanish");
  });

  it("should handle CV with only personal info", () => {
    const minCv: CvContent = {
      ...emptyCv,
      personalInfo: { fullName: "Minimal Person" },
    };
    const result = generateHarvardCv(minCv);
    expect(result).toContain("Minimal Person");
    expect(result).toContain("\\begin{document}");
    expect(result).toContain("\\end{document}");
  });
});
