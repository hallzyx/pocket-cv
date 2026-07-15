import type { CvContent } from "@/lib/db/schema";

export interface AtsResult {
  score: number;
  suggestions: string[];
  breakdown: AtsBreakdown;
}

export interface AtsBreakdown {
  completeness: number; // 0-40
  impact: number; // 0-30
  format: number; // 0-20
  keywords: number; // 0-10
}

const ACTION_VERBS = [
  "achieved", "adapted", "administered", "advised", "allocated", "analyzed",
  "built", "chaired", "changed", "coached", "collaborated", "communicated",
  "completed", "conducted", "configured", "consolidated", "constructed",
  "consulted", "coordinated", "created", "cultivated", "debugged",
  "decreased", "defined", "delegated", "delivered", "demonstrated",
  "designed", "determined", "developed", "devised", "directed",
  "discovered", "documented", "doubled", "drove", "earned",
  "edited", "eliminated", "enabled", "encouraged", "engineered",
  "established", "evaluated", "executed", "expanded", "expedited",
  "facilitated", "fixed", "founded", "generated", "grew",
  "guided", "hired", "identified", "implemented", "improved",
  "increased", "initiated", "innovated", "instituted", "integrated",
  "introduced", "invented", "investigated", "launched", "led",
  "managed", "mentored", "merged", "minimized", "modernized",
  "negotiated", "nurtured", "operated", "optimized", "orchestrated",
  "organized", "outperformed", "overhauled", "oversaw", "performed",
  "pioneered", "planned", "prepared", "presented", "prevented",
  "produced", "programmed", "promoted", "proposed", "protected",
  "provided", "published", "pursued", "rebuild", "received",
  "recommended", "reconstructed", "reduced", "reengineered", "refactored",
  "rehabilitated", "remedied", "reorganized", "repaired", "replaced",
  "reported", "reprogrammed", "researched", "resolved", "responded",
  "restored", "restructured", "resulted", "retained", "retooled",
  "revamped", "revitalized", "saved", "scheduled", "selected",
  "shaped", "shortened", "simplified", "slashed", "solved",
  "spearheaded", "stabilized", "standardized", "started", "stimulated",
  "strategized", "streamlined", "strengthened", "stretched", "structured",
  "succeeded", "suggested", "supervised", "surpassed", "surveyed",
  "sustained", "tackled", "tailored", "tested", "trained",
  "transformed", "trimmed", "tripled", "uncovered", "undertook",
  "unified", "upgraded", "utilized", "won", "wrote",
];

const actionVerbSet = new Set(ACTION_VERBS);

function countBullets(experiences: CvContent["experiences"]): number {
  return experiences.reduce((sum, e) => sum + e.bullets.length, 0);
}

function totalBullets(content: CvContent): number {
  let count = countBullets(content.experiences);
  if (content.projects) {
    count += content.projects.reduce((sum, p) => sum + (p.bullets?.length ?? 0), 0);
  }
  return count;
}

function hasNumber(text: string): boolean {
  return /\d/.test(text);
}

function startsWithActionVerb(text: string): boolean {
  const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase();
  return firstWord ? actionVerbSet.has(firstWord) : false;
}

export function evaluateAts(content: CvContent): AtsResult {
  const suggestions: string[] = [];
  const breakdown: AtsBreakdown = { completeness: 0, impact: 0, format: 0, keywords: 0 };

  // ── COMPLETENESS (40 pts) ──
  if (content.personalInfo?.fullName || content.personalInfo?.email) {
    breakdown.completeness += 5;
  } else {
    suggestions.push("Add your personal information (name, email, phone) to your CV");
  }

  if (content.summary && content.summary.trim().length > 0) {
    breakdown.completeness += 5;
  } else {
    suggestions.push("Add a professional summary to your CV");
  }

  if (content.experiences && content.experiences.length > 0) {
    breakdown.completeness += 10;
  } else {
    suggestions.push("Add your work experience to your CV");
  }

  if (content.education && content.education.length > 0) {
    breakdown.completeness += 10;
  } else {
    suggestions.push("Add your education to your CV");
  }

  if (content.skills && content.skills.length > 0) {
    breakdown.completeness += 10;
  } else {
    suggestions.push("Add your skills to your CV");
  }

  // ── IMPACT (30 pts) ──
  if (content.experiences && content.experiences.length > 0) {
    let verbScore = 0;
    for (const exp of content.experiences) {
      if (exp.bullets.length > 0 && exp.bullets.some((b) => startsWithActionVerb(b))) {
        verbScore = Math.min(verbScore + 5, 20);
      }
    }
    breakdown.impact += verbScore;

    if (verbScore < 20) {
      suggestions.push("Start experience bullets with strong action verbs (led, developed, implemented)");
    }

    const hasQuantified = content.experiences.some((exp) =>
      exp.bullets.some((b) => hasNumber(b)),
    );
    if (hasQuantified) {
      breakdown.impact += 10;
    } else {
      suggestions.push("Add quantified achievements to experience bullets (numbers, percentages, impact)");
    }
  } else {
    suggestions.push("Add work experience to improve impact scoring");
  }

  // ── FORMAT (20 pts) ──
  // Proper section ordering check: sum should appear before experience, education, skills
  // We check that the content has the expected structure
  if (content.summary) breakdown.format += 5;
  else suggestions.push("Add a summary section at the top of your CV");

  // No excessively long sections
  let hasLongSection = false;
  if (content.experiences) {
    for (const exp of content.experiences) {
      if (exp.bullets.length > 10) hasLongSection = true;
    }
  }
  if (content.projects) {
    for (const proj of content.projects) {
      if ((proj.bullets?.length ?? 0) > 10) hasLongSection = true;
    }
  }
  if (!hasLongSection) breakdown.format += 5;
  else suggestions.push("Break down sections with more than 10 bullets into shorter, focused lists");

  // Total length reasonable (rough: 20-80 bullets)
  const total = totalBullets(content);
  if (total >= 20 && total <= 80) {
    breakdown.format += 10;
  } else if (total > 80) {
    breakdown.format += 5;
    suggestions.push("Your CV appears too long — aim for 20-80 total bullets (1-3 pages)");
  } else if (total > 0) {
    breakdown.format += 5;
    suggestions.push("Your CV appears too short — aim for 20-80 total bullets (1-3 pages)");
  } else {
    suggestions.push("Add experience and project details to build a complete CV");
  }

  // ── KEYWORDS (10 pts) ──
  // Roles/Skills mentioned in both experiences and skills section
  if (content.experiences && content.skills) {
    const experienceText = content.experiences
      .flatMap((e) => [e.title, e.company, ...e.bullets])
      .join(" ")
      .toLowerCase();

    const allSkillItems = content.skills.flatMap((s) => s.items);
    let keywordScore = 0;
    for (const skill of allSkillItems) {
      const lower = skill.toLowerCase();
      // Check if skill appears in experience text
      if (experienceText.includes(lower)) {
        keywordScore = Math.min(keywordScore + 2, 10);
      }
    }
    breakdown.keywords += keywordScore;

    if (keywordScore < 10) {
      suggestions.push(
        "Mention key skills in your experience bullets to reinforce keyword match",
      );
    }
  }

  const score = breakdown.completeness + breakdown.impact + breakdown.format + breakdown.keywords;

  return { score, suggestions, breakdown };
}
