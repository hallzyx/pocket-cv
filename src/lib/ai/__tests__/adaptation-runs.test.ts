import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { aiRuns, jobOffers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createExtractionAttempt, completeExtractionAttempt, failExtractionAttempt } from "@/lib/ai/runs";

const TU = "test-adapt-runs";
async function seed(id: string) { await db.insert(jobOffers).values({ id, userId: TU, rawText: "test" }); }

describe("M3 adaptation helpers", () => {
  beforeAll(async () => { await db.delete(aiRuns).where(eq(aiRuns.userId, TU)); await db.delete(jobOffers).where(eq(jobOffers.userId, TU)); });
  beforeEach(async () => { await db.delete(aiRuns).where(eq(aiRuns.userId, TU)); await db.delete(jobOffers).where(eq(jobOffers.userId, TU)); });

  it("creates running row with correct defaults", async () => {
    const oid = createId(); await seed(oid);
    const { id } = await createExtractionAttempt({ jobOfferId: oid, userId: TU, model: "m", attempt: 1, task: "extraction" });
    const [r] = await db.select().from(aiRuns).where(eq(aiRuns.id, id)).limit(1);
    expect(r.status).toBe("running"); expect(r.jobOfferId).toBe(oid); expect(r.attempt).toBe(1); expect(r.model).toBe("m");
  });

  it("completes row with tokens", async () => {
    const oid = createId(); await seed(oid);
    const { id } = await createExtractionAttempt({ jobOfferId: oid, userId: TU, model: "m", attempt: 1, task: "extraction" });
    await completeExtractionAttempt({ attemptId: id, tokensIn: 150, tokensOut: 75, providerResponseId: "r1" });
    const [r] = await db.select().from(aiRuns).where(eq(aiRuns.id, id)).limit(1);
    expect(r.status).toBe("completed"); expect(r.tokensIn).toBe(150); expect(r.tokensOut).toBe(75); expect(r.providerResponseId).toBe("r1");
  });

  it("fails row with error", async () => {
    const oid = createId(); await seed(oid);
    const { id } = await createExtractionAttempt({ jobOfferId: oid, userId: TU, model: "m", attempt: 1, task: "extraction" });
    await failExtractionAttempt({ attemptId: id, error: "boom", tokensIn: 10, tokensOut: 0 });
    const [r] = await db.select().from(aiRuns).where(eq(aiRuns.id, id)).limit(1);
    expect(r.status).toBe("failed"); expect(r.error).toBe("boom");
  });

  it("fails row with providerResponseId", async () => {
    const oid = createId(); await seed(oid);
    const { id } = await createExtractionAttempt({ jobOfferId: oid, userId: TU, model: "m", attempt: 1, task: "extraction" });
    await failExtractionAttempt({ attemptId: id, error: "timeout", tokensIn: 30, tokensOut: 15, providerResponseId: "r-fail-1" });
    const [r] = await db.select().from(aiRuns).where(eq(aiRuns.id, id)).limit(1);
    expect(r.status).toBe("failed"); expect(r.error).toBe("timeout");
    expect(r.tokensIn).toBe(30); expect(r.tokensOut).toBe(15); expect(r.providerResponseId).toBe("r-fail-1");
  });

  it("first fail then complete — 2 ordered rows", async () => {
    const oid = createId(); await seed(oid);
    const a1 = await createExtractionAttempt({ jobOfferId: oid, userId: TU, model: "m", attempt: 1, task: "extraction" });
    const a2 = await createExtractionAttempt({ jobOfferId: oid, userId: TU, model: "m", attempt: 2, task: "extraction" });
    await failExtractionAttempt({ attemptId: a1.id, error: "timeout", tokensIn: 10, tokensOut: 0 });
    await completeExtractionAttempt({ attemptId: a2.id, tokensIn: 200, tokensOut: 100, providerResponseId: "r2" });
    const rows = await db.select().from(aiRuns).where(eq(aiRuns.jobOfferId, oid)).orderBy(aiRuns.attempt);
    expect(rows).toHaveLength(2); expect(rows[0].status).toBe("failed"); expect(rows[1].status).toBe("completed");
    expect(rows[1].tokensIn).toBe(200); expect(rows[1].providerResponseId).toBe("r2");
  });
});
