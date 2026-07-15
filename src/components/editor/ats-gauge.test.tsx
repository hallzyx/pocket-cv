import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AtsGauge } from "./ats-gauge";
import type { AtsResult } from "@/lib/ats";

const sampleResult: AtsResult = {
  score: 72,
  suggestions: ["Add quantified achievements", "Use more action verbs"],
  breakdown: {
    completeness: 30,
    impact: 20,
    format: 15,
    keywords: 7,
  },
};

describe("AtsGauge", () => {
  it("renders loading skeleton when loading is true", () => {
    const { container } = render(<AtsGauge result={null} loading />);
    const pulseDiv = container.querySelector(".animate-pulse");
    expect(pulseDiv).toBeTruthy();
  });

  it("shows empty state when result is null and not loading", () => {
    render(<AtsGauge result={null} loading={false} />);
    expect(
      screen.getByText("Save your CV to see the ATS score."),
    ).toBeTruthy();
  });

  it("renders the score and breakdown when result is provided", () => {
    render(<AtsGauge result={sampleResult} loading={false} />);

    // Title
    expect(screen.getByText("ATS Score")).toBeTruthy();

    // Score number
    expect(screen.getByText("72")).toBeTruthy();

    // "out of 100"
    expect(screen.getByText("out of 100")).toBeTruthy();

    // Breakdown labels
    expect(screen.getByText("Completeness")).toBeTruthy();
    expect(screen.getByText("Impact")).toBeTruthy();
    expect(screen.getByText("Format")).toBeTruthy();
    expect(screen.getByText("Keywords")).toBeTruthy();
  });

  it("renders suggestions when present", () => {
    render(<AtsGauge result={sampleResult} loading={false} />);

    expect(screen.getByText("Suggestions")).toBeTruthy();
    expect(screen.getByText("Add quantified achievements")).toBeTruthy();
    expect(screen.getByText("Use more action verbs")).toBeTruthy();
  });

  it("shows correct score boundaries colors", () => {
    // Low score (< 50)
    const lowResult: AtsResult = {
      ...sampleResult,
      score: 35,
      breakdown: { ...sampleResult.breakdown },
    };
    const { container: lowContainer } = render(
      <AtsGauge result={lowResult} loading={false} />,
    );
    expect(lowContainer.querySelector(".stroke-red-500")).toBeTruthy();

    // Medium score (50-74)
    const medResult: AtsResult = {
      ...sampleResult,
      score: 65,
      breakdown: { ...sampleResult.breakdown },
    };
    const { container: medContainer } = render(
      <AtsGauge result={medResult} loading={false} />,
    );
    expect(medContainer.querySelector(".stroke-amber-500")).toBeTruthy();

    // High score (75+)
    const highResult: AtsResult = {
      ...sampleResult,
      score: 88,
      breakdown: { ...sampleResult.breakdown },
    };
    const { container: highContainer } = render(
      <AtsGauge result={highResult} loading={false} />,
    );
    expect(highContainer.querySelector(".stroke-emerald-500")).toBeTruthy();
  });

  it("does not render suggestions section when suggestions array is empty", () => {
    const noSuggestions: AtsResult = {
      ...sampleResult,
      suggestions: [],
    };
    render(<AtsGauge result={noSuggestions} loading={false} />);

    expect(screen.queryByText("Suggestions")).toBeNull();
  });
});
