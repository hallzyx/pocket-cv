import type { CvContent } from "@/lib/db/schema";
import { professionalProfile } from "@/lib/db/schema";
import type { PersonalInfo, Experience, Education, Skill, Project, Achievement, ProfilePreferences } from "@/lib/db/schema";

/**
 * Compute a normalized fingerprint for deduplication.
 * Used by both the CV sync and the interview agent tools.
 */
export function fingerprint(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => p !== undefined && p !== null)
    .map((p) => p.toString().toLowerCase().trim())
    .join("::");
}

/**
 * Determine merge strategy for an item against existing items.
 * Returns the action and, for exact matches, the existing item id.
 */
export function resolveMergeAction<T extends { id: string }>(
  existing: T[],
  newItem: Record<string, unknown>,
  fpFn: (item: Record<string, unknown>) => string,
): { action: "update" | "insert" | "ambiguous"; existingId?: string; fingerprint: string } {
  const newFp = fpFn(newItem);

  const exact = existing.find((e) => fpFn(e as unknown as Record<string, unknown>) === newFp);
  if (exact) {
    return { action: "update", existingId: exact.id, fingerprint: newFp };
  }

  // Ambiguous: check for partial matches (same first component of fingerprint)
  const firstPart = newFp.split("::")[0];
  if (firstPart) {
    const similar = existing.filter((e) =>
      fpFn(e as unknown as Record<string, unknown>).startsWith(firstPart),
    );
    if (similar.length > 0) {
      return { action: "ambiguous", fingerprint: newFp };
    }
  }

  return { action: "insert", fingerprint: newFp };
}

/**
 * Merge CvContent into a professional_profile row.
 * - personalInfo: overwritten with CV values
 * - languages (→ preferences.languages): overwritten with CV values
 * - experiences/education/skills/projects/achievements:
 *   items not already present in the profile (by id) are appended.
 */
export function mergeCvIntoProfile(
  profile: typeof professionalProfile.$inferSelect,
  content: CvContent,
): Partial<typeof professionalProfile.$inferInsert> {
  const updates: Partial<typeof professionalProfile.$inferInsert> = {};

  // personalInfo: full overwrite
  updates.personalInfo = content.personalInfo;

  // languages → preferences.languages
  const mergedPreferences = { ...(profile.preferences ?? {}) };
  if (content.languages) {
    mergedPreferences.languages = content.languages;
  }
  updates.preferences = mergedPreferences;

  // experiences: append items with new ids
  const existingExpIds = new Set(profile.experiences?.map((e) => e.id) ?? []);
  const newExperiences = content.experiences.filter((e) => !existingExpIds.has(e.id));
  if (newExperiences.length > 0) {
    updates.experiences = [...(profile.experiences ?? []), ...newExperiences];
  }

  // education: append items with new ids
  const existingEduIds = new Set(profile.education?.map((e) => e.id) ?? []);
  const newEducation = content.education.filter((e) => !existingEduIds.has(e.id));
  if (newEducation.length > 0) {
    updates.education = [...(profile.education ?? []), ...newEducation];
  }

  // skills: append items with new ids
  const existingSkillIds = new Set(profile.skills?.map((s) => s.id) ?? []);
  const newSkills = content.skills.filter((s) => !existingSkillIds.has(s.id));
  if (newSkills.length > 0) {
    updates.skills = [...(profile.skills ?? []), ...newSkills];
  }

  // projects: append items with new ids
  const existingProjIds = new Set(profile.projects?.map((p) => p.id) ?? []);
  const newProjects = (content.projects ?? []).filter((p) => !existingProjIds.has(p.id));
  if (newProjects.length > 0) {
    updates.projects = [...(profile.projects ?? []), ...newProjects];
  }

  // achievements: append items with new ids
  const existingAchIds = new Set(profile.achievements?.map((a) => a.id) ?? []);
  const newAchievements = (content.achievements ?? []).filter((a) => !existingAchIds.has(a.id));
  if (newAchievements.length > 0) {
    updates.achievements = [...(profile.achievements ?? []), ...newAchievements];
  }

  return updates;
}
