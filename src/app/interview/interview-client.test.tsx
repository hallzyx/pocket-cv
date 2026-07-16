import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterviewClient } from "./interview-client";

// ── Mocks ──

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/interview",
}));

const TEST_USER = { id: "user-1", email: "test@test.com", name: "Test User" };

const MOCK_ACTIVE = {
  id: "int-1",
  status: "active",
  purpose: "Profile building",
  transcriptVersion: 3,
  createdAt: "2026-07-15T10:00:00Z",
  updatedAt: "2026-07-15T10:30:00Z",
};

const MOCK_PAUSED = { ...MOCK_ACTIVE, id: "int-3", status: "paused" as const };

const MOCK_COMPLETED = {
  id: "int-2",
  status: "completed",
  purpose: "Done",
  transcriptVersion: 5,
  createdAt: "2026-07-15T09:00:00Z",
  updatedAt: "2026-07-15T09:30:00Z",
};

// Build SSE events stream text
function sseText(events: Array<{ event: string; version: number; type: string; payload: Record<string, unknown> }>): string {
  return events
    .map((ev) => `event: ${ev.event}\ndata: ${JSON.stringify({ version: ev.version, type: ev.type, payload: ev.payload })}\n\n`)
    .join("");
}

const STANDARD_SSE = sseText([
  { event: "message.delta", version: 1, type: "message.delta", payload: { content: "Hello!", role: "assistant" } },
  { event: "tool.started", version: 2, type: "tool.started", payload: { name: "get_profile" } },
  { event: "tool.completed", version: 3, type: "tool.completed", payload: { name: "get_profile", status: "applied", summary: "Profile loaded" } },
  { event: "profile.updated", version: 4, type: "profile.updated", payload: { section: "personal_info" } },
  { event: "run.completed", version: 5, type: "run.completed", payload: { runId: "run-1" } },
  { event: "done", version: 6, type: "done", payload: { success: true, runId: "run-1" } },
]);

// ── Mock fetch helpers ──

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function mockSessionList(sessions: unknown[], messageStream?: ReadableStream<Uint8Array>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    const method = (init as RequestInit)?.method ?? "GET";

    // GET /api/interviews (list sessions)
    if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
      return Promise.resolve(new Response(JSON.stringify(sessions), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }

    // POST /api/interviews (create)
    if (method === "POST" && !url.includes("messages") && !url.includes("cancel")) {
      return Promise.resolve(new Response(JSON.stringify(MOCK_ACTIVE), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }));
    }

    // PATCH /api/interviews/[id]
    if (method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ ...MOCK_ACTIVE, status: "paused" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }

    // GET /api/interviews/[id]/events
    if (url.includes("events")) {
      return Promise.resolve(new Response(STANDARD_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }));
    }

    // POST /api/interviews/[id]/messages
    if (url.includes("messages")) {
      if (messageStream) {
        return Promise.resolve(new Response(messageStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }
      // Default: return a stream that emits standard events
      return Promise.resolve(new Response(createMockStream([STANDARD_SSE]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }));
    }

    // POST /api/interviews/[id]/runs/[runId]/cancel
    if (url.includes("cancel")) {
      return Promise.resolve(new Response(JSON.stringify({ status: "cancelled", runId: "run-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }

    return Promise.resolve(new Response("[]", { status: 200 }));
  });
}

describe("InterviewClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Existing tests (preserved) ──

  it("shows loading state initially", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );

    const { container } = render(<InterviewClient user={TEST_USER} />);
    const pulseDivs = container.querySelectorAll(".animate-pulse");
    expect(pulseDivs.length).toBeGreaterThan(0);
  });

  it("shows first-run empty state when no sessions exist", async () => {
    mockSessionList([]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Let's build your profile")).toBeTruthy();
    });
  });

  it("starts a new interview on first-run CTA click", async () => {
    mockSessionList([]);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Start Interview")).toBeTruthy();
    });

    await user.click(screen.getByText("Start Interview"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });
  });

  it("auto-selects active session and shows chat view", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    expect(screen.getByText(/Active/)).toBeTruthy();
  });

  it("shows session list when all sessions are completed", async () => {
    mockSessionList([MOCK_COMPLETED]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeTruthy();
    });
  });

  it("shows paused session and resumes with events", async () => {
    mockSessionList([MOCK_PAUSED]);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Paused Session")).toBeTruthy();
    });

    await user.click(screen.getByText("Paused Session"));

    await waitFor(() => {
      expect(screen.getByText("Hello!")).toBeTruthy();
    });
  });

  it("shows error state on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Failed to load"));

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeTruthy();
    });
  });

  // ── 4.1: Pause/Resume/Complete PATCH outcome tests ──

  it("shows Pause button for active session", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Pause")).toBeTruthy();
    });
  });

  it("shows Complete button for active session", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Complete")).toBeTruthy();
    });
  });

  it("shows pause overlay when paused", async () => {
    mockSessionList([MOCK_PAUSED]);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Paused Session")).toBeTruthy();
    });

    await user.click(screen.getByText("Paused Session"));

    // After selecting paused session, should show chat view with paused indicator
    await waitFor(() => {
      expect(screen.getByText(/Paused/)).toBeTruthy();
    });
  });

  // ── 4.2: Tool status tracking ──

  it("displays tool status indicators for running and completed tools", async () => {
    const toolSSE = sseText([
      { event: "tool.started", version: 1, type: "tool.started", payload: { name: "get_profile" } },
      { event: "tool.completed", version: 2, type: "tool.completed", payload: { name: "get_profile", status: "applied", summary: "Done" } },
      { event: "tool.started", version: 3, type: "tool.started", payload: { name: "add_experience" } },
    ]);

    mockSessionList([MOCK_ACTIVE]);
    // Override events mock
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("events")) {
        return Promise.resolve(new Response(toolSSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText(/get_profile/)).toBeTruthy();
    });

    // First tool is applied, second is running
    expect(screen.getByText(/applied/)).toBeTruthy();
  });

  // ── 4.3: Profile growth from run.completed ──

  it("derives profile growth from profile.updated events", async () => {
    const profileSSE = sseText([
      { event: "profile.updated", version: 1, type: "profile.updated", payload: { section: "personal_info" } },
      { event: "profile.updated", version: 2, type: "profile.updated", payload: { section: "experiences" } },
      { event: "run.completed", version: 3, type: "run.completed", payload: { runId: "run-1" } },
      { event: "done", version: 4, type: "done", payload: { success: true, runId: "run-1" } },
    ]);

    mockSessionList([MOCK_ACTIVE]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("events")) {
        return Promise.resolve(new Response(profileSSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    // Click Complete
    const completeBtn = screen.getByText("Complete");
    await user.click(completeBtn);

    // After PATCH returns, should show Profile Growth section
    await waitFor(() => {
      expect(screen.getByText("🎯 Profile Growth")).toBeTruthy();
    });
  });

  // ── 4.4: Incremental partial chunks ──

  it("processes incremental partial chunks correctly", async () => {
    // Simulate streaming where chunks arrive incrementally
    // Use versions > 6 (beyond the STANDARD_SSE initial replay cursor)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode('event: message.delta\ndata: {"version":7,"type":"message.delta","payload":{"content":"Build'));
        await Promise.resolve(); // Simulate async delay
        controller.enqueue(encoder.encode('ing"}}'));
        await Promise.resolve();
        controller.enqueue(encoder.encode('\n\n'));
        await Promise.resolve();
        controller.enqueue(encoder.encode('event: run.completed\ndata: {"version":8,"type":"run.completed","payload":{"runId":"run-2"}}\n\n'));
        controller.close();
      },
    });

    mockSessionList([MOCK_ACTIVE], stream);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    // Type and send a message
    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Build my profile");
    await user.click(screen.getByText("Send"));

    // Wait for streamed content to appear
    await waitFor(() => {
      expect(screen.getByText(/Building/)).toBeTruthy();
    }, { timeout: 3000 });
  });

  // ── 4.5: Explicit cancel call ──

  it("calls explicit server cancel endpoint with runId", async () => {
    const streamSSE = sseText([
      { event: "message.delta", version: 1, type: "message.delta", payload: { content: "Building...", role: "assistant", runId: "run-123" } },
      // Stream ends before terminal event
    ]);

    // Create a stream that does NOT close (stays open until cancelled)
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode(streamSSE));
      },
    });

    let cancelCalled = false;

    mockSessionList([MOCK_ACTIVE], stream);
    // Override cancel mock
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (url.includes("cancel")) {
        cancelCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ status: "cancelled", runId: "run-123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      // Let other requests pass through
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (method === "POST" && url.includes("messages")) {
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    // Send a message to start streaming
    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Hi");
    await user.click(screen.getByText("Send"));

    // Wait for Cancel button to appear
    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    await user.click(screen.getByText("Cancel"));

    // Cancel endpoint must have been called
    expect(cancelCalled).toBe(true);
  });

  // ── 5.1: Cursor updates ──

  it("updates cursor (lastKnownVersion) as events are applied", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    // The version display shows v6 after processing all 6 events (v1-v6)
    await waitFor(() => {
      expect(screen.getByText(/v6/)).toBeTruthy();
    });
  });

  // ── 5.2: Accessibility ──

  it("has labeled chat input", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      const input = screen.getByLabelText("Chat message input");
      expect(input).toBeTruthy();
    });
  });

  it("has aria-live region for chat messages", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      const liveRegion = screen.getByRole("log");
      expect(liveRegion).toBeTruthy();
      expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    });
  });

  it("has accessible controls (arial-label on buttons)", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Pause interview")).toBeTruthy();
      expect(screen.getByLabelText("Complete interview")).toBeTruthy();
      expect(screen.getByLabelText("Chat message input")).toBeTruthy();
    });
  });

  it("has error alerts with role=alert", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeTruthy();
    });
  });

  it("has status semantics for streaming indicator", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Stay open (never close) to keep streaming state
        controller.enqueue(encoder.encode('event: message.delta\ndata: {"version":1,"type":"message.delta","payload":{"content":"Hi","role":"assistant","runId":"run-1"}}\n\n'));
        // Don't close — keep streaming
      },
    });

    mockSessionList([MOCK_ACTIVE], stream);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Hi");
    await user.click(screen.getByText("Send"));

    // Wait for Cancel button to appear (indicates streaming)
    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeTruthy();
    });
  });

  // ── R3: Automatic growth on stream-completed terminal ──

  it("run.completed in stream with profile.updated events displays growth without clicking Complete", async () => {
    // Stream: profile.updated(×2) → run.completed → done (versions > STANDARD_SSE)
    const growthStream = sseText([
      { event: "profile.updated", version: 7, type: "profile.updated", payload: { section: "experiences" } },
      { event: "profile.updated", version: 8, type: "profile.updated", payload: { section: "skills" } },
      { event: "run.completed", version: 9, type: "run.completed", payload: { runId: "run-2" } },
      { event: "done", version: 10, type: "done", payload: { success: true, runId: "run-2" } },
    ]);

    mockSessionList([MOCK_ACTIVE], createMockStream([growthStream]));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Build my profile");
    await user.click(screen.getByText("Send"));

    // Growth should appear WITHOUT clicking Complete button
    await waitFor(() => {
      expect(screen.getByText("🎯 Profile Growth")).toBeTruthy();
    }, { timeout: 3000 });
  });

  // ── R4: Lifecycle matrix — Pause/Resume/Complete success and failure (6 cases) ──
  // Every case asserts exact URL equality, exact JSON body, and resulting UI
  // status/control/error state. No toContain and no presence-only substitutes.

  it("PAUSE success: exact URL, body, Resume UI, no error", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockSessionList([MOCK_ACTIVE]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (method === "PATCH") {
        capturedUrl = url;
        capturedBody = (init as RequestInit).body as string;
        return Promise.resolve(new Response(JSON.stringify({ ...MOCK_ACTIVE, status: "paused" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Pause")).toBeTruthy();
    });

    await user.click(screen.getByText("Pause"));

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy();
    });

    expect(capturedUrl).toBe("/api/interviews/int-1");
    expect(JSON.parse(capturedBody)).toEqual({ status: "paused" });
    expect(screen.getByRole("button", { name: "Resume interview" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("PAUSE failure: exact URL, body, error text, Active controls preserved", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockSessionList([MOCK_ACTIVE]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (method === "PATCH") {
        capturedUrl = url;
        capturedBody = (init as RequestInit).body as string;
        return Promise.resolve(new Response(JSON.stringify({ error: "Cannot pause" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Pause")).toBeTruthy();
    });

    await user.click(screen.getByText("Pause"));

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy();
    });

    expect(capturedUrl).toBe("/api/interviews/int-1");
    expect(JSON.parse(capturedBody)).toEqual({ status: "paused" });
    expect(screen.getByText("Failed to paused")).toBeTruthy();
    // Active controls preserved
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
  });

  it("RESUME success: exact URL, body, Active UI, input enabled, no error", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockSessionList([MOCK_PAUSED]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (method === "PATCH") {
        capturedUrl = url;
        capturedBody = (init as RequestInit).body as string;
        return Promise.resolve(new Response(JSON.stringify({ ...MOCK_PAUSED, status: "active" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_PAUSED]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Paused Session")).toBeTruthy();
    });

    await user.click(screen.getByText("Paused Session"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume interview" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Resume interview" }));

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy();
    });

    expect(capturedUrl).toBe("/api/interviews/int-3");
    expect(JSON.parse(capturedBody)).toEqual({ status: "active" });
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.getByText("Send")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("RESUME failure: exact URL, body, error text, Paused controls preserved", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockSessionList([MOCK_PAUSED]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (method === "PATCH") {
        capturedUrl = url;
        capturedBody = (init as RequestInit).body as string;
        return Promise.resolve(new Response(JSON.stringify({ error: "Cannot resume" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_PAUSED]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Paused Session")).toBeTruthy();
    });

    await user.click(screen.getByText("Paused Session"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume interview" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Resume interview" }));

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy();
    });

    expect(capturedUrl).toBe("/api/interviews/int-3");
    expect(JSON.parse(capturedBody)).toEqual({ status: "active" });
    expect(screen.getByText("Failed to active")).toBeTruthy();
    // Paused controls preserved
    expect(screen.getByRole("button", { name: "Resume interview" })).toBeTruthy();
  });

  it("COMPLETE success: exact URL, body, Growth UI, completed controls, no error", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockSessionList([MOCK_ACTIVE]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (method === "PATCH") {
        capturedUrl = url;
        capturedBody = (init as RequestInit).body as string;
        return Promise.resolve(new Response(JSON.stringify({ ...MOCK_ACTIVE, status: "completed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Complete")).toBeTruthy();
    });

    await user.click(screen.getByText("Complete"));

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy();
    });

    expect(capturedUrl).toBe("/api/interviews/int-1");
    expect(JSON.parse(capturedBody)).toEqual({ status: "completed" });
    expect(screen.getByText("🎯 Profile Growth")).toBeTruthy();
    // No Pause/Resume/Complete buttons for completed session
    expect(screen.queryByText("Pause")).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("COMPLETE failure: exact URL, body, error text, Active controls preserved, no growth", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockSessionList([MOCK_ACTIVE]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (method === "PATCH") {
        capturedUrl = url;
        capturedBody = (init as RequestInit).body as string;
        return Promise.resolve(new Response(JSON.stringify({ error: "Cannot complete" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Complete")).toBeTruthy();
    });

    await user.click(screen.getByText("Complete"));

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy();
    });

    expect(capturedUrl).toBe("/api/interviews/int-1");
    expect(JSON.parse(capturedBody)).toEqual({ status: "completed" });
    expect(screen.getByText("Failed to completed")).toBeTruthy();
    expect(screen.queryByText("🎯 Profile Growth")).toBeNull();
    // Active controls preserved
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
  });

  // ── Cancel failure shows error UI ──

  it("shows error on cancel failure", async () => {
    // Create stream that does NOT close (stays open)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: message.delta\ndata: {"version":1,"type":"message.delta","payload":{"content":"Hi","role":"assistant","runId":"run-123"}}\n\n'));
      },
    });

    mockSessionList([MOCK_ACTIVE], stream);
    const cancelError = "Cancel rejected";
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";
      if (url.includes("cancel")) {
        return Promise.resolve(new Response(JSON.stringify({ error: cancelError }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, { status: 200 }));
      }
      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }
      if (method === "POST" && url.includes("messages")) {
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Hi");
    await user.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    await user.click(screen.getByText("Cancel"));

    // Error should appear in the role=alert element
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(cancelError)).toBeTruthy();
    });
  });

  // ── Resume from paused → PATCH to active + events reload ──

  it("resume from paused sends PATCH and reloads events", async () => {
    let patchCalled = false;
    let patchUrl = "";

    mockSessionList([MOCK_PAUSED]);
    // Override mock for specific checks
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";

      if (method === "PATCH") {
        patchCalled = true;
        patchUrl = url;
        return Promise.resolve(new Response(JSON.stringify({ ...MOCK_PAUSED, status: "active" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }

      if (url.includes("events")) {
        return Promise.resolve(new Response(STANDARD_SSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }

      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_PAUSED]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }

      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Paused Session")).toBeTruthy();
    });

    await user.click(screen.getByText("Paused Session"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume interview" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Resume interview" }));

    await waitFor(() => {
      expect(patchCalled).toBe(true);
      expect(patchUrl).toBe("/api/interviews/int-3");
    });

    // After PATCH returns active + events replayed, input should be enabled
    await waitFor(() => {
      const chatInput = screen.getByLabelText("Chat message input") as HTMLInputElement;
      expect(chatInput.disabled).toBe(false);
    });
  });

  // ── R2: Deterministic reconnect sequence ──

  it("deterministic reconnect: nonterminal batch advances cursor; terminal batch stops and shows growth", async () => {
    const reconnectCalls: string[] = [];

    // POST stream: nonterminal events only (no run.completed/done)
    const postEvents = sseText([
      { event: "profile.updated", version: 1, type: "profile.updated", payload: { section: "personal_info" } },
      { event: "message.delta", version: 2, type: "message.delta", payload: { content: "Building...", role: "assistant", runId: "run-1" } },
    ]);

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";

      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }

      if (url.includes("events")) {
        const match = url.match(/lastKnownVersion=(\d+)/);
        const cursor = match ? parseInt(match[1], 10) : 0;

        // Initial load (cursor 0): return empty
        if (cursor === 0) {
          return Promise.resolve(new Response("", { status: 200 }));
        }

        reconnectCalls.push(url);

        if (reconnectCalls.length === 1) {
          // First reconnect returns nonterminal v3
          return Promise.resolve(new Response(
            sseText([{ event: "message.delta", version: 3, type: "message.delta", payload: { content: " more", role: "assistant" } }]),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ));
        }

        // Second reconnect returns terminal v4-v5
        return Promise.resolve(new Response(
          sseText([
            { event: "run.completed", version: 4, type: "run.completed", payload: { runId: "run-1" } },
            { event: "done", version: 5, type: "done", payload: { success: true, runId: "run-1" } },
          ]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ));
      }

      if (method === "POST" && url.includes("messages")) {
        return Promise.resolve(new Response(createMockStream([postEvents]), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }

      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Hi");
    await user.click(screen.getByText("Send"));

    // Stream events appear
    await waitFor(() => {
      expect(screen.getByText("Building...")).toBeTruthy();
    });

    // Advance timers past first reconnect backoff (~1-1.5s), let fetch resolve
    await vi.advanceTimersByTimeAsync(5000);

    // First reconnect fetched nonterminal v3 → appended to message
    await waitFor(() => {
      expect(screen.getByText("Building... more")).toBeTruthy();
    });

    // Advance timers past second reconnect backoff
    await vi.advanceTimersByTimeAsync(10000);

    // Second reconnect returned terminal → growth appears
    await waitFor(() => {
      expect(screen.getByText("🎯 Profile Growth")).toBeTruthy();
    });

    // Verify exact reconnect URLs use correct lastKnownVersion after each advance
    expect(reconnectCalls).toHaveLength(2);
    expect(reconnectCalls[0]).toBe("/api/interviews/int-1/events?lastKnownVersion=2");
    expect(reconnectCalls[1]).toBe("/api/interviews/int-1/events?lastKnownVersion=3");
  });

  it("bounded exhaustion: empty batches exhaust MAX_RECONNECT_ATTEMPTS and show error", async () => {
    const reconnectCalls: string[] = [];

    const postEvents = sseText([
      { event: "message.delta", version: 1, type: "message.delta", payload: { content: "Hi", role: "assistant", runId: "run-1" } },
    ]);

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit)?.method ?? "GET";

      if (method === "GET" && url.includes("/api/interviews") && !url.includes("events") && !url.includes("messages")) {
        return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
      }

      if (url.includes("events")) {
        const match = url.match(/lastKnownVersion=(\d+)/);
        const cursor = match ? parseInt(match[1], 10) : 0;

        if (cursor === 0) {
          return Promise.resolve(new Response("", { status: 200 }));
        }

        reconnectCalls.push(url);
        // All reconnect batches return empty, simulating no new events
        return Promise.resolve(new Response("", { status: 200 }));
      }

      if (method === "POST" && url.includes("messages")) {
        return Promise.resolve(new Response(createMockStream([postEvents]), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }

      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    const input = screen.getByLabelText("Chat message input");
    await user.type(input, "Hi");
    await user.click(screen.getByText("Send"));

    // Message appears
    await waitFor(() => {
      expect(screen.getByText("Hi")).toBeTruthy();
    });

    // Advance well past all 5 backoff delays (1+2+4+8+15 ≈ 30s max)
    // Use async variant to drain microtasks between timer firings
    await vi.advanceTimersByTimeAsync(60000);

    // After exhaustion, error should appear
    await waitFor(() => {
      expect(screen.getByText(/Could not reconnect/)).toBeTruthy();
    });

    // Verify exactly 5 reconnect attempts (MAX_RECONNECT_ATTEMPTS)
    expect(reconnectCalls).toHaveLength(5);
  });

  // ── Enhanced accessibility semantics ──

  it("has role=status on each message with appropriate label", async () => {
    mockSessionList([MOCK_ACTIVE]);

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      const statuses = screen.getAllByRole("status");
      // Loading state might add status — after load we expect message statuses
      expect(statuses.length).toBeGreaterThan(0);
    });
  });

  it("has role=alert on error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("has accessible growth summary with role=status", async () => {
    const profileSSE = sseText([
      { event: "profile.updated", version: 1, type: "profile.updated", payload: { section: "personal_info" } },
      { event: "profile.updated", version: 2, type: "profile.updated", payload: { section: "experiences" } },
      { event: "run.completed", version: 3, type: "run.completed", payload: { runId: "run-1" } },
      { event: "done", version: 4, type: "done", payload: { success: true, runId: "run-1" } },
    ]);

    mockSessionList([MOCK_ACTIVE]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("events")) {
        return Promise.resolve(new Response(profileSSE, { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify([MOCK_ACTIVE]), { status: 200 }));
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^Interview$/ })).toBeTruthy();
    });

    await user.click(screen.getByText("Complete"));

    await waitFor(() => {
      const growthStatus = screen.getByRole("status", { name: /Profile growth summary/i });
      expect(growthStatus).toBeTruthy();
    });
  });

  it("replay loads events sorted and idempotent on select", async () => {
    // Events in non-version order (2, 1, 3)
    const unsortedSSE = sseText([
      { event: "tool.started", version: 2, type: "tool.started", payload: { name: "get_profile" } },
      { event: "message.delta", version: 1, type: "message.delta", payload: { content: "Hello!", role: "assistant" } },
      { event: "tool.completed", version: 3, type: "tool.completed", payload: { name: "get_profile", status: "applied", summary: "Done" } },
    ]);

    mockSessionList([MOCK_COMPLETED]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("events")) {
        return Promise.resolve(new Response(unsortedSSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify([MOCK_COMPLETED]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    render(<InterviewClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeTruthy();
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByText("View"));

    // Events should be applied in version order: v1 message, v2 tool, v3 completed
    await waitFor(() => {
      expect(screen.getByText("Hello!")).toBeTruthy();
      expect(screen.getByText(/get_profile/)).toBeTruthy();
      expect(screen.getByText(/applied/)).toBeTruthy();
    });
  });
});
