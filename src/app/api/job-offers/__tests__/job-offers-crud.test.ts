import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiRuns, jobOffers } from "@/lib/db/schema";
import { registerProvider } from "@/lib/ai/provider";
import { GET, POST } from "../route";
import { GET as getOne } from "../[id]/route";
import { POST as analyze } from "../[id]/analyze/route";

let currentUser: { id: string } | null = { id: "owner" };
vi.mock("@/lib/auth/session", () => ({ getUserOrNull: () => currentUser }));
const req = (body?: unknown) => new Request("http://test", body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const fake = (fail = false) => ({ model: "test", stream: async function* () {}, validateModel: async () => {}, completeStructured: vi.fn(async () => {
  if (fail) throw new Error("503 provider unavailable");
  return { data: { category: "engineering", keywords: ["typescript", "mysql"], confidence: 0.91 }, tokensIn: 3, tokensOut: 4, responseId: "r1" };
}) }) as any;
async function offer(userId: string, id: string) { await db.insert(jobOffers).values({ id, userId, rawText: "Senior engineer" }); return id; }

describe("job offers CRUD (migration 0002)", () => {
  beforeEach(async () => {
    await db.delete(aiRuns);
    await db.delete(jobOffers);
    currentUser = { id: "owner" };
    process.env.AI_PROVIDER = "test";
    registerProvider("test", () => fake());
  });

  it("creates a draft without calling AI and returns the public DTO", async () => {
    const provider = fake(); registerProvider("test", () => provider);
    const response = await POST(req({ rawText: "Build APIs" }));
    expect(response.status).toBe(201);
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["createdAt", "id", "status"]); expect(body.status).toBe("draft");
    expect(provider.completeStructured).not.toHaveBeenCalled();
  });

  it("lists only the owner’s two offers", async () => {
    await offer("owner", "o1"); await offer("owner", "o2"); await offer("other", "x1");
    expect((await (await GET()).json()).map((x: any) => x.id)).toEqual(expect.arrayContaining(["o1", "o2"]));
    currentUser = { id: "other" }; expect((await (await GET()).json()).map((x: any) => x.id)).toEqual(["x1"]);
  });

  it("returns identical 404s for missing and cross-user detail", async () => {
    await offer("other", "foreign");
    const missing = await getOne(req(), params("missing")); const cross = await getOne(req(), params("foreign"));
    expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: "offer-not-found" });
    expect(cross.status).toBe(404); expect(await cross.json()).toEqual({ error: "offer-not-found" });
  });

  it("analyzes a draft, audits extraction, and exposes the public fields", async () => {
    await offer("owner", "analyze-1");
    const response = await analyze(req(), params("analyze-1"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "analyzed", confidence: "0.910", category: "engineering", keywords: ["typescript", "mysql"] });
    const [saved] = await db.select().from(jobOffers).where(eq(jobOffers.id, "analyze-1"));
    const runs = await db.select().from(aiRuns).where(eq(aiRuns.jobOfferId, "analyze-1"));
    expect(saved.status).toBe("analyzed"); expect(saved.detectedCategory).toBe("engineering"); expect(saved.extractedKeywords).toEqual(["typescript", "mysql"]); expect(runs).toHaveLength(1); expect(runs[0].status).toBe("completed");
  });

  it("returns the same 404 for cross-user analyze, 409 when already analyzed, and 422 after retry failure", async () => {
    await offer("other", "foreign");
    const cross = await analyze(req(), params("foreign"));
    expect(cross.status).toBe(404); expect(await cross.json()).toEqual({ error: "offer-not-found" });
    await offer("owner", "done"); await db.update(jobOffers).set({ status: "analyzed" }).where(eq(jobOffers.id, "done"));
    const analyzed = await analyze(req(), params("done"));
    expect(analyzed.status).toBe(409); expect(await analyzed.json()).toEqual({ error: "invalid-offer-state", status: "analyzed" });
    await offer("owner", "failed"); registerProvider("test", () => fake(true));
    const failure = await analyze(req(), params("failed"));
    expect(failure.status).toBe(422); expect(await failure.json()).toEqual({ error: "Extraction failed after retry: 503 provider unavailable", status: "failed" });
    const [saved] = await db.select().from(jobOffers).where(eq(jobOffers.id, "failed")); const runs = await db.select().from(aiRuns).where(eq(aiRuns.jobOfferId, "failed"));
    expect(saved.status).toBe("failed"); expect(runs).toHaveLength(2); expect(runs.every((r) => r.status === "failed")).toBe(true);
  });

  it("rejects unauthenticated requests for every job-offer route family", async () => {
    currentUser = null;
    for (const response of [
      await GET(),
      await POST(req({ rawText: "Build APIs" })),
      await getOne(req(), params("missing")),
      await analyze(req(), params("missing")),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });
});
