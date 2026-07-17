import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/session";
import { createOffer, getOffers, OfferError } from "@/lib/job-offers/service";

export async function GET() {
  const user = await getUserOrNull();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getOffers(user.id));
}

export async function POST(request: Request) {
  const user = await getUserOrNull();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const offer = await createOffer(user.id, body.rawText);
    return NextResponse.json({ id: offer.id, status: offer.status, createdAt: offer.createdAt }, { status: 201 });
  } catch (error) {
    if (error instanceof OfferError) return NextResponse.json(error.body, { status: error.status });
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
}
