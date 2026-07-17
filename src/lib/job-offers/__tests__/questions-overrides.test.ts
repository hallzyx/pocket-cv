import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobOffers } from "@/lib/db/schema";
import { answerOfferQuestion, createOfferQuestions, getOfferQuestionState, saveOfferOverride, skipOfferQuestion } from "../service";
import { selectContent } from "../selection";

const questions = [
  { questionId: "critical-1", type: "critical" as const, prompt: "What is your work authorization?", status: "pending" as const },
  { questionId: "optional-1", type: "optional" as const, prompt: "Preferred title?", status: "pending" as const },
];

describe("M3 question and override state (MySQL)", () => {
  beforeEach(async () => { await db.delete(jobOffers); await db.insert(jobOffers).values({ id: "state-offer", userId: "state-user", rawText: "offer" }); });

  it("persists questions and resumes exact state", async () => {
    await createOfferQuestions("state-offer", "state-user", questions);
    await answerOfferQuestion("state-offer", "state-user", "critical-1", "Authorized");
    const state = await getOfferQuestionState("state-offer", "state-user");
    expect(state.questions.find((q) => q.questionId === "critical-1")).toMatchObject({ status: "answered", answer: "Authorized" });
    const [row] = await db.select().from(jobOffers).where(eq(jobOffers.id, "state-offer"));
    expect(row.questionsJson).toEqual(state.questions); expect(state.areCriticalAnswered).toBe(true);
  });

  it("rejects critical skip but permits optional skip", async () => {
    await createOfferQuestions("state-offer", "state-user", questions);
    const [before] = await db.select().from(jobOffers).where(eq(jobOffers.id, "state-offer"));
    await expect(skipOfferQuestion("state-offer", "state-user", "critical-1")).rejects.toMatchObject({ status: 400, body: { error: "cannot-skip-critical", questionId: "critical-1" } });
    const [after] = await db.select().from(jobOffers).where(eq(jobOffers.id, "state-offer"));
    expect(after.questionsJson).toEqual(before.questionsJson);
    expect((after.questionsJson as typeof questions).find((q) => q.questionId === "critical-1")?.status).toBe("pending");
    const state = await skipOfferQuestion("state-offer", "state-user", "optional-1");
    expect(state.questions.find((q) => q.questionId === "optional-1")?.status).toBe("skipped");
    expect(state.areCriticalAnswered).toBe(false);
  });

  it("reloads persisted include and exclude overrides for deterministic source-ID selection", async () => {
    await saveOfferOverride("state-offer", "state-user", { profileItemId: "p1", section: "projects", action: "include", reason: "explicit" });
    await saveOfferOverride("state-offer", "state-user", { profileItemId: "p2", section: "projects", action: "exclude", reason: "explicit" });
    const reloaded = await getOfferQuestionState("state-offer", "state-user");
    const profile = { projects: [{ id: "p1", tags: [], name: "Included" }, { id: "p2", tags: ["engineering"], name: "Excluded" }, { id: "p3", tags: ["engineering"], name: "Matched" }] };
    const result = selectContent(profile as never, { category: "engineering", keywords: [], confidence: 0.9 }, reloaded.overrides);
    expect(reloaded.overrides.map((override) => override.profileItemId)).toEqual(["p1", "p2"]);
    expect(result.projects.map((project) => project.id)).toEqual(["p3", "p1"]);
    expect(result.projects.some((project) => project.id === "p2")).toBe(false);
    expect(result.projects.some((project) => project.id === "fabricated")).toBe(false);
  });

  it("keeps critical completion false until every critical question is answered", async () => {
    await createOfferQuestions("state-offer", "state-user", [
      ...questions,
      { questionId: "critical-2", type: "critical" as const, prompt: "Eligible to work?", status: "pending" as const },
    ]);
    expect((await getOfferQuestionState("state-offer", "state-user")).areCriticalAnswered).toBe(false);
    await answerOfferQuestion("state-offer", "state-user", "critical-1", "Authorized");
    expect((await getOfferQuestionState("state-offer", "state-user")).areCriticalAnswered).toBe(false);
    await answerOfferQuestion("state-offer", "state-user", "critical-2", "Yes");
    expect((await getOfferQuestionState("state-offer", "state-user")).areCriticalAnswered).toBe(true);
  });
});
