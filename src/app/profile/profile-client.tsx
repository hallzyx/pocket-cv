"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { createId } from "@paralleldrive/cuid2";
import type {
  PersonalInfo,
  Experience,
  Education,
  Skill,
  Project,
  Achievement,
  ProfilePreferences,
} from "@/lib/db/schema";

interface ProfileData {
  id: string;
  personalInfo: PersonalInfo | null;
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
  projects: Project[];
  achievements: Achievement[];
  preferences: ProfilePreferences | null;
}

type SectionKey =
  | "personalInfo"
  | "summary"
  | "experiences"
  | "education"
  | "skills"
  | "projects"
  | "achievements"
  | "languages";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "personalInfo", label: "Personal Info" },
  { key: "summary", label: "Summary" },
  { key: "experiences", label: "Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills" },
  { key: "projects", label: "Projects" },
  { key: "achievements", label: "Achievements" },
  { key: "languages", label: "Languages" },
];

function CollapsibleSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <h2 className="text-base font-semibold">{label}</h2>
        <svg
          className={`h-4 w-4 text-zinc-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-black/[.06] px-5 pb-5 pt-4 dark:border-white/[.1]">
          {children}
        </div>
      )}
    </div>
  );
}

function InlineField({
  label,
  value,
  onChange,
  type = "text",
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function handleSave() {
    onChange(draft);
    setEditing(false);
  }

  function handleCancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500">{label}</label>
        {multiline ? (
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
          />
        ) : (
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
          />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-black px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-black"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-black/[.1] px-3 py-1 text-xs font-medium dark:border-white/[.15]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      <p
        className={`cursor-pointer text-sm ${
          value ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 italic"
        }`}
        onClick={() => setEditing(true)}
      >
        {value || `Click to add ${label.toLowerCase()}...`}
      </p>
    </div>
  );
}

function ArrayField<T extends { id: string }>({
  items,
  renderItem,
  onAdd,
  onRemove,
  onChangeItem,
  emptyLabel,
  addLabel,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChangeItem: (id: string, updater: (item: T) => T) => void;
  emptyLabel: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-sm italic text-zinc-400">{emptyLabel}</p>
      )}
      {items.map((item, index) => (
        <div
          key={item.id}
          className="rounded-lg border border-black/[.06] p-3 dark:border-white/[.1]"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              #{index + 1}
            </span>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          {renderItem(item, index)}
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        {addLabel}
      </button>
    </div>
  );
}

export function ProfileClient({ user }: { user: { id: string; name?: string; email: string } }) {
  const router = useRouter();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    new Set(["personalInfo", "summary"]),
  );

  // Summary is stored locally in state and saved to preferences._summary
  const [summary, setSummary] = useState("");

  // Languages
  const [languages, setLanguages] = useState<{ language: string; level: string }[]>([]);

  useEffect(() => {
    fetch("/api/profile")
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Failed to load profile");
        return res.json();
      })
      .then((data: ProfileData | null) => {
        setProfile(data);
        setSummary((data?.preferences as Record<string, unknown>)?.["_summary"] as string ?? "");
        setLanguages(data?.preferences?.languages ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function handleSave(changes: Partial<ProfileData>) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(changes)) {
        body[key] = val;
      }

      // Include summary and languages
      const prefs: Record<string, unknown> = {};
      if (summary !== undefined) prefs._summary = summary;
      if (languages !== undefined) prefs.languages = languages;
      if (Object.keys(prefs).length > 0) body.preferences = prefs;

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }

      const updated = await res.json();
      setProfile(updated);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving profile");
    } finally {
      setSaving(false);
    }
  }

  function updatePersonalInfo(updates: Partial<PersonalInfo>) {
    if (!profile) return;
    const merged = { ...(profile.personalInfo ?? {}), ...updates };
    handleSave({ personalInfo: merged });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <NavBar email={user.email} name={user.name} />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800"
              />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <NavBar email={user.email} name={user.name} />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <NavBar email={user.email} name={user.name} />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <div className="rounded-2xl border border-dashed border-black/[.15] bg-white p-12 text-center dark:border-white/[.2] dark:bg-zinc-950">
            <h2 className="text-2xl font-semibold tracking-tight">
              No profile yet
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
              Create your professional profile to get started with PocketCV.
              Your profile is the source of truth for all your CVs.
            </p>
            <button
              type="button"
              onClick={async () => {
                setSaving(true);
                try {
                  const res = await fetch("/api/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ personalInfo: {} }),
                  });
                  const data = await res.json();
                  setProfile(data);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Error creating profile",
                  );
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="mt-6 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {saving ? "Creating..." : "Create Profile"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <NavBar email={user.email} name={user.name} />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Professional Profile
          </h1>
          {saving && (
            <span className="text-xs text-zinc-500">Saving...</span>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-4">
          {/* ── Personal Info ── */}
          <CollapsibleSection
            label="Personal Info"
            open={openSections.has("personalInfo")}
            onToggle={() => toggleSection("personalInfo")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <InlineField
                label="Full Name"
                value={profile.personalInfo?.fullName ?? ""}
                onChange={(v) => updatePersonalInfo({ fullName: v })}
              />
              <InlineField
                label="Headline"
                value={profile.personalInfo?.headline ?? ""}
                onChange={(v) => updatePersonalInfo({ headline: v })}
              />
              <InlineField
                label="Email"
                value={profile.personalInfo?.email ?? ""}
                onChange={(v) => updatePersonalInfo({ email: v })}
                type="email"
              />
              <InlineField
                label="Phone"
                value={profile.personalInfo?.phone ?? ""}
                onChange={(v) => updatePersonalInfo({ phone: v })}
                type="tel"
              />
              <InlineField
                label="Location"
                value={profile.personalInfo?.location ?? ""}
                onChange={(v) => updatePersonalInfo({ location: v })}
              />
              <InlineField
                label="Website"
                value={profile.personalInfo?.website ?? ""}
                onChange={(v) => updatePersonalInfo({ website: v })}
                type="url"
              />
              <InlineField
                label="LinkedIn"
                value={profile.personalInfo?.linkedin ?? ""}
                onChange={(v) => updatePersonalInfo({ linkedin: v })}
                type="url"
              />
              <InlineField
                label="GitHub"
                value={profile.personalInfo?.github ?? ""}
                onChange={(v) => updatePersonalInfo({ github: v })}
                type="url"
              />
            </div>
          </CollapsibleSection>

          {/* ── Summary ── */}
          <CollapsibleSection
            label="Summary"
            open={openSections.has("summary")}
            onToggle={() => toggleSection("summary")}
          >
            <p className="mb-3 text-xs text-zinc-500">
              A brief professional summary that appears at the top of your CV.
            </p>
            <textarea
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="mb-3 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
              placeholder="Write a short professional summary..."
            />
            <button
              type="button"
              onClick={() => handleSave({})}
              disabled={saving}
              className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {saving ? "Saving..." : "Save Summary"}
            </button>
          </CollapsibleSection>

          {/* ── Experience ── */}
          <CollapsibleSection
            label={`Experience (${profile.experiences?.length ?? 0})`}
            open={openSections.has("experiences")}
            onToggle={() => toggleSection("experiences")}
          >
            <ArrayField
              items={profile.experiences ?? []}
              emptyLabel="No experience added yet."
              addLabel="Add Experience"
              onAdd={() => {
                const newExp: Experience = {
                  id: createId(),
                  company: "",
                  title: "",
                  startDate: "",
                  endDate: "",
                  location: "",
                  bullets: [],
                };
                handleSave({
                  experiences: [...(profile.experiences ?? []), newExp],
                });
              }}
              onRemove={(id) => {
                handleSave({
                  experiences: (profile.experiences ?? []).filter(
                    (e) => e.id !== id,
                  ),
                });
              }}
              onChangeItem={(id, updater) => {
                handleSave({
                  experiences: (profile.experiences ?? []).map((e) =>
                    e.id === id ? updater(e) : e,
                  ),
                });
              }}
              renderItem={(exp) => (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InlineField
                      label="Company"
                      value={exp.company}
                      onChange={(v) => {
                        const items = profile.experiences ?? [];
                        const idx = items.findIndex((e) => e.id === exp.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], company: v };
                          handleSave({ experiences: next });
                        }
                      }}
                    />
                    <InlineField
                      label="Title"
                      value={exp.title}
                      onChange={(v) => {
                        const items = profile.experiences ?? [];
                        const idx = items.findIndex((e) => e.id === exp.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], title: v };
                          handleSave({ experiences: next });
                        }
                      }}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InlineField
                      label="Start Date"
                      value={exp.startDate ?? ""}
                      onChange={(v) => {
                        const items = profile.experiences ?? [];
                        const idx = items.findIndex((e) => e.id === exp.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], startDate: v };
                          handleSave({ experiences: next });
                        }
                      }}
                    />
                    <InlineField
                      label="End Date"
                      value={exp.endDate ?? ""}
                      onChange={(v) => {
                        const items = profile.experiences ?? [];
                        const idx = items.findIndex((e) => e.id === exp.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], endDate: v };
                          handleSave({ experiences: next });
                        }
                      }}
                    />
                    <InlineField
                      label="Location"
                      value={exp.location ?? ""}
                      onChange={(v) => {
                        const items = profile.experiences ?? [];
                        const idx = items.findIndex((e) => e.id === exp.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], location: v };
                          handleSave({ experiences: next });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Bullets (one per line)
                    </label>
                    <textarea
                      rows={3}
                      value={exp.bullets?.join("\n") ?? ""}
                      onChange={(e) => {
                        const items = profile.experiences ?? [];
                        const idx = items.findIndex((x) => x.id === exp.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = {
                            ...next[idx],
                            bullets: e.target.value
                              .split("\n")
                              .filter((b) => b.trim()),
                          };
                          handleSave({ experiences: next });
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
                      placeholder="Led a team of 5 engineers..."
                    />
                  </div>
                </div>
              )}
            />
          </CollapsibleSection>

          {/* ── Education ── */}
          <CollapsibleSection
            label={`Education (${profile.education?.length ?? 0})`}
            open={openSections.has("education")}
            onToggle={() => toggleSection("education")}
          >
            <ArrayField
              items={profile.education ?? []}
              emptyLabel="No education added yet."
              addLabel="Add Education"
              onAdd={() => {
                const newEdu: Education = {
                  id: createId(),
                  institution: "",
                  degree: "",
                  field: "",
                  startDate: "",
                  endDate: "",
                  details: "",
                };
                handleSave({
                  education: [...(profile.education ?? []), newEdu],
                });
              }}
              onRemove={(id) => {
                handleSave({
                  education: (profile.education ?? []).filter((e) => e.id !== id),
                });
              }}
              onChangeItem={(id, updater) => {
                handleSave({
                  education: (profile.education ?? []).map((e) =>
                    e.id === id ? updater(e) : e,
                  ),
                });
              }}
              renderItem={(edu) => (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InlineField
                      label="Institution"
                      value={edu.institution}
                      onChange={(v) => {
                        const items = profile.education ?? [];
                        const idx = items.findIndex((e) => e.id === edu.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], institution: v };
                          handleSave({ education: next });
                        }
                      }}
                    />
                    <InlineField
                      label="Degree"
                      value={edu.degree}
                      onChange={(v) => {
                        const items = profile.education ?? [];
                        const idx = items.findIndex((e) => e.id === edu.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], degree: v };
                          handleSave({ education: next });
                        }
                      }}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InlineField
                      label="Field"
                      value={edu.field ?? ""}
                      onChange={(v) => {
                        const items = profile.education ?? [];
                        const idx = items.findIndex((e) => e.id === edu.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], field: v };
                          handleSave({ education: next });
                        }
                      }}
                    />
                    <InlineField
                      label="Start Date"
                      value={edu.startDate ?? ""}
                      onChange={(v) => {
                        const items = profile.education ?? [];
                        const idx = items.findIndex((e) => e.id === edu.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], startDate: v };
                          handleSave({ education: next });
                        }
                      }}
                    />
                    <InlineField
                      label="End Date"
                      value={edu.endDate ?? ""}
                      onChange={(v) => {
                        const items = profile.education ?? [];
                        const idx = items.findIndex((e) => e.id === edu.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], endDate: v };
                          handleSave({ education: next });
                        }
                      }}
                    />
                  </div>
                  <InlineField
                    label="Details (honors, GPA, etc.)"
                    value={edu.details ?? ""}
                    multiline
                    onChange={(v) => {
                      const items = profile.education ?? [];
                      const idx = items.findIndex((e) => e.id === edu.id);
                      if (idx >= 0) {
                        const next = [...items];
                        next[idx] = { ...next[idx], details: v };
                        handleSave({ education: next });
                      }
                    }}
                  />
                </div>
              )}
            />
          </CollapsibleSection>

          {/* ── Skills ── */}
          <CollapsibleSection
            label={`Skills (${profile.skills?.length ?? 0})`}
            open={openSections.has("skills")}
            onToggle={() => toggleSection("skills")}
          >
            <ArrayField
              items={profile.skills ?? []}
              emptyLabel="No skills added yet."
              addLabel="Add Skill Category"
              onAdd={() => {
                const newSkill: Skill = {
                  id: createId(),
                  category: "",
                  items: [],
                };
                handleSave({
                  skills: [...(profile.skills ?? []), newSkill],
                });
              }}
              onRemove={(id) => {
                handleSave({
                  skills: (profile.skills ?? []).filter((s) => s.id !== id),
                });
              }}
              onChangeItem={(id, updater) => {
                handleSave({
                  skills: (profile.skills ?? []).map((s) =>
                    s.id === id ? updater(s) : s,
                  ),
                });
              }}
              renderItem={(skill) => (
                <div className="space-y-3">
                  <InlineField
                    label="Category"
                    value={skill.category}
                    onChange={(v) => {
                      const items = profile.skills ?? [];
                      const idx = items.findIndex((s) => s.id === skill.id);
                      if (idx >= 0) {
                        const next = [...items];
                        next[idx] = { ...next[idx], category: v };
                        handleSave({ skills: next });
                      }
                    }}
                  />
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Skills (comma separated)
                    </label>
                    <input
                      type="text"
                      value={skill.items.join(", ")}
                      onChange={(e) => {
                        const items = profile.skills ?? [];
                        const idx = items.findIndex((s) => s.id === skill.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = {
                            ...next[idx],
                            items: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          };
                          handleSave({ skills: next });
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
                      placeholder="React, TypeScript, Node.js"
                    />
                  </div>
                </div>
              )}
            />
          </CollapsibleSection>

          {/* ── Projects ── */}
          <CollapsibleSection
            label={`Projects (${profile.projects?.length ?? 0})`}
            open={openSections.has("projects")}
            onToggle={() => toggleSection("projects")}
          >
            <ArrayField
              items={profile.projects ?? []}
              emptyLabel="No projects added yet."
              addLabel="Add Project"
              onAdd={() => {
                const newProj: Project = {
                  id: createId(),
                  name: "",
                  description: "",
                  url: "",
                  tags: [],
                  bullets: [],
                };
                handleSave({
                  projects: [...(profile.projects ?? []), newProj],
                });
              }}
              onRemove={(id) => {
                handleSave({
                  projects: (profile.projects ?? []).filter((p) => p.id !== id),
                });
              }}
              onChangeItem={(id, updater) => {
                handleSave({
                  projects: (profile.projects ?? []).map((p) =>
                    p.id === id ? updater(p) : p,
                  ),
                });
              }}
              renderItem={(proj) => (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InlineField
                      label="Name"
                      value={proj.name}
                      onChange={(v) => {
                        const items = profile.projects ?? [];
                        const idx = items.findIndex((p) => p.id === proj.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], name: v };
                          handleSave({ projects: next });
                        }
                      }}
                    />
                    <InlineField
                      label="URL"
                      value={proj.url ?? ""}
                      onChange={(v) => {
                        const items = profile.projects ?? [];
                        const idx = items.findIndex((p) => p.id === proj.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], url: v };
                          handleSave({ projects: next });
                        }
                      }}
                    />
                  </div>
                  <InlineField
                    label="Description"
                    value={proj.description}
                    multiline
                    onChange={(v) => {
                      const items = profile.projects ?? [];
                      const idx = items.findIndex((p) => p.id === proj.id);
                      if (idx >= 0) {
                        const next = [...items];
                        next[idx] = { ...next[idx], description: v };
                        handleSave({ projects: next });
                      }
                    }}
                  />
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Tags (comma separated)
                    </label>
                    <input
                      type="text"
                      value={proj.tags?.join(", ") ?? ""}
                      onChange={(e) => {
                        const items = profile.projects ?? [];
                        const idx = items.findIndex((p) => p.id === proj.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = {
                            ...next[idx],
                            tags: e.target.value
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          };
                          handleSave({ projects: next });
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
                      placeholder="react, typescript, api"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Bullets (one per line)
                    </label>
                    <textarea
                      rows={2}
                      value={proj.bullets?.join("\n") ?? ""}
                      onChange={(e) => {
                        const items = profile.projects ?? [];
                        const idx = items.findIndex((p) => p.id === proj.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = {
                            ...next[idx],
                            bullets: e.target.value
                              .split("\n")
                              .filter((b) => b.trim()),
                          };
                          handleSave({ projects: next });
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
                    />
                  </div>
                </div>
              )}
            />
          </CollapsibleSection>

          {/* ── Achievements ── */}
          <CollapsibleSection
            label={`Achievements (${profile.achievements?.length ?? 0})`}
            open={openSections.has("achievements")}
            onToggle={() => toggleSection("achievements")}
          >
            <ArrayField
              items={profile.achievements ?? []}
              emptyLabel="No achievements added yet."
              addLabel="Add Achievement"
              onAdd={() => {
                const newAch: Achievement = {
                  id: createId(),
                  title: "",
                  description: "",
                  date: "",
                };
                handleSave({
                  achievements: [...(profile.achievements ?? []), newAch],
                });
              }}
              onRemove={(id) => {
                handleSave({
                  achievements: (profile.achievements ?? []).filter(
                    (a) => a.id !== id,
                  ),
                });
              }}
              onChangeItem={(id, updater) => {
                handleSave({
                  achievements: (profile.achievements ?? []).map((a) =>
                    a.id === id ? updater(a) : a,
                  ),
                });
              }}
              renderItem={(ach) => (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InlineField
                      label="Title"
                      value={ach.title}
                      onChange={(v) => {
                        const items = profile.achievements ?? [];
                        const idx = items.findIndex((a) => a.id === ach.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], title: v };
                          handleSave({ achievements: next });
                        }
                      }}
                    />
                    <InlineField
                      label="Date"
                      value={ach.date ?? ""}
                      onChange={(v) => {
                        const items = profile.achievements ?? [];
                        const idx = items.findIndex((a) => a.id === ach.id);
                        if (idx >= 0) {
                          const next = [...items];
                          next[idx] = { ...next[idx], date: v };
                          handleSave({ achievements: next });
                        }
                      }}
                    />
                  </div>
                  <InlineField
                    label="Description"
                    value={ach.description ?? ""}
                    multiline
                    onChange={(v) => {
                      const items = profile.achievements ?? [];
                      const idx = items.findIndex((a) => a.id === ach.id);
                      if (idx >= 0) {
                        const next = [...items];
                        next[idx] = { ...next[idx], description: v };
                        handleSave({ achievements: next });
                      }
                    }}
                  />
                </div>
              )}
            />
          </CollapsibleSection>

          {/* ── Languages ── */}
          <CollapsibleSection
            label={`Languages (${languages.length})`}
            open={openSections.has("languages")}
            onToggle={() => toggleSection("languages")}
          >
            <p className="mb-3 text-xs text-zinc-500">
              Languages you speak and your proficiency level.
            </p>
            <ArrayField
              items={languages.map((l, i) => ({ id: `lang-${i}`, ...l }))}
              emptyLabel="No languages added yet."
              addLabel="Add Language"
              onAdd={() => {
                setLanguages([...languages, { language: "", level: "" }]);
              }}
              onRemove={(id) => {
                const idx = parseInt(id.replace("lang-", ""), 10);
                setLanguages(languages.filter((_, i) => i !== idx));
              }}
              onChangeItem={(id, updater) => {
                // We don't use updater here; we handle changes inline
              }}
              renderItem={(lang, idx) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Language
                    </label>
                    <input
                      type="text"
                      value={languages[idx]?.language ?? ""}
                      onChange={(e) => {
                        const next = [...languages];
                        next[idx] = {
                          ...next[idx],
                          language: e.target.value,
                        };
                        setLanguages(next);
                      }}
                      className="mt-1 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      Level
                    </label>
                    <input
                      type="text"
                      value={languages[idx]?.level ?? ""}
                      onChange={(e) => {
                        const next = [...languages];
                        next[idx] = { ...next[idx], level: e.target.value };
                        setLanguages(next);
                      }}
                      className="mt-1 w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
                      placeholder="Native, Fluent, Intermediate..."
                    />
                  </div>
                </div>
              )}
            />
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  handleSave({});
                }}
                disabled={saving}
                className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {saving ? "Saving..." : "Save Languages"}
              </button>
            </div>
          </CollapsibleSection>
        </div>
      </main>
    </div>
  );
}
