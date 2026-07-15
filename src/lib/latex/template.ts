import type { CvContent } from "@/lib/db/schema";

/**
 * Escape special LaTeX characters: & % # $ _ { } ~ ^ \
 *
 * Uses a two-pass approach: backslash is first protected with a null-byte
 * placeholder so that replacement strings like \textbackslash{} don't
 * introduce secondary characters that would themselves need escaping.
 */
const BSLASH_PLACEHOLDER = "\x00BSLASH\x00";

function escapeLatex(text: string): string {
  // Pass 1: protect backslashes
  let result = text.replace(/\\/g, BSLASH_PLACEHOLDER);

  // Pass 2: escape all other special chars (none of these introduce \)
  result = result
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/\$/g, "\\$")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

  // Pass 3: restore backslashes as LaTeX-safe commands
  result = result.replace(/\x00BSLASH\x00/g, "\\textbackslash{}");

  return result;
}

function formatDateRange(start?: string, end?: string): string {
  const parts: string[] = [];
  if (start) parts.push(escapeLatex(start));
  if (end) parts.push("--");
  if (end) parts.push(escapeLatex(end));
  return parts.join(" ");
}

function renderPersonalInfo(info: CvContent["personalInfo"]): string {
  const lines: string[] = [];
  const name = info.fullName ? escapeLatex(info.fullName) : "";
  if (name) lines.push(`\\textbf{\\Large ${name}}`);
  if (info.headline) lines.push(`\\textit{${escapeLatex(info.headline)}}`);
  const contact: string[] = [];
  if (info.email) contact.push(escapeLatex(info.email));
  if (info.phone) contact.push(escapeLatex(info.phone));
  if (info.location) contact.push(escapeLatex(info.location));
  if (info.website) contact.push(`\\href{${escapeLatex(info.website)}}{${escapeLatex(info.website)}}`);
  if (info.linkedin) contact.push(`\\href{${escapeLatex(info.linkedin)}}{LinkedIn}`);
  if (info.github) contact.push(`\\href{${escapeLatex(info.github)}}{GitHub}`);
  if (contact.length > 0) lines.push(contact.join(" $|$ "));
  return lines.join(" \\\\\n");
}

function renderExperiences(experiences: CvContent["experiences"]): string {
  if (!experiences || experiences.length === 0) return "";
  const items = experiences
    .map(
      (exp) => `\\textbf{${escapeLatex(exp.title)}} \\hfill ${escapeLatex(exp.company)} \\
${formatDateRange(exp.startDate, exp.endDate)}${exp.location ? `, ${escapeLatex(exp.location)}` : ""}
\\begin{itemize}${exp.bullets.map((b) => `\n  \\item ${escapeLatex(b)}`).join("")}
\\end{itemize}`,
    )
    .join("\n\n");
  return `\\section*{Experience}\n${items}`;
}

function renderEducation(education: CvContent["education"]): string {
  if (!education || education.length === 0) return "";
  const items = education
    .map((edu) => {
      const line1 = `\\textbf{${escapeLatex(edu.degree)}} \\hfill ${escapeLatex(edu.institution)}`;
      const dateLine = edu.startDate || edu.endDate
        ? `\\\n${formatDateRange(edu.startDate, edu.endDate)}`
        : "";
      const details = edu.details ? ` \\\\\n${escapeLatex(edu.details)}` : "";
      return `${line1}${dateLine}${details}`;
    })
    .join("\n\n");
  return `\\section*{Education}\n${items}`;
}

function renderSkills(skills: CvContent["skills"]): string {
  if (!skills || skills.length === 0) return "";
  const items = skills
    .map((sk) => `\\textbf{${escapeLatex(sk.category)}}: ${sk.items.map((i) => escapeLatex(i)).join(", ")}`)
    .join(" \\\\\n");
  return `\\section*{Skills}\n${items}`;
}

function renderProjects(projects: CvContent["projects"]): string {
  if (!projects || projects.length === 0) return "";
  const items = projects
    .map((proj) => {
      const name = proj.url
        ? `\\textbf{\\href{${escapeLatex(proj.url)}}{${escapeLatex(proj.name)}}}`
        : `\\textbf{${escapeLatex(proj.name)}}`;
      const bullets = proj.bullets && proj.bullets.length > 0
        ? `\n\\begin{itemize}${proj.bullets.map((b) => `\n  \\item ${escapeLatex(b)}`).join("")}\n\\end{itemize}`
        : "";
      return `${name} \\\\\n${escapeLatex(proj.description)}${bullets}`;
    })
    .join("\n\n");
  return `\\section*{Projects}\n${items}`;
}

function renderAchievements(achievements: CvContent["achievements"]): string {
  if (!achievements || achievements.length === 0) return "";
  const items = achievements
    .map((a) => {
      const date = a.date ? ` (${escapeLatex(a.date)})` : "";
      const desc = a.description ? ` \\\\\n${escapeLatex(a.description)}` : "";
      return `\\textbf{${escapeLatex(a.title)}}${date}${desc}`;
    })
    .join("\n\n");
  return `\\section*{Achievements}\n${items}`;
}

function renderLanguages(languages?: { language: string; level: string }[]): string {
  if (!languages || languages.length === 0) return "";
  const items = languages
    .map((l) => `${escapeLatex(l.language)}: ${escapeLatex(l.level)}`)
    .join(" \\\\\n");
  return `\\section*{Languages}\n${items}`;
}

/**
 * Generate a complete Harvard-format LaTeX CV document from structured content.
 * Pure function — no side effects.
 */
export function generateHarvardCv(content: CvContent): string {
  const sections: string[] = [
    `\\documentclass[11pt]{article}
\\usepackage[letterpaper,margin=0.75in]{geometry}
\\usepackage{hyperref}
\\usepackage{enumitem}
\\setlist{nosep,left=0pt}
\\pagestyle{empty}
\\begin{document}
\\noindent`,
    renderPersonalInfo(content.personalInfo),
    content.summary
      ? `\\section*{Summary}\n${escapeLatex(content.summary)}`
      : "",
    renderExperiences(content.experiences),
    renderEducation(content.education),
    renderSkills(content.skills),
    renderProjects(content.projects),
    renderAchievements(content.achievements),
    renderLanguages(content.languages),
    "\\end{document}",
  ];

  return sections.filter((s) => s.length > 0).join("\n\n");
}
