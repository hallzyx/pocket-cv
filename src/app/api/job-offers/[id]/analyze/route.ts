import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/session";
import { analyzeOffer, OfferError } from "@/lib/job-offers/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrNull();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const offer = await analyzeOffer((await params).id, user.id);
    return NextResponse.json({ status: offer.status, confidence: offer.confidence, category: offer.detectedCategory, keywords: offer.extractedKeywords });
  } catch (error) {
    if (error instanceof OfferError) return NextResponse.json(error.body, { status: error.status });
    return NextResponse.json({ error: "analysis-failed" }, { status: 500 });
  }
}
