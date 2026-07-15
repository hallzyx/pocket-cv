import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPreview } from "./editor-preview";

describe("EditorPreview", () => {
  it("renders loading skeleton when loading is true", () => {
    const { container } = render(<EditorPreview texSource="" loading />);
    // The loading state renders a pulse-animated div
    const pulseDivs = container.querySelectorAll(".animate-pulse");
    expect(pulseDivs.length).toBeGreaterThan(0);
  });

  it("renders LaTeX source with line numbers", () => {
    const tex = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";
    render(<EditorPreview texSource={tex} />);

    // Should show the "LaTeX Preview" header
    expect(screen.getByText("LaTeX Preview")).toBeTruthy();

    // Should show line numbers (1, 2, 3, 4)
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();

    // Should render the Copy button
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("copies LaTeX source to clipboard on button click", async () => {
    const user = userEvent.setup();
    const tex = "\\documentclass{article}\n\\begin{document}Hello\\end{document}";

    // Mock clipboard API via vi.stubGlobal (jsdom's navigator is read-only)
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });

    render(<EditorPreview texSource={tex} />);

    await user.click(screen.getByText("Copy"));
    expect(writeText).toHaveBeenCalledWith(tex);

    // Button should show "Copied!" after click
    expect(screen.getByText("Copied!")).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("handles clipboard API failure gracefully (fallback execCommand path)", async () => {
    const user = userEvent.setup();
    const tex = "\\documentclass{article}";

    // Mock clipboard API to throw so the component falls back
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<EditorPreview texSource={tex} />);

    await user.click(screen.getByText("Copy"));

    // The fallback execCommand polyfill succeeds, so "Copied!" appears
    expect(screen.getByText("Copied!")).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("highlights LaTeX commands in blue", () => {
    const tex = "\\textbf{bold} and \\textit{italic}";
    const { container } = render(<EditorPreview texSource={tex} />);

    // Commands should have blue-600 class (Tailwind adds text-blue-600 for light mode)
    const blueSpans = container.querySelectorAll(".text-blue-600");
    expect(blueSpans.length).toBeGreaterThan(0);
  });
});
