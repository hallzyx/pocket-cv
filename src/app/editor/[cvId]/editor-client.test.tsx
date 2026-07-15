import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Hoisted mocks (must be before imports) ──

vi.mock("next/navigation", () => ({
  useParams: () => ({ cvId: "test-cv-123" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// ── Real imports after mocks ──

import { EditorClient } from "./editor-client";

const MOCK_CV = {
  id: "test-cv-123",
  title: "My Test CV",
  contentJson: {
    personalInfo: { fullName: "Test User", headline: "Engineer", email: "test@test.com" },
    summary: "A test summary",
    experiences: [],
    education: [],
    skills: [],
    projects: [],
    achievements: [],
  },
  texSource: "\\documentclass{article}",
  atsScore: null,
};

describe("EditorClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    // Never resolve the fetch
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );

    const { container } = render(
      <EditorClient userId="user-1" email="test@test.com" name="Test" />,
    );

    // Loading state has pulse divs
    const pulseDivs = container.querySelectorAll(".animate-pulse");
    expect(pulseDivs.length).toBeGreaterThan(0);
  });

  it("renders the editor when CV loads successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CV), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<EditorClient userId="user-1" email="test@test.com" name="Test" />);

    // Wait for the CV to load
    await waitFor(() => {
      expect(screen.getByText("My Test CV")).toBeTruthy();
    });

    // Header elements
    expect(screen.getByText("← Dashboard")).toBeTruthy();
    expect(screen.getByText("Download PDF")).toBeTruthy();

    // Download PDF link should point to the expected route
    const downloadLink = screen.getByText("Download PDF").closest("a");
    expect(downloadLink?.getAttribute("href")).toBe("/api/pdf/test-cv-123");
    expect(downloadLink?.getAttribute("download")).not.toBeNull();

    // Right panel should have "LaTeX Preview"
    expect(screen.getByText("LaTeX Preview")).toBeTruthy();

    // Tab bar should show (Personal Info appears both as a tab button and section heading)
    const personalInfoElements = screen.getAllByText("Personal Info");
    expect(personalInfoElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Experience")).toBeTruthy();
    expect(screen.getByText("Education")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
  });

  it("shows error state when CV fetch returns 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404 }),
    );

    render(<EditorClient userId="user-1" email="test@test.com" name="Test" />);

    await waitFor(() => {
      expect(screen.getByText("CV not found")).toBeTruthy();
    });

    // Should have a link back to dashboard
    const backLink = screen.getByText("Back to Dashboard");
    expect(backLink).toBeTruthy();
    expect(backLink.getAttribute("href")).toBe("/dashboard");
  });

  it("shows error state when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    render(<EditorClient userId="user-1" email="test@test.com" name="Test" />);

    await waitFor(() => {
      expect(screen.getByText("Error loading CV")).toBeTruthy();
    });

    // The error message should be visible
    expect(screen.getByText("Network error")).toBeTruthy();
  });

  it("triggers PATCH autosave after editing content (debounced) [no act warning]", async () => {
    const user = userEvent.setup();

    // Set up fetch mock for initial CV load
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CV), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Mock PATCH response
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...MOCK_CV,
          contentJson: {
            ...MOCK_CV.contentJson,
            summary: "Updated summary text",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<EditorClient userId="user-1" email="test@test.com" name="Test" />);

    // Wait for the editor to load
    await waitFor(() => {
      expect(screen.getByText("My Test CV")).toBeTruthy();
    });

    // Click the Summary tab
    await user.click(screen.getByText("Summary"));

    // Edit the summary
    const textarea = screen.getByPlaceholderText(
      "Experienced software engineer with a passion for...",
    );
    await user.clear(textarea);
    await user.type(textarea, "Updated summary text");

    // Wrap the debounce wait in act() so React tracks component timer
    // callbacks as part of the test action — this eliminates the
    // "not wrapped in act(...)" warning that raw setTimeout produces.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2500));
    });

    // Verify fetch was called for PATCH
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    const patchCall = fetchCalls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/api/cvs/test-cv-123") &&
        opts &&
        typeof opts === "object" &&
        (opts as RequestInit).method === "PATCH",
    );

    expect(patchCall).toBeTruthy();
  }, 10_000);

  it("editing summary updates LaTeX preview and ATS score via composed runtime", async () => {
    const user = userEvent.setup();

    // Mock initial CV load
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CV), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<EditorClient userId="user-1" email="test@test.com" name="Test" />);

    // Wait for the editor to load
    await waitFor(() => {
      expect(screen.getByText("My Test CV")).toBeTruthy();
    });

    // LaTeX Preview header is visible initially
    expect(screen.getByText("LaTeX Preview")).toBeTruthy();

    // ATS shows empty state before any edit
    expect(screen.getByText("Save your CV to see the ATS score.")).toBeTruthy();

    // Click the Summary tab to access the text editor
    await user.click(screen.getByText("Summary"));

    // Edit the summary — this triggers a local state update immediately
    // via scheduleSave which calls generateHarvardCv + evaluateAts
    const textarea = screen.getByPlaceholderText(
      "Experienced software engineer with a passion for...",
    );
    await user.clear(textarea);
    await user.type(textarea, "A much more professional summary");

    // Advance past SummaryEditor's 800ms debounce so that
    // updateSummary → scheduleSave is called. scheduleSave calls
    // setTexSource and setAtsResult synchronously (no debounce
    // for local state).
    // Wrap in act() so React tracks timer callbacks without warnings.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 850));
    });

    // ── Assert LaTeX preview updated ──
    // The generated LaTeX via generateHarvardCv should contain
    // the escaped version of the edited summary text inside
    // \section*{Summary}. The text appears in both the <textarea>
    // (controlled value) and a <span> in the LaTeX preview.
    const summaryElements = screen.getAllByText(/A much more professional summary/);
    expect(summaryElements.length).toBeGreaterThanOrEqual(2);

    // ── Assert ATS gauge updated ──
    // Before the edit there was no atsResult. After scheduleSave runs,
    // evaluateAts returns a result showing the new summary.
    // "ATS Score" appears as both the mobile toggle button and the h3 heading.
    const atsScoreElements = screen.getAllByText("ATS Score");
    expect(atsScoreElements.length).toBeGreaterThanOrEqual(1);

    // Completeness breakdown is visible (summary adds 5 pts)
    expect(screen.getByText("Completeness")).toBeTruthy();

    // Suggestions list appears (there are missing sections)
    expect(screen.getByText("Suggestions")).toBeTruthy();
  }, 10_000);
});
