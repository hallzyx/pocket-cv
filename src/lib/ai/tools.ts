// ---------------------------------------------------------------------------
// M2 Interview Agent — Zod-validated profile tools
//
// Every registered tool receives validated input via Zod v4 schemas.
// Tools return ToolResult with status: "applied" | "confirmation_required" | "validation_error".
//
// Semantic deduplication uses normalized fingerprints:
//   - Experience: company + title + startDate (lowercased, trimmed)
//   - Education: institution + degree (lowercased, trimmed)
//   - Skill: category + item (lowercased, trimmed)
//   - Project: name (lowercased, trimmed)
//   - Achievement: title (lowercased, trimmed)
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { ToolResult } from "./types";
import type {
  PersonalInfo,
  Experience,
  Education,
  Skill,
  Project,
  Achievement,
  ProfilePreferences,
} from "@/lib/db/schema";

// ── Helper: create a deterministic fingerprint ──────────────────────

function fingerprint(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => p !== undefined && p !== null)
    .map((p) => p.toString().toLowerCase().trim())
    .join("::");
}

// ── Zod schemas for tool inputs ─────────────────────────────────────

const personalInfoSchema = z.object({
  fullName: z.string().optional(),
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  otherLinks: z
    .array(z.object({ label: z.string(), url: z.string() }))
    .optional(),
});

const experienceSchema = z.object({
  company: z.string().min(1, "Company is required"),
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  location: z.string().optional(),
  bullets: z.array(z.string()).optional().default([]),
});

const educationSchema = z.object({
  institution: z.string().min(1, "Institution is required"),
  degree: z.string().min(1, "Degree is required"),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  details: z.string().optional(),
});

const skillSchema = z.object({
  category: z.string().min(1, "Category is required"),
  items: z.array(z.string()).min(1, "At least one skill item is required"),
});

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().min(1, "Description is required"),
  url: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  bullets: z.array(z.string()).optional(),
});

const achievementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  date: z.string().optional(),
});

const preferencesSchema = z.object({
  seniority: z.enum(["junior", "mid", "senior", "lead", "staff"]).optional(),
  languages: z
    .array(z.object({ language: z.string(), level: z.string() }))
    .optional(),
  sectionOrder: z.array(z.string()).optional(),
});

// ── Dedup helpers ───────────────────────────────────────────────────

function mergeFingerprint(
  existing: Array<{ id: string; [key: string]: unknown }>,
  input: Record<string, unknown>,
  fpFn: (item: Record<string, unknown>) => string,
): { action: "update" | "insert" | "ambiguous"; existingId?: string } {
  const inputFp = fpFn(input);

  // Binary search could be used for large arrays, but lists stay small (<100).
  const exact = existing.find((e) => fpFn(e as Record<string, unknown>) === inputFp);
  if (exact) {
    return { action: "update", existingId: exact.id };
  }

  // Ambiguous: check for partial matches (same first component)
  const firstPart = inputFp.split("::")[0];
  if (firstPart) {
    const similar = existing.filter((e) =>
      fpFn(e as Record<string, unknown>).startsWith(firstPart),
    );
    if (similar.length > 0) {
      // High-confidence partial match → confirmation_required
      return { action: "ambiguous" };
    }
  }

  return { action: "insert" };
}

// ── Tool registry ───────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

export type ToolContext = {
  userId: string;
  profile: {
    personalInfo?: PersonalInfo;
    experiences?: Experience[];
    education?: Education[];
    skills?: Skill[];
    projects?: Project[];
    achievements?: Achievement[];
    preferences?: ProfilePreferences;
  } | null;
  /** Signal from the agent loop — if aborted, tools should stop work */
  signal: AbortSignal;
  /** Callback to persist profile changes — called after atomic-emitter commit */
  saveProfile: (updates: Record<string, unknown>) => Promise<void>;
};

export type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
};

// ── Tool implementations ────────────────────────────────────────────

async function handleGetProfile(
  _args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  if (!context.profile) {
    return { status: "applied", data: null, summary: "No profile exists yet" };
  }
  return {
    status: "applied",
    data: context.profile,
    summary: "Returned current profile",
  };
}

async function handleUpsertPersonalInfo(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = personalInfoSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.personalInfo ?? {};
  const merged = { ...existing, ...parsed.data };

  await context.saveProfile({ personalInfo: merged });

  return {
    status: "applied",
    data: merged,
    summary: "Updated personal information",
  };
}

async function handleAddOrMergeExperience(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = experienceSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.experiences ?? [];
  const fp = fingerprint(parsed.data.company, parsed.data.title, parsed.data.startDate);
  const match = mergeFingerprint(
    existing as Array<{ id: string; [key: string]: unknown }>,
    parsed.data as unknown as Record<string, unknown>,
    (item) => fingerprint(
      item.company as string,
      item.title as string,
      item.startDate as string,
    ),
  );

  if (match.action === "ambiguous") {
    return {
      status: "confirmation_required",
      data: { input: parsed.data, fingerprint: fp },
      fingerprint: fp,
      summary: `Ambiguous match for experience at ${parsed.data.company}`,
    };
  }

  const newId = (await import("@paralleldrive/cuid2")).createId();
  const entry: Experience = {
    id: match.existingId ?? newId,
    company: parsed.data.company,
    title: parsed.data.title,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    location: parsed.data.location,
    bullets: parsed.data.bullets,
  };

  const updated =
    match.existingId
      ? existing.map((e) => (e.id === match.existingId ? entry : e))
      : [...existing, entry];

  await context.saveProfile({ experiences: updated });

  return {
    status: "applied",
    data: entry,
    fingerprint: fp,
    summary: match.existingId
      ? `Updated experience at ${entry.company}`
      : `Added experience at ${entry.company}`,
  };
}

async function handleAddOrMergeEducation(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = educationSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.education ?? [];
  const fp = fingerprint(parsed.data.institution, parsed.data.degree);
  const match = mergeFingerprint(
    existing as Array<{ id: string; [key: string]: unknown }>,
    parsed.data as unknown as Record<string, unknown>,
    (item) => fingerprint(item.institution as string, item.degree as string),
  );

  if (match.action === "ambiguous") {
    return {
      status: "confirmation_required",
      data: { input: parsed.data, fingerprint: fp },
      fingerprint: fp,
      summary: `Ambiguous match for education at ${parsed.data.institution}`,
    };
  }

  const newId = (await import("@paralleldrive/cuid2")).createId();
  const entry: Education = {
    id: match.existingId ?? newId,
    institution: parsed.data.institution,
    degree: parsed.data.degree,
    field: parsed.data.field,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    details: parsed.data.details,
  };

  const updated =
    match.existingId
      ? existing.map((e) => (e.id === match.existingId ? entry : e))
      : [...existing, entry];

  await context.saveProfile({ education: updated });

  return {
    status: "applied",
    data: entry,
    fingerprint: fp,
    summary: match.existingId
      ? `Updated education at ${entry.institution}`
      : `Added education at ${entry.institution}`,
  };
}

async function handleAddOrMergeSkill(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = skillSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.skills ?? [];

  // Skills are a bit different — we merge items within a category.
  // The fingerprint is category + first-item (for matching purposes).
  const firstItem = parsed.data.items[0] ?? "";
  const fp = fingerprint(parsed.data.category, firstItem);

  const existingCat = existing.find(
    (s) => s.category.toLowerCase().trim() === parsed.data.category.toLowerCase().trim(),
  );

  if (existingCat) {
    // Merge items: add new ones that don't already exist
    const existingItemsLower = new Set(existingCat.items.map((i) => i.toLowerCase().trim()));
    const newItems = parsed.data.items.filter(
      (i: string) => !existingItemsLower.has(i.toLowerCase().trim()),
    );

    if (newItems.length === 0) {
      return {
        status: "applied",
        data: existingCat,
        fingerprint: fp,
        summary: `Skills in "${parsed.data.category}" already up to date`,
      };
    }

    const updated: Skill = {
      ...existingCat,
      items: [...existingCat.items, ...newItems],
    };

    await context.saveProfile({
      skills: existing.map((s) => (s.id === existingCat.id ? updated : s)),
    });

    return {
      status: "applied",
      data: updated,
      fingerprint: fp,
      summary: `Added ${newItems.length} skill(s) to "${parsed.data.category}"`,
    };
  }

  // New category
  const newId = (await import("@paralleldrive/cuid2")).createId();
  const entry: Skill = {
    id: newId,
    category: parsed.data.category,
    items: parsed.data.items,
  };

  await context.saveProfile({ skills: [...existing, entry] });

  return {
    status: "applied",
    data: entry,
    fingerprint: fp,
    summary: `Added skill category "${parsed.data.category}"`,
  };
}

async function handleAddOrMergeProject(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = projectSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.projects ?? [];
  const fp = fingerprint(parsed.data.name);
  const match = mergeFingerprint(
    existing as Array<{ id: string; [key: string]: unknown }>,
    parsed.data as unknown as Record<string, unknown>,
    (item) => fingerprint(item.name as string),
  );

  if (match.action === "ambiguous") {
    return {
      status: "confirmation_required",
      data: { input: parsed.data, fingerprint: fp },
      fingerprint: fp,
      summary: `Ambiguous match for project "${parsed.data.name}"`,
    };
  }

  const newId = (await import("@paralleldrive/cuid2")).createId();
  const entry: Project = {
    id: match.existingId ?? newId,
    name: parsed.data.name,
    description: parsed.data.description,
    url: parsed.data.url,
    tags: parsed.data.tags,
    bullets: parsed.data.bullets,
  };

  const updated =
    match.existingId
      ? existing.map((p) => (p.id === match.existingId ? entry : p))
      : [...existing, entry];

  await context.saveProfile({ projects: updated });

  return {
    status: "applied",
    data: entry,
    fingerprint: fp,
    summary: match.existingId
      ? `Updated project "${entry.name}"`
      : `Added project "${entry.name}"`,
  };
}

async function handleAddOrMergeAchievement(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = achievementSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.achievements ?? [];
  const fp = fingerprint(parsed.data.title);
  const match = mergeFingerprint(
    existing as Array<{ id: string; [key: string]: unknown }>,
    parsed.data as unknown as Record<string, unknown>,
    (item) => fingerprint(item.title as string),
  );

  if (match.action === "ambiguous") {
    return {
      status: "confirmation_required",
      data: { input: parsed.data, fingerprint: fp },
      fingerprint: fp,
      summary: `Ambiguous match for achievement "${parsed.data.title}"`,
    };
  }

  const newId = (await import("@paralleldrive/cuid2")).createId();
  const entry: Achievement = {
    id: match.existingId ?? newId,
    title: parsed.data.title,
    description: parsed.data.description,
    date: parsed.data.date,
  };

  const updated =
    match.existingId
      ? existing.map((a) => (a.id === match.existingId ? entry : a))
      : [...existing, entry];

  await context.saveProfile({ achievements: updated });

  return {
    status: "applied",
    data: entry,
    fingerprint: fp,
    summary: match.existingId
      ? `Updated achievement "${entry.title}"`
      : `Added achievement "${entry.title}"`,
  };
}

async function handleSetPreferences(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = preferencesSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: "validation_error",
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const existing = context.profile?.preferences ?? {};
  const merged = { ...existing, ...parsed.data };

  await context.saveProfile({ preferences: merged });

  return {
    status: "applied",
    data: merged,
    summary: "Updated profile preferences",
  };
}

// ── Registry ────────────────────────────────────────────────────────

export function registerTools(): RegisteredTool[] {
  return [
    {
      name: "get_profile",
      description: "Get the user's current professional profile",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: handleGetProfile,
    },
    {
      name: "upsert_personal_info",
      description: "Update the user's personal information (name, headline, contact details)",
      inputSchema: {
        type: "object",
        properties: {
          fullName: { type: "string", description: "Full name" },
          headline: { type: "string", description: "Professional headline" },
          email: { type: "string", description: "Email address" },
          phone: { type: "string", description: "Phone number" },
          location: { type: "string", description: "Location" },
          website: { type: "string", description: "Website URL" },
          linkedin: { type: "string", description: "LinkedIn URL" },
          github: { type: "string", description: "GitHub URL" },
        },
        additionalProperties: false,
      },
      handler: handleUpsertPersonalInfo,
    },
    {
      name: "add_or_merge_experience",
      description: "Add or merge a work experience entry. Duplicates are detected by company+title+startDate fingerprint.",
      inputSchema: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name" },
          title: { type: "string", description: "Job title" },
          startDate: { type: "string", description: "Start date (ISO or YYYY-MM)" },
          endDate: { type: "string", description: "End date or 'Present'" },
          location: { type: "string", description: "Job location" },
          bullets: { type: "array", items: { type: "string" }, description: "Achievement bullets" },
        },
        required: ["company", "title", "startDate"],
        additionalProperties: false,
      },
      handler: handleAddOrMergeExperience,
    },
    {
      name: "add_or_merge_education",
      description: "Add or merge an education entry. Duplicates detected by institution+degree fingerprint.",
      inputSchema: {
        type: "object",
        properties: {
          institution: { type: "string", description: "School or university name" },
          degree: { type: "string", description: "Degree name" },
          field: { type: "string", description: "Field of study" },
          startDate: { type: "string", description: "Start date" },
          endDate: { type: "string", description: "End date" },
          details: { type: "string", description: "Honors, GPA, etc." },
        },
        required: ["institution", "degree"],
        additionalProperties: false,
      },
      handler: handleAddOrMergeEducation,
    },
    {
      name: "add_or_merge_skill_items",
      description: "Add skills to a category. Merges new items into existing category.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Skill category (e.g. Languages, Frameworks)" },
          items: { type: "array", items: { type: "string" }, description: "Skill items" },
        },
        required: ["category", "items"],
        additionalProperties: false,
      },
      handler: handleAddOrMergeSkill,
    },
    {
      name: "add_or_merge_project",
      description: "Add or merge a project entry. Duplicates detected by project name.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          description: { type: "string", description: "Project description" },
          url: { type: "string", description: "Project URL" },
          tags: { type: "array", items: { type: "string" }, description: "Project tags" },
          bullets: { type: "array", items: { type: "string" }, description: "Achievement bullets" },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
      handler: handleAddOrMergeProject,
    },
    {
      name: "add_or_merge_achievement",
      description: "Add or merge an achievement entry. Duplicates detected by title.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Achievement title" },
          description: { type: "string", description: "Achievement description" },
          date: { type: "string", description: "Achievement date" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      handler: handleAddOrMergeAchievement,
    },
    {
      name: "set_preferences",
      description: "Update profile preferences (seniority, languages, section order)",
      inputSchema: {
        type: "object",
        properties: {
          seniority: { type: "string", enum: ["junior", "mid", "senior", "lead", "staff"], description: "Seniority level" },
          languages: { type: "array", items: { type: "object", properties: { language: { type: "string" }, level: { type: "string" } } }, description: "Languages spoken" },
          sectionOrder: { type: "array", items: { type: "string" }, description: "Profile section order" },
        },
        additionalProperties: false,
      },
      handler: handleSetPreferences,
    },
  ];
}

/** Find a registered tool by name */
export function findTool(
  name: string,
  tools: RegisteredTool[],
): RegisteredTool | undefined {
  return tools.find((t) => t.name === name);
}
