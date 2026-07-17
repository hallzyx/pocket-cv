import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/session";
import { getOffer, publicOffer } from "@/lib/job-offers/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrNull();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const offer = await getOffer((await params).id, user.id);
  return offer ? NextResponse.json(publicOffer(offer)) : NextResponse.json({ error: "offer-not-found" }, { status: 404 });
}
