import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/session";
import { skipOfferQuestion, OfferError } from "@/lib/job-offers/service";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; questionId: string }> }) {
  const user = await getUserOrNull(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const p = await params; return NextResponse.json(await skipOfferQuestion(p.id, user.id, p.questionId)); }
   catch (error) { if (error instanceof OfferError) return NextResponse.json(error.body, { status: error.status }); return NextResponse.json({ error: "invalid-request" }, { status: 400 }); }
}
