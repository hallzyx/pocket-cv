import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserOrNull } from "@/lib/auth/session";
import { adaptOffer } from "@/lib/job-offers/generation";

const requestSchema = z.object({ generationRequestId: z.string().trim().min(1).max(128) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrNull();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "invalid-request" }, { status: 400 }); }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  try {
    const result = await adaptOffer((await params).id, user.id, parsed.data.generationRequestId);
    const { replayed, ...body } = result;
    return NextResponse.json(body, { status: replayed ? 200 : result.status === "completed" ? 201 : 422 });
  } catch (error) {
    const failure = error as { code?: string; questionId?: string; status?: string; message?: string };
    if (failure.message === "offer-not-found") return NextResponse.json({ error: "offer-not-found" }, { status: 404 });
    if (failure.code === "blocking-question") return NextResponse.json({ error: failure.code, questionId: failure.questionId }, { status: 400 });
    if (failure.code === "invalid-offer-state") return NextResponse.json({ error: failure.code, status: failure.status }, { status: 409 });
    return NextResponse.json({ error: "generation-failed" }, { status: 422 });
  }
}
