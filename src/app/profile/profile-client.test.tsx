import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Hoisted mocks (must be before imports) ──

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/profile",
}));

// ── Real imports after mocks ──

import { ProfileClient } from "./profile-client";

const TEST_USER = { id: "user-1", email: "test@test.com", name: "Test User" };

const MOCK_PROFILE = {
  id: "prof-1",
  personalInfo: {
    fullName: "Jane Doe",
    headline: "Senior Engineer",
    email: "jane@example.com",
    phone: "+1-555-1234",
  },
  experiences: [
    {
      id: "exp-1",
      company: "Acme Corp",
      title: "Engineer",
      startDate: "2020-01",
      bullets: ["Built stuff"],
    },
  ],
  education: [],
  skills: [{ id: "sk-1", category: "Languages", items: ["TypeScript"] }],
  projects: [],
  achievements: [],
  preferences: null,
};

describe("ProfileClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    // Never resolve fetch
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );

    render(<ProfileClient user={TEST_USER} />);

    // Loading skeleton should appear
    const { container } = render(<ProfileClient user={TEST_USER} />);
    const pulseDivs = container.querySelectorAll(".animate-pulse");
    expect(pulseDivs.length).toBeGreaterThan(0);
  });

  it("shows empty state when profile returns 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404 }),
    );

    render(<ProfileClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("No profile yet")).toBeTruthy();
    });

    // Create profile button
    expect(screen.getByText("Create Profile")).toBeTruthy();
    expect(
      screen.getByText(/Create your professional profile/),
    ).toBeTruthy();
  });

  it("creates a profile when clicking the Create Profile button", async () => {
    const user = userEvent.setup();

    // First fetch returns 404 (no profile yet)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404 }),
    );

    // Create PATCH returns the new profile
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_PROFILE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ProfileClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("No profile yet")).toBeTruthy();
    });

    await user.click(screen.getByText("Create Profile"));

    // After creation, should show profile sections
    await waitFor(() => {
      expect(screen.getByText("Professional Profile")).toBeTruthy();
    });

    // Personal info should be visible
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Senior Engineer")).toBeTruthy();
  });

  it("renders profile sections when profile exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_PROFILE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ProfileClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Professional Profile")).toBeTruthy();
    });

    // Should show section headings with item counts
    expect(screen.getByText("Personal Info")).toBeTruthy();
    expect(screen.getByText("Experience (1)")).toBeTruthy();
    expect(screen.getByText("Skills (1)")).toBeTruthy();
    expect(screen.getByText("Education (0)")).toBeTruthy();
  });

  it("edits a personal info field through PATCH", async () => {
    const user = userEvent.setup();

    // Initial profile load
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_PROFILE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // PATCH response
    const updatedProfile = {
      ...MOCK_PROFILE,
      personalInfo: { ...MOCK_PROFILE.personalInfo, fullName: "Jane Updated" },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(updatedProfile), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ProfileClient user={TEST_USER} />);

    await waitFor(() => {
      expect(screen.getByText("Professional Profile")).toBeTruthy();
    });

    // Click on "Jane Doe" to enter edit mode
    await user.click(screen.getByText("Jane Doe"));

    // Change the name
    const input = screen.getByDisplayValue("Jane Doe");
    await user.clear(input);
    await user.type(input, "Jane Updated");

    // Click Save
    await user.click(screen.getByText("Save"));

    // Should show updated name
    await waitFor(() => {
      expect(screen.getByText("Jane Updated")).toBeTruthy();
    });
  });
});
