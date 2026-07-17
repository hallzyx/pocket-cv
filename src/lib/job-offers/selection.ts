import type { CvContent } from "@/lib/db/schema";
import type { OfferExtraction, SelectionResult } from "./schemas";
import type { OfferOverride } from "@/lib/db/schema";

type Item = { id?: unknown } & Record<string, unknown>;

const words = (value: unknown) => String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function selected<T extends Item>(items: T[] | undefined, terms: string[]) {
  const seen = new Set<string>();
  return (items ?? []).filter((item) => {
    const id = typeof item.id === "string" ? item.id : "";
    const match = id && terms.some((term) => words(Object.values(item)).includes(term));
    if (!match || seen.has(id)) return false;
    seen.add(id);
    return true;
  }) as T[];
}

export function selectContent(profile: CvContent, extraction: OfferExtraction, overrides: OfferOverride[] = []): SelectionResult {
  const terms = [extraction.category, ...extraction.keywords].flatMap(words);
  const projects = (profile.projects ?? []).filter((project) => {
    const id = typeof project.id === "string" ? project.id : "";
    if (!id) return false;
    const tagged = project.tags.some((tag) => terms.includes(tag.toLowerCase()));
    if (extraction.confidence < 0.6 && !tagged) return false;
    return tagged || extraction.confidence >= 0.6;
  });
  const lowConfidenceOmissions = (profile.projects ?? [])
    .filter((project) => typeof project.id === "string" && !projects.some((item) => item.id === project.id))
    .filter((project) => extraction.confidence < 0.6)
    .map((project) => ({ profileItemId: project.id, section: "projects", reason: "confidence<0.6" }));
  const applyOverrides = <T extends Item>(items: T[] | undefined, section: string, base: T[]) => {
    const byId = new Map((items ?? []).map((item) => [item.id, item]));
    const sectionOverrides = overrides.filter((o) => o.section === section);
    const excluded = new Set(sectionOverrides.filter((o) => o.action === "exclude").map((o) => o.profileItemId));
    const included = sectionOverrides.filter((o) => o.action === "include").map((o) => byId.get(o.profileItemId)).filter(Boolean) as T[];
    return [...base.filter((item) => !excluded.has(item.id as string)), ...included.filter((item) => !base.some((x) => x.id === item.id))];
  };
  return {
    experiences: applyOverrides(profile.experiences, "experiences", selected(profile.experiences, terms)),
    education: applyOverrides(profile.education, "education", selected(profile.education, terms)),
    skills: applyOverrides(profile.skills, "skills", selected(profile.skills, terms)),
    projects: applyOverrides(profile.projects, "projects", selected(projects, terms)),
    achievements: applyOverrides(profile.achievements, "achievements", selected(profile.achievements, terms)),
    lowConfidenceOmissions,
  };
}
