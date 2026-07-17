import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/session";
import { createOfferQuestions, getOfferQuestionState, OfferError } from "@/lib/job-offers/service";
import { offerQuestionsSchema } from "@/lib/job-offers/schemas";

type Context = { params: Promise<{ id: string }> };
const result = (error: unknown) => error instanceof OfferError ? NextResponse.json(error.body, { status: error.status }) : NextResponse.json({ error: "invalid-request" }, { status: 400 });

export async function GET(_request: Request, { params }: Context) {
  const user = await getUserOrNull(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json((await getOfferQuestionState((await params).id, user.id)).questions); } catch (error) { return result(error); }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getUserOrNull(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const parsed = offerQuestionsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid-questions" }, { status: 400 });
    return NextResponse.json((await createOfferQuestions((await params).id, user.id, parsed.data.questions)).questions, { status: 201 });
  } catch (error) { return result(error); }
}
