import { and, desc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { jobOffers, type OfferQuestion, type OfferOverride } from "@/lib/db/schema";
import { createProvider } from "@/lib/ai/provider";
import { extractJobOffer } from "./extraction";

export class OfferError extends Error {
  constructor(public status: 400 | 404 | 409 | 422, public body: Record<string, unknown>) { super(String(body.error)); }
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

const state = (offer: typeof jobOffers.$inferSelect) => {
  const questions = (offer.questionsJson ?? []) as OfferQuestion[];
  const critical = questions.filter((q) => q.type === "critical");
  const areCriticalAnswered = critical.every((q) => q.status === "answered");
  return { questions: questions.map(({ answer, ...question }) => question.status === "answered" ? { ...question, answer } : question), overrides: (offer.overridesJson ?? []) as OfferOverride[], areCriticalAnswered };
};
export type OfferQuestionState = ReturnType<typeof state>;
export type PublicOfferQuestion = Omit<OfferQuestion, "answer"> & { answer?: string };

export async function getOfferQuestionState(id: string, userId: string) {
  const offer = await getOffer(id, userId); if (!offer) throw missing(); return state(offer);
}

export function publicOffer(offer: typeof jobOffers.$inferSelect) {
  return {
    id: offer.id,
    status: offer.status,
    category: offer.detectedCategory,
    keywords: offer.extractedKeywords ?? [],
    confidence: offer.confidence,
    questions: (offer.questionsJson ?? []) as OfferQuestion[],
    overrides: (offer.overridesJson ?? []) as OfferOverride[],
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

export async function createOfferQuestions(id: string, userId: string, questions: OfferQuestion[]) {
  const offer = await getOffer(id, userId); if (!offer) throw missing();
  const normalized = questions.map((q) => ({ ...q, status: q.status ?? "pending" as const }));
  await db.update(jobOffers).set({ questionsJson: normalized, status: normalized.some((q) => q.type === "critical") ? "awaiting_critical" : "awaiting_optional" }).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  return getOfferQuestionState(id, userId);
}

async function updateQuestion(id: string, userId: string, questionId: string, answer: string | undefined, skip: boolean, returnQuestion = false) {
  const offer = await getOffer(id, userId); if (!offer) throw missing();
  const questions = [...((offer.questionsJson ?? []) as OfferQuestion[])]; const question = questions.find((q) => q.questionId === questionId);
  if (!question) throw new OfferError(422, { error: "question-not-found" });
  if (skip && question.type === "critical") throw new OfferError(400, { error: "cannot-skip-critical", questionId });
  if (!skip && (typeof answer !== "string" || !answer.trim())) throw new OfferError(422, { error: "invalid-answer" });
  question.status = skip ? "skipped" : "answered"; if (!skip) question.answer = answer!.trim();
  const critical = questions.filter((q) => q.type === "critical");
  const nextStatus = critical.some((q) => q.status === "pending") ? "awaiting_critical" : questions.some((q) => q.status === "pending") ? "awaiting_optional" : "ready";
  await db.update(jobOffers).set({ questionsJson: questions, status: nextStatus }).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  if (returnQuestion) {
    const updated = questions.find((item) => item.questionId === questionId)!;
    const { answer: publicAnswer, ...withoutAnswer } = updated;
    return updated.status === "answered" ? { ...withoutAnswer, answer: publicAnswer } : withoutAnswer;
  }
  return getOfferQuestionState(id, userId);
}

export const answerOfferQuestion = async (id: string, userId: string, questionId: string, answer: string): Promise<PublicOfferQuestion> =>
  await updateQuestion(id, userId, questionId, answer, false, true) as PublicOfferQuestion;
export const skipOfferQuestion = async (id: string, userId: string, questionId: string): Promise<OfferQuestionState> =>
  await updateQuestion(id, userId, questionId, undefined, true) as OfferQuestionState;

export async function saveOfferOverride(id: string, userId: string, override: OfferOverride) {
  const offer = await getOffer(id, userId); if (!offer) throw missing();
  if (!override.profileItemId || !override.section || !["include", "exclude"].includes(override.action)) throw new OfferError(422, { error: "invalid-override" });
  const overrides = [...((offer.overridesJson ?? []) as OfferOverride[])].filter((o) => !(o.profileItemId === override.profileItemId && o.section === override.section)); overrides.push(override);
  await db.update(jobOffers).set({ overridesJson: overrides }).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  return getOfferQuestionState(id, userId);
}

export async function deleteOfferOverride(id: string, userId: string, profileItemId: string, section: string) {
  const offer = await getOffer(id, userId); if (!offer) throw missing();
  const overrides = ((offer.overridesJson ?? []) as OfferOverride[]).filter(
    (item) => !(item.profileItemId === profileItemId && item.section === section),
  );
  await db.update(jobOffers).set({ overridesJson: overrides }).where(and(eq(jobOffers.id, id), eq(jobOffers.userId, userId)));
  return getOfferQuestionState(id, userId);
}
