import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/session";
import { answerOfferQuestion, OfferError } from "@/lib/job-offers/service";
import { answerQuestionSchema } from "@/lib/job-offers/schemas";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; questionId: string }> }) {
  const user = await getUserOrNull(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const parsed = answerQuestionSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "invalid-answer" }, { status: 400 }); const p = await params; return NextResponse.json(await answerOfferQuestion(p.id, user.id, p.questionId, parsed.data.answer)); }
  catch (error) { return error instanceof OfferError ? NextResponse.json(error.body, { status: error.status }) : NextResponse.json({ error: "invalid-request" }, { status: 400 }); }
}
