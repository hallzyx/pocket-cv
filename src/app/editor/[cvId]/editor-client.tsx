"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createId } from "@paralleldrive/cuid2";
import { EditorSection } from "@/components/editor/editor-section";
import { EditorPreview } from "@/components/editor/editor-preview";
import { AtsGauge } from "@/components/editor/ats-gauge";
import { generateHarvardCv } from "@/lib/latex/template";
import { evaluateAts } from "@/lib/ats";
import type { CvContent, PersonalInfo, Experience, Education, Skill, Project, Achievement } from "@/lib/db/schema";
import type { AtsResult } from "@/lib/ats";

interface CvData {
  id: string;
  title: string;
  contentJson: CvContent;
  texSource: string | null;
  atsScore: number | null;
}

type EditorTab =
  | "personalInfo"
  | "summary"
  | "experiences"
  | "education"
  | "skills"
  | "projects"
  | "achievements"
  | "languages";

const TABS: { key: EditorTab; label: string }[] = [
  { key: "personalInfo", label: "Personal Info" },
  { key: "summary", label: "Summary" },
  { key: "experiences", label: "Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills" },
  { key: "projects", label: "Projects" },
  { key: "achievements", label: "Achievements" },
  { key: "languages", label: "Languages" },
];

export function EditorClient({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name?: string;
}) {
  const params = useParams();
  const router = useRouter();
  const cvId = params.cvId as string;

  const [cv, setCv] = useState<CvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("personalInfo");
  const [texSource, setTexSource] = useState("");
  const [atsResult, setAtsResult] = useState<AtsResult | null>(null);
  const [atsLoading, setAtsLoading] = useState(false);
  const [activeRightPanel, setActiveRightPanel] = useState<"preview" | "ats">("preview");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cvRef = useRef<CvData | null>(null);

  // Keep a ref for latest CV data for the debounced save
  useEffect(() => {
    cvRef.current = cv;
  }, [cv]);

  // Fetch CV
  useEffect(() => {
    fetch(`/api/cvs/${cvId}`)
      .then(async (res) => {
        if (res.status === 404) throw new Error("CV not found");
        if (!res.ok) throw new Error("Failed to load CV");
        return res.json();
      })
      .then((data: CvData) => {
        setCv(data);
        const tex = generateHarvardCv(data.contentJson);
        setTexSource(tex);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cvId]);

  // Debounced auto-save
  const scheduleSave = useCallback(
    (contentJson: CvContent) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Update local tex + ATS immediately
      const tex = generateHarvardCv(contentJson);
      setTexSource(tex);

      const result = evaluateAts(contentJson);
      setAtsResult(result);
      setAtsLoading(false);

      // Debounced save to server
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          const res = await fetch(`/api/cvs/${cvId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contentJson,
              texSource: tex,
              atsScore: result.score,
            }),
          });
          if (!res.ok) throw new Error("Failed to save");
          const updated = await res.json();
          setCv(updated);
        } catch (err) {
          console.error("Auto-save failed:", err);
        } finally {
          setSaving(false);
        }
      }, 1500);

      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    },
    [cvId],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Content updaters ──

  function updatePersonalInfo(updates: Partial<PersonalInfo>) {
    if (!cv) return;
    const contentJson: CvContent = {
      ...cv.contentJson,
      personalInfo: { ...(cv.contentJson.personalInfo ?? {}), ...updates },
    };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateSummary(summary: string) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, summary };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateExperiences(experiences: Experience[]) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, experiences };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateEducation(education: Education[]) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, education };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateSkills(skills: Skill[]) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, skills };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateProjects(projects: Project[]) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, projects };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateAchievements(achievements: Achievement[]) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, achievements };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  function updateLanguages(languages: { language: string; level: string }[]) {
    if (!cv) return;
    const contentJson: CvContent = { ...cv.contentJson, languages };
    setCv((prev) => (prev ? { ...prev, contentJson } : prev));
    scheduleSave(contentJson);
  }

  // ── Loading State ──
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="h-6 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <main className="mx-auto max-w-6xl px-6 py-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="animate-pulse space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
              ))}
            </div>
            <div className="animate-pulse space-y-4">
              <div className="h-96 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Error State ──
  if (error || !cv) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <main className="mx-auto max-w-2xl px-6 py-24">
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950/30">
            <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
              {error === "CV not found" ? "CV not found" : "Error loading CV"}
            </h2>
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {error === "CV not found"
                ? "This CV doesn't exist or has been deleted."
                : error}
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const content = cv.contentJson;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      {/* Header */}
      <header className="border-b border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              ← Dashboard
            </Link>
            <h1 className="text-base font-semibold truncate max-w-48" title={cv.title}>
              {cv.title}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-xs text-zinc-500">Saving...</span>
            )}
            <a
              href={`/api/pdf/${cvId}`}
              download
              className="rounded-lg border border-black/[.1] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
            >
              Download PDF
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-5">
          {/* ── Left Panel: Editor Tabs ── */}
          <div className="lg:col-span-3">
            {/* Tab bar */}
            <div className="mb-4 flex flex-wrap gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab.key
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="space-y-4">
              {activeTab === "personalInfo" && (
                <PersonalInfoEditor
                  personalInfo={content.personalInfo}
                  onChange={updatePersonalInfo}
                />
              )}

              {activeTab === "summary" && (
                <SummaryEditor
                  summary={content.summary ?? ""}
                  onChange={updateSummary}
                />
              )}

              {activeTab === "experiences" && (
                <EditorSection
                  title="Experience"
                  fields={[
                    { key: "company", label: "Company", type: "text" },
                    { key: "title", label: "Title", type: "text" },
                    { key: "startDate", label: "Start Date", type: "text" },
                    { key: "endDate", label: "End Date", type: "text" },
                    { key: "location", label: "Location", type: "text" },
                    { key: "bullets", label: "Bullets", type: "textarea" },
                  ]}
                  values={content.experiences.map((e) => ({
                    ...e,
                    bullets: Array.isArray(e.bullets) ? e.bullets.join("\n") : "",
                  }))}
                  onChange={(values) => {
                    const parsed: Experience[] = values.map((v) => ({
                      ...v,
                      id: v.id,
                      bullets: typeof v.bullets === "string"
                        ? (v.bullets as string).split("\n").filter((b: string) => b.trim())
                        : (v.bullets as string[]),
                    }));
                    updateExperiences(parsed);
                  }}
                  emptyLabel="No experience entries yet."
                />
              )}

              {activeTab === "education" && (
                <EditorSection
                  title="Education"
                  fields={[
                    { key: "institution", label: "Institution", type: "text" },
                    { key: "degree", label: "Degree", type: "text" },
                    { key: "field", label: "Field", type: "text" },
                    { key: "startDate", label: "Start Date", type: "text" },
                    { key: "endDate", label: "End Date", type: "text" },
                    { key: "details", label: "Details", type: "textarea" },
                  ]}
                  values={content.education}
                  onChange={(values) => {
                    updateEducation(values as Education[]);
                  }}
                  emptyLabel="No education entries yet."
                />
              )}

              {activeTab === "skills" && (
                <SkillsEditor
                  skills={content.skills}
                  onChange={updateSkills}
                />
              )}

              {activeTab === "projects" && (
                <EditorSection
                  title="Projects"
                  fields={[
                    { key: "name", label: "Name", type: "text" },
                    { key: "description", label: "Description", type: "textarea" },
                    { key: "url", label: "URL", type: "text" },
                    { key: "tags", label: "Tags", type: "text" },
                    { key: "bullets", label: "Bullets", type: "textarea" },
                  ]}
                  values={content.projects?.map((p) => ({
                    ...p,
                    tags: Array.isArray(p.tags) ? p.tags.join(", ") : "",
                    bullets: Array.isArray(p.bullets) ? p.bullets.join("\n") : "",
                  })) ?? []}
                  onChange={(values) => {
                    const parsed: Project[] = values.map((v) => ({
                      ...v,
                      id: v.id,
                      tags: typeof v.tags === "string"
                        ? (v.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean)
                        : (v.tags as string[]),
                      bullets: typeof v.bullets === "string"
                        ? (v.bullets as string).split("\n").filter((b: string) => b.trim())
                        : (v.bullets as string[]),
                    }));
                    updateProjects(parsed);
                  }}
                  emptyLabel="No projects yet."
                />
              )}

              {activeTab === "achievements" && (
                <EditorSection
                  title="Achievements"
                  fields={[
                    { key: "title", label: "Title", type: "text" },
                    { key: "description", label: "Description", type: "textarea" },
                    { key: "date", label: "Date", type: "text" },
                  ]}
                  values={content.achievements ?? []}
                  onChange={(values) => {
                    updateAchievements(values as Achievement[]);
                  }}
                  emptyLabel="No achievements yet."
                />
              )}

              {activeTab === "languages" && (
                <LanguagesEditor
                  languages={content.languages ?? []}
                  onChange={updateLanguages}
                />
              )}
            </div>
          </div>

          {/* ── Right Panel: Preview + ATS ── */}
          <div className="space-y-4 lg:col-span-2">
            {/* Panel switcher (mobile) */}
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900 lg:hidden">
              <button
                type="button"
                onClick={() => setActiveRightPanel("preview")}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  activeRightPanel === "preview"
                    ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500"
                }`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setActiveRightPanel("ats")}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  activeRightPanel === "ats"
                    ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500"
                }`}
              >
                ATS Score
              </button>
            </div>

            {/* Preview panel (desktop always visible, mobile toggle) */}
            <div className={`${activeRightPanel === "preview" ? "block" : "hidden"} lg:block`}>
              <EditorPreview texSource={texSource} loading={false} />
            </div>

            {/* ATS gauge */}
            <div className={`${activeRightPanel === "ats" ? "block" : "hidden"} lg:block`}>
              <AtsGauge result={atsResult} loading={atsLoading} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components for specific editors ──

function PersonalInfoEditor({
  personalInfo,
  onChange,
}: {
  personalInfo: PersonalInfo;
  onChange: (updates: Partial<PersonalInfo>) => void;
}) {
  const [local, setLocal] = useState(personalInfo);

  useEffect(() => {
    setLocal(personalInfo);
  }, [personalInfo]);

  function handleChange(key: string, value: string) {
    const updated = { ...local, [key]: value || undefined } as PersonalInfo;
    setLocal(updated);
    onChange(updated);
  }

  const fields: { key: "fullName" | "headline" | "email" | "phone" | "location" | "website" | "linkedin" | "github"; label: string; type?: string }[] = [
    { key: "fullName", label: "Full Name" },
    { key: "headline", label: "Headline" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "location", label: "Location" },
    { key: "website", label: "Website", type: "url" },
    { key: "linkedin", label: "LinkedIn", type: "url" },
    { key: "github", label: "GitHub", type: "url" },
  ];

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
      <h3 className="mb-4 text-sm font-semibold">Personal Info</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {f.label}
            </label>
            <input
              type={f.type ?? "text"}
              value={local[f.key] ?? ""}
              onChange={(e) => handleChange(f.key, e.target.value)}
              className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryEditor({
  summary,
  onChange,
}: {
  summary: string;
  onChange: (val: string) => void;
}) {
  const [local, setLocal] = useState(summary);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(summary);
  }, [summary]);

  function handleChange(val: string) {
    setLocal(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(val), 800);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
      <h3 className="mb-2 text-sm font-semibold">Summary</h3>
      <p className="mb-3 text-xs text-zinc-500">
        A brief professional summary that appears at the top of your CV.
      </p>
      <textarea
        rows={5}
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black dark:border-white/[.15]"
        placeholder="Experienced software engineer with a passion for..."
      />
    </div>
  );
}

function SkillsEditor({
  skills,
  onChange,
}: {
  skills: Skill[];
  onChange: (skills: Skill[]) => void;
}) {
  const [items, setItems] = useState(skills);

  useEffect(() => {
    setItems(skills);
  }, [skills]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(updated: Skill[]) {
    setItems(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(updated), 800);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function addCategory() {
    handleChange([...items, { id: createId(), category: "", items: [] }]);
  }

  function removeCategory(id: string) {
    handleChange(items.filter((s) => s.id !== id));
  }

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
      <h3 className="mb-4 text-sm font-semibold">Skills</h3>

      {items.length === 0 && (
        <p className="mb-3 text-xs text-zinc-500">No skill categories yet.</p>
      )}

      <div className="space-y-3">
        {items.map((skill) => (
          <div
            key={skill.id}
            className="rounded-lg border border-black/[.06] p-3 dark:border-white/[.1]"
          >
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={skill.category}
                onChange={(e) =>
                  handleChange(
                    items.map((s) =>
                      s.id === skill.id ? { ...s, category: e.target.value } : s,
                    ),
                  )
                }
                className="flex-1 rounded-lg border border-black/[.1] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-black dark:border-white/[.15]"
                placeholder="Category (e.g. Languages, Frameworks)"
              />
              <button
                type="button"
                onClick={() => removeCategory(skill.id)}
                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
            <input
              type="text"
              value={skill.items.join(", ")}
              onChange={(e) =>
                handleChange(
                  items.map((s) =>
                    s.id === skill.id
                      ? {
                          ...s,
                          items: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        }
                      : s,
                  ),
                )
              }
              className="mt-2 w-full rounded-lg border border-black/[.1] bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-black dark:border-white/[.15]"
              placeholder="React, TypeScript, Node.js (comma separated)"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addCategory}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Category
      </button>
    </div>
  );
}

function LanguagesEditor({
  languages,
  onChange,
}: {
  languages: { language: string; level: string }[];
  onChange: (languages: { language: string; level: string }[]) => void;
}) {
  const [items, setItems] = useState(languages);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setItems(languages);
  }, [languages]);

  function handleChange(updated: { language: string; level: string }[]) {
    setItems(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(updated), 800);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
      <h3 className="mb-4 text-sm font-semibold">Languages</h3>

      {items.length === 0 && (
        <p className="mb-3 text-xs text-zinc-500">No languages added yet.</p>
      )}

      <div className="space-y-2">
        {items.map((lang, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={lang.language}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], language: e.target.value };
                handleChange(next);
              }}
              className="flex-1 rounded-lg border border-black/[.1] bg-transparent px-2.5 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
              placeholder="Language"
            />
            <input
              type="text"
              value={lang.level}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], level: e.target.value };
                handleChange(next);
              }}
              className="w-28 rounded-lg border border-black/[.1] bg-transparent px-2.5 py-2 text-sm outline-none focus:border-black dark:border-white/[.15]"
              placeholder="Native"
            />
            <button
              type="button"
              onClick={() => handleChange(items.filter((_, i) => i !== idx))}
              className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => handleChange([...items, { language: "", level: "" }])}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Language
      </button>
    </div>
  );
}
