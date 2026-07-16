"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { NavBar } from "@/components/nav-bar";
import {
  parseSseBuffer,
  reduceClientState,
  deriveGrowth,
  type StreamEvent,
  type ChatMessage,
  type ProfileGrowth,
  type ClientState,
} from "@/lib/ai/sse-client";

// ── Constants ──

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 15000;

// ── Types ──

interface Interview {
  id: string;
  status: "active" | "paused" | "completed";
  purpose: string | null;
  transcriptVersion: number;
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

// ── Bounded exponential backoff ──

function backoffDelay(attempt: number): number {
  const jitter = Math.random() * 500;
  return Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempt) + jitter, RECONNECT_MAX_DELAY);
}

/**
 * Detect whether a set of events contains a terminal event (run completed/failed/cancelled or done).
 */
function hasTerminalEvent(events: StreamEvent[]): boolean {
  return events.some(
    (e) =>
      e.type === "run.completed" ||
      e.type === "run.failed" ||
      e.type === "run.cancelled" ||
      e.type === "done",
  );
}

// ── Component ──

export function InterviewClient({ user }: { user: { id: string; name?: string; email: string } }) {
  // Session state
  const [sessions, setSessions] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [lastKnownVersion, setLastKnownVersion] = useState(0);
  const [growth, setGrowth] = useState<ProfileGrowth | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [profileChanges, setProfileChanges] = useState<string[]>([]);

  // Refs for streaming lifecycle
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamDoneRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Shared state ref for use in callbacks (avoids stale closures) ──
  const stateRef = useRef({ messages, profileChanges, lastKnownVersion, runId });
  stateRef.current = { messages, profileChanges, lastKnownVersion, runId };

  // ── Apply events through the pure reducer ──

  const reduceEvents = useCallback((rawEvents: StreamEvent[], fromVersion?: number): ClientState => {
    const current = stateRef.current;
    const baseVersion = fromVersion ?? current.lastKnownVersion;

    const next = reduceClientState(
      {
        messages: current.messages,
        profileChanges: current.profileChanges,
        lastKnownVersion: baseVersion,
        runId: current.runId,
      },
      rawEvents,
    );

    // Sync ref immediately so subsequent async reads see the latest state
    stateRef.current = next;
    setMessages(next.messages);
    setProfileChanges(next.profileChanges);
    setLastKnownVersion(next.lastKnownVersion);
    if (next.runId) setRunId(next.runId);

    return next;
  }, []);

  // ── Load sessions ──

  const initialLoadDone = useRef(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/interviews");
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = (await res.json()) as Interview[];
      setSessions(data);
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        const active = data.find((s) => s.status === "active");
        if (active) {
          // Call handleSelect directly
          selectSession(active.id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading sessions");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Select session (load/replay events) ──

  const selectSession = useCallback(async (id: string) => {
    setSelectedId(id);
    setGrowth(null);
    setError(null);
    setMessages([]);
    setProfileChanges([]);
    setRunId(null);
    setLastKnownVersion(0);

    try {
      const res = await fetch(`/api/interviews/${id}/events?lastKnownVersion=0`);
      if (!res.ok) throw new Error("Failed to load events");
      const sseText = await res.text();
      const { events } = parseSseBuffer(sseText + "\n\n");

      const next = reduceClientState(
        { messages: [], profileChanges: [], lastKnownVersion: 0, runId: null },
        events,
      );

      setMessages(next.messages);
      setProfileChanges(next.profileChanges);
      setLastKnownVersion(next.lastKnownVersion);
      if (next.runId) setRunId(next.runId);

      // Derive growth for completed sessions
      const session = sessions.find((s) => s.id === id);
      if (session?.status === "completed" && next.profileChanges.length > 0) {
        const g = deriveGrowth(next.profileChanges);
        if (g) setGrowth(g);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading events");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // But we need handleSelect to be a usable callback too
  const handleSelect = useCallback((id: string) => {
    selectSession(id);
  }, [selectSession]);

  // ── Create new interview ──

  const handleStart = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Profile building" }),
      });
      if (!res.ok) throw new Error("Failed to start interview");
      const session = (await res.json()) as Interview;
      setSessions((prev) => [session, ...prev]);
      setSelectedId(session.id);
      setLastKnownVersion(0);
      setMessages([]);
      setGrowth(null);
      setProfileChanges([]);
      setRunId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error starting interview");
    }
  }, []);

  // ── Reconnect via GET /events to catch up on missed events ──

  const reconnectEvents = useCallback(async (
    interviewId: string,
    fromVersion: number,
  ): Promise<{ found: boolean; terminal: boolean }> => {
    try {
      const res = await fetch(
        `/api/interviews/${interviewId}/events?lastKnownVersion=${fromVersion}`,
      );
      if (!res.ok) return { found: false, terminal: false };
      const sseText = await res.text();
      const { events } = parseSseBuffer(sseText + "\n\n");
      if (events.length === 0) return { found: true, terminal: false };

      reduceEvents(events, fromVersion);
      return { found: true, terminal: hasTerminalEvent(events) };
    } catch {
      return { found: false, terminal: false };
    }
  }, [reduceEvents]);

  // ── Send message and consume SSE stream ──

  const handleSend = useCallback(async () => {
    if (!input.trim() || !selectedId || streaming) return;
    const msg = input.trim();
    setInput("");
    setStreaming(true);
    setGrowth(null);
    streamDoneRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/interviews/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? "Send failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let consumedTerminal = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseBuffer(buffer);
        buffer = remainder;

        if (events.length > 0) {
          reduceEvents(events);
          if (hasTerminalEvent(events)) {
            consumedTerminal = true;
          }
        }
      }

      // If the stream ended without a terminal event (transport disconnect
      // or incomplete), attempt bounded reconnection via GET /events.
      // Continue through nonterminal batches (cursor advanced but no terminal)
      // until either a terminal event arrives or MAX_RECONNECT_ATTEMPTS exhausted.
      let foundTerminal = consumedTerminal;
      if (!foundTerminal && !controller.signal.aborted) {
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
          const delay = backoffDelay(attempt);
          await new Promise((r) => {
            reconnectTimerRef.current = setTimeout(r, delay);
          });
          if (controller.signal.aborted) break;

          const currentVersion = stateRef.current.lastKnownVersion;
          const result = await reconnectEvents(selectedId, currentVersion);
          if (result.terminal) {
            foundTerminal = true;
            break;
          }
          if (!result.found) break; // No data at all — stop trying
        }
      }
      // Reconnection exhausted — surface error to user
      if (!foundTerminal && !controller.signal.aborted) {
        setError("Could not reconnect after disconnect. Send a new message to continue.");
      }

      // R3: automatic growth when terminal event arrives in-stream with profile changes
      if (foundTerminal && stateRef.current.profileChanges.length > 0) {
        const g = deriveGrowth(stateRef.current.profileChanges);
        if (g) setGrowth(g);
        // Mark session as completed in local state so UI reflects completion
        setSessions((prev) =>
          prev.map((s) =>
            s.id === selectedId ? { ...s, status: "completed" as const } : s,
          ),
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Stream error");
    } finally {
      streamDoneRef.current = true;
      setStreaming(false);
    }
  }, [input, selectedId, streaming, reduceEvents, reconnectEvents]);

  // ── Cancel (server-side via run endpoint) ──

  const handleCancel = useCallback(async () => {
    if (!selectedId) return;
    setError(null);

    const currentRunId = stateRef.current.runId;
    if (!currentRunId) {
      // No run known — just abort local transport
      abortRef.current?.abort();
      setStreaming(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/interviews/${selectedId}/runs/${currentRunId}/cancel`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status !== 409) {
          setError(data.error ?? "Cancel failed");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel request failed");
    }

    // Abort local transport after/alongside server cancel
    abortRef.current?.abort();
    setStreaming(false);
  }, [selectedId]);

  // ── Pause / Resume / Complete ──

  const handleTransition = useCallback(async (status: "paused" | "active" | "completed") => {
    if (!selectedId) return;
    setError(null);
    try {
      const res = await fetch(`/api/interviews/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Failed to ${status}`);
      const updated = (await res.json()) as Interview;
      setSessions((prev) => prev.map((s) => (s.id === selectedId ? updated : s)));

      if (status === "completed") {
        // Derive profile-growth summary from profile.updated events tracked
        const g = deriveGrowth(stateRef.current.profileChanges);
        if (g) setGrowth(g);
      }
      if (status === "active") {
        // Reload events from last known version
        try {
          const currentVersion = stateRef.current.lastKnownVersion;
          const res = await fetch(
            `/api/interviews/${selectedId}/events?lastKnownVersion=${currentVersion}`,
          );
          const sseText = await res.text();
          const { events } = parseSseBuffer(sseText + "\n\n");
          if (events.length > 0) reduceEvents(events);
        } catch { /* events replay is best-effort */ }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Error changing status`);
    }
  }, [selectedId, reduceEvents]);

  // ── Auto-scroll chat ──

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: "smooth" } as unknown as ScrollIntoViewOptions);
  }, [messages]);

  // ── Keyboard shortcut ──

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // ── Loading State ──

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <NavBar email={user.email} name={user.name} />
        <main className="mx-auto max-w-4xl px-6 py-12">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ── Session List ──

  if (!selectedId) {
    const activeSession = sessions.find((s) => s.status === "active" || s.status === "paused");

    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black">
        <NavBar email={user.email} name={user.name} />
        <main className="mx-auto max-w-3xl px-6 py-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Interview</h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Build your profile through guided conversation with AI.
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
              {error}
            </p>
          )}

          {sessions.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/[.15] bg-white p-16 text-center dark:border-white/[.2] dark:bg-zinc-950">
              <svg className="mx-auto mb-4 h-12 w-12 text-zinc-300 dark:text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <h2 className="text-lg font-semibold tracking-tight">
                Let&apos;s build your profile
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
                Start a guided interview. The AI will ask about your experience, education, skills, and projects.
              </p>
              <button
                type="button"
                onClick={handleStart}
                className="mt-6 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Start Interview
              </button>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="space-y-3">
              {activeSession && (
                <button
                  type="button"
                  onClick={() => handleSelect(activeSession.id)}
                  className="w-full rounded-xl border-2 border-black/20 bg-white px-5 py-4 text-left transition-colors hover:border-black/40 dark:border-white/20 dark:bg-zinc-950 dark:hover:border-white/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-sm font-semibold">
                      {activeSession.status === "active" ? "Active Session" : "Paused Session"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Started {formatDate(activeSession.createdAt)}
                  </p>
                  {activeSession.purpose && (
                    <p className="mt-0.5 text-xs text-zinc-400">{activeSession.purpose}</p>
                  )}
                </button>
              )}

              {sessions.filter((s) => s.status === "completed").slice(0, 5).map((session) => (
                <div
                  key={session.id}
                  className="rounded-xl border border-black/[.08] bg-white px-5 py-3 dark:border-white/[.145] dark:bg-zinc-950"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                        <span className="text-sm font-medium">Completed</span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {formatDate(session.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelect(session.id)}
                      className="rounded-lg border border-black/[.1] px-3 py-1 text-xs font-medium dark:border-white/[.15]"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={handleStart}
                className="mt-4 w-full rounded-lg border border-dashed border-black/[.15] px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:border-black/30 hover:text-zinc-700 dark:border-white/[.2] dark:hover:border-white/30 dark:hover:text-zinc-300"
              >
                + Start New Interview
              </button>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ── Chat UI ──

  const currentSession = sessions.find((s) => s.id === selectedId);
  const isActive = currentSession?.status === "active";
  const isPaused = currentSession?.status === "paused";
  const isCompleted = currentSession?.status === "completed";
  const activeOrPaused = isActive || isPaused;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <NavBar email={user.email} name={user.name} />

      <header className="border-b border-black/[.08] bg-white px-6 py-3 dark:border-white/[.145] dark:bg-zinc-950">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setSelectedId(null); setMessages([]); setGrowth(null); setProfileChanges([]); setRunId(null); }}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Back to sessions"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-base font-semibold tracking-tight">Interview</h1>
              <p className="text-xs text-zinc-500">
                {isActive ? "Active" : isPaused ? "Paused" : "Completed"}
                {" · "}v{lastKnownVersion}
              </p>
            </div>
          </div>

          {activeOrPaused && (
            <div className="flex items-center gap-2">
              {streaming && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                  aria-label="Cancel running interview run"
                >
                  Cancel
                </button>
              )}
              {isActive && !streaming && (
                <button
                  type="button"
                  onClick={() => handleTransition("paused")}
                  className="rounded-lg border border-black/[.1] px-3 py-1.5 text-xs font-medium dark:border-white/[.15]"
                  aria-label="Pause interview"
                >
                  Pause
                </button>
              )}
              {isPaused && (
                <button
                  type="button"
                  onClick={() => handleTransition("active")}
                  className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-black"
                  aria-label="Resume interview"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                onClick={() => handleTransition("completed")}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                aria-label="Complete interview"
              >
                Complete
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Chat area with aria-live for dynamic updates */}
      <div
        className="flex-1 overflow-y-auto px-6 py-6"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        <div className="mx-auto max-w-4xl space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {isCompleted
                  ? "This interview is complete. Start a new one to continue building your profile."
                  : "Send a message to begin the conversation."}
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              role="status"
              aria-label={
                msg.role === "user"
                  ? `You: ${msg.content.slice(0, 60)}`
                  : msg.role === "tool"
                    ? `Tool ${msg.toolName}: ${msg.toolStatus ?? ""}`
                    : msg.role === "system"
                      ? `System: ${msg.content}`
                      : `Assistant: ${msg.content.slice(0, 60)}`
              }
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : msg.role === "tool"
                      ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                      : msg.role === "system"
                        ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        : "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                }`}
              >
                {msg.role === "tool" && msg.toolName && (
                  <p className="mb-1 text-xs font-medium opacity-70">
                    🔧 {msg.toolName}
                    {msg.toolStatus === "running" && " …"}
                  </p>
                )}
                {msg.role === "tool" && msg.toolStatus && msg.toolStatus !== "running" && (
                  <span className={`ml-1 text-xs ${msg.toolStatus === "applied" ? "text-emerald-600" : msg.toolStatus === "confirmation_required" ? "text-amber-600" : "text-red-600"}`}>
                    [{msg.toolStatus}]
                  </span>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {streaming && (
            <div className="flex justify-start" role="status" aria-label="Assistant is typing">
              <div className="rounded-2xl bg-white px-4 py-2.5 text-sm shadow-sm dark:bg-zinc-950">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-900 dark:bg-red-950/30">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => { setError(null); loadSessions(); }}
                className="mt-2 rounded-lg bg-black px-4 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-black"
              >
                Retry
              </button>
            </div>
          )}

          {/* Growth Summary */}
          {growth && (
            <div
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-950/20"
              role="status"
              aria-label="Profile growth summary"
            >
              <h3 className="text-base font-semibold text-emerald-800 dark:text-emerald-300">
                🎯 Profile Growth
              </h3>
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                {growth.summary}
              </p>
              {growth.sectionsUpdated.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {growth.sectionsUpdated.map((s) => (
                    <span key={s} className="rounded-full bg-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => { setSelectedId(null); setGrowth(null); }}
                className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Back to Sessions
              </button>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input */}
      {isActive && (
        <div className="border-t border-black/[.08] bg-white px-6 py-4 dark:border-white/[.145] dark:bg-zinc-950">
          <div className="mx-auto flex max-w-4xl gap-3">
            <label htmlFor="chat-input" className="sr-only">Message input</label>
            <input
              id="chat-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              placeholder={streaming ? "Waiting for response…" : "Type your message…"}
              className="flex-1 rounded-xl border border-black/[.1] bg-transparent px-4 py-2.5 text-sm outline-none focus:border-black disabled:opacity-50 dark:border-white/[.15] dark:focus:border-white"
              autoFocus
              aria-label="Chat message input"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              aria-label="Send message"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {isPaused && (
        <div className="border-t border-black/[.08] bg-zinc-100 px-6 py-4 dark:border-white/[.145] dark:bg-zinc-900">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm text-zinc-500">
              Interview is paused. Click <strong>Resume</strong> to continue.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
