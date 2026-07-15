"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/nav-bar";

interface CvListItem {
  id: string;
  title: string;
  atsScore: number | null;
  updatedAt: string;
  createdAt: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function AtsBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
        —
      </span>
    );
  }

  const color =
    score < 50
      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
      : score < 75
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

export function DashboardClient({
  user,
}: {
  user: { id: string; name?: string; email: string };
}) {
  const router = useRouter();
  const [cvs, setCvs] = useState<CvListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cvs")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load CVs");
        return res.json();
      })
      .then((data) => setCvs(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/cvs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create CV");
      }
      const created = await res.json();
      router.push(`/editor/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating CV");
      setCreating(false);
      setShowCreateDialog(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/cvs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setCvs((prev) => prev.filter((cv) => cv.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error deleting CV");
    } finally {
      setDeletingId(null);
    }
  }

  // ── Loading State ──
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <NavBar email={user.email} name={user.name} />
        <main className="mx-auto max-w-4xl px-6 py-12">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800"
              />
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <NavBar email={user.email} name={user.name} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My CVs</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Manage your CVs — create new ones or edit existing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Create CV
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        {/* ── Empty State ── */}
        {cvs.length === 0 && (
          <div className="rounded-2xl border border-dashed border-black/[.15] bg-white p-16 text-center dark:border-white/[.2] dark:bg-zinc-950">
            <svg
              className="mx-auto mb-4 h-12 w-12 text-zinc-300 dark:text-zinc-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <h2 className="text-lg font-semibold tracking-tight">
              No CVs yet
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
              Create your first CV from your profile. You can edit, preview the
              LaTeX source, and check the ATS score.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="mt-6 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              Create your first CV
            </button>
          </div>
        )}

        {/* ── CV List ── */}
        {cvs.length > 0 && (
          <div className="space-y-2">
            {cvs.map((cv) => (
              <div
                key={cv.id}
                className="flex items-center justify-between rounded-xl border border-black/[.08] bg-white px-5 py-4 transition-colors hover:border-black/[.15] dark:border-white/[.145] dark:bg-zinc-950 dark:hover:border-white/[.25]"
              >
                <Link
                  href={`/editor/${cv.id}`}
                  className="flex-1 min-w-0"
                >
                  <h3 className="text-sm font-medium truncate">{cv.title}</h3>
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{formatDate(cv.updatedAt)}</span>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <span>
                      ATS: <AtsBadge score={cv.atsScore} />
                    </span>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    if (
                      window.confirm(
                        `Are you sure you want to delete "${cv.title}"? This cannot be undone.`,
                      )
                    ) {
                      handleDelete(cv.id);
                    }
                  }}
                  disabled={deletingId === cv.id}
                  className="ml-4 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
                  title="Delete CV"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Create Dialog ── */}
        {showCreateDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl border border-black/[.08] bg-white p-6 shadow-lg dark:border-white/[.145] dark:bg-zinc-950">
              <h2 className="text-lg font-semibold tracking-tight">
                Create new CV
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Give your CV a name. It will be seeded from your profile.
              </p>

              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium">
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                  className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black dark:border-white/[.15]"
                  placeholder="e.g. General CV, Google Application"
                  autoFocus
                />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateDialog(false);
                    setNewTitle("");
                  }}
                  className="rounded-lg border border-black/[.1] px-4 py-2 text-sm font-medium dark:border-white/[.15]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !newTitle.trim()}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
