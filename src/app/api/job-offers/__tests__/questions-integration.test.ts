import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobOffers } from "@/lib/db/schema";
import { selectContent } from "@/lib/job-offers/selection";
import { GET as getQuestions, POST as createQuestions } from "../[id]/questions/route";
import { POST as answer } from "../[id]/questions/[questionId]/answer/route";
import { POST as skip } from "../[id]/questions/[questionId]/skip/route";
import { GET as getOverrides, POST as saveOverride, DELETE as deleteOverride } from "../[id]/overrides/route";

let currentUser: { id: string } | null = { id: "owner" };
vi.mock("@/lib/auth/session", () => ({ getUserOrNull: () => currentUser }));
const request = (body?: unknown) => new Request("http://test", body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const questionParams = (id: string, questionId: string) => ({ params: Promise.resolve({ id, questionId }) });

describe("job-offer questions route integration (MySQL)", () => {
  beforeEach(async () => { await db.delete(jobOffers); currentUser = { id: "owner" }; await db.insert(jobOffers).values({ id: "q1", userId: "owner", rawText: "offer" }); });

  it("creates and reads the exact public question DTO", async () => {
    const questions = [{ questionId: "critical-1", type: "critical", prompt: "Authorization?" }, { questionId: "optional-1", type: "optional", prompt: "Title?" }];
    expect((await createQuestions(request({ questions }), params("q1"))).status).toBe(201);
    expect(await (await getQuestions(request(), params("q1"))).json()).toEqual([{ ...questions[0], status: "pending" }, { ...questions[1], status: "pending" }]);
  });

  it("persists answers, returns exact critical skip 400, and resumes state", async () => {
    await createQuestions(request({ questions: [{ questionId: "c", type: "critical", prompt: "Auth?" }] }), params("q1"));
    const skipped = await skip(request(), questionParams("q1", "c"));
    expect(skipped.status).toBe(400); expect(await skipped.json()).toEqual({ error: "cannot-skip-critical", questionId: "c" });
    const answered = await answer(request({ answer: "yes" }), questionParams("q1", "c"));
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ questionId: "c", type: "critical", prompt: "Auth?", status: "answered", answer: "yes" });
    expect(await (await getQuestions(request(), params("q1"))).json()).toEqual([{ questionId: "c", type: "critical", prompt: "Auth?", status: "answered", answer: "yes" }]);
    const [row] = await db.select().from(jobOffers).where(eq(jobOffers.id, "q1")); expect(row.questionsJson?.[0].answer).toBe("yes");
  });

  it("scopes overrides and persists effective changes through the public selection flow", async () => {
    const override = { profileItemId: "p1", section: "projects", action: "include", reason: "needed" };
    expect(await (await saveOverride(request(override), params("q1"))).json()).toEqual([override]);
    expect(await (await getOverrides(request(), params("q1"))).json()).toEqual([override]);
    const reloaded = await (await getOverrides(request(), params("q1"))).json();
    const profile = { personalInfo: {}, experiences: [], education: [], skills: [], projects: [{ id: "p1", tags: ["unrelated"], name: "P1" }, { id: "p2", tags: ["engineering"], name: "P2" }], achievements: [] };
    const selected = selectContent(profile as never, { category: "engineering", keywords: [], confidence: 0.5 }, reloaded);
    expect(selected.projects.map((item) => item.id)).toEqual(["p2", "p1"]);
    currentUser = { id: "other" }; expect((await getOverrides(request(), params("q1"))).status).toBe(404);
    currentUser = { id: "owner" }; expect(await (await deleteOverride(request({ profileItemId: "p1", section: "projects" }), params("q1"))).json()).toEqual([]);
  });

  it("returns stable 400s for malformed input and 401 across every route family", async () => {
    expect(await (await createQuestions(request({ questions: [{ nope: true }] }), params("q1"))).json()).toEqual({ error: "invalid-questions" });
    expect(await (await answer(request({ answer: "" }), questionParams("q1", "c"))).json()).toEqual({ error: "invalid-answer" });
    expect(await (await saveOverride(request({ profileItemId: "p", section: "bad", action: "include", reason: "x" }), params("q1"))).json()).toEqual({ error: "invalid-override" });
    expect(await (await deleteOverride(request({ profileItemId: "", section: "projects" }), params("q1"))).json()).toEqual({ error: "invalid-override" });
    currentUser = null;
    for (const response of [await getQuestions(request(), params("q1")), await createQuestions(request({ questions: [] }), params("q1")), await answer(request({ answer: "x" }), questionParams("q1", "c")), await skip(request(), questionParams("q1", "c")), await getOverrides(request(), params("q1")), await saveOverride(request({}), params("q1")), await deleteOverride(request({}), params("q1"))]) expect(response.status).toBe(401);
  });

  it("returns the same exact 404 for missing and cross-user resources across every handler", async () => {
    await db.insert(jobOffers).values({ id: "q2", userId: "other", rawText: "offer" });
    const invokeAll = (id: string) => [
      getQuestions(request(), params(id)), createQuestions(request({ questions: [{ questionId: "q", type: "optional", prompt: "Q" }] }), params(id)),
      answer(request({ answer: "yes" }), questionParams(id, "q")), skip(request(), questionParams(id, "q")), getOverrides(request(), params(id)),
      saveOverride(request({ profileItemId: "p", section: "projects", action: "include", reason: "r" }), params(id)), deleteOverride(request({ profileItemId: "p", section: "projects" }), params(id)),
    ];
    for (const id of ["MISSING", "q2"]) for (const response of await Promise.all(invokeAll(id))) expect({ status: response.status, body: await response.json() }).toEqual({ status: 404, body: { error: "offer-not-found" } });
  });
});
