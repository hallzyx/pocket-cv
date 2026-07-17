import { and, desc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { jobOffers } from "@/lib/db/schema";
import { createProvider } from "@/lib/ai/provider";
import { extractJobOffer } from "./extraction";

export class OfferError extends Error {
  constructor(public status: 404 | 409 | 422, public body: Record<string, unknown>) { super(String(body.error)); }
}
const missing = () => new OfferError(404, { error: "offer-not-found" });

export async function createOffer(userId: string, rawText: unknown) {
  if (typeof rawText !== "string" || !rawText.trim() || Buffer.byteLength(rawText, "utf8") > 50_000) {
    throw new OfferError(422, { error: "invalid-raw-text" });
  }
  const id = createId();
  await db.insert(jobOffers).values({ id, userId, rawText });
  const [offer] = await db.select().from(jobOffers).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  return offer;
}

export function getOffers(userId: string) {
  return db.select().from(jobOffers).where(eq(jobOffers.userId, userId)).orderBy(desc(jobOffers.updatedAt));
}

export async function getOffer(id: string, userId: string) {
  const [offer] = await db.select().from(jobOffers).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  return offer ?? null;
}

export async function analyzeOffer(id: string, userId: string) {
  const offer = await getOffer(id, userId);
  if (!offer) throw missing();
  if (offer.status !== "draft") throw new OfferError(409, { error: "invalid-offer-state", status: offer.status });
  try {
    const result = await extractJobOffer(offer.rawText, createProvider(process.env.AI_PROVIDER || "deepseek"), userId, id);
    await db.update(jobOffers).set({ status: "analyzed", detectedCategory: result.result.category, extractedKeywords: result.result.keywords, confidence: String(result.result.confidence) }).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  } catch (error) {
    await db.update(jobOffers).set({ status: "failed" }).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
    throw new OfferError(422, { status: "failed", error: error instanceof Error ? error.message : "extraction-failed" });
  }
  return (await getOffer(id, userId))!;
}
