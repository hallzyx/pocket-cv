import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";
import { getEventsSince } from "@/lib/ai/atomic-emitter";
import { encodeEvent } from "@/lib/ai/sse";
import type { InterviewEvent } from "@/lib/ai/types";

/**
 * GET /api/interviews/[id]/events?lastKnownVersion=N
 *
 * Returns ordered events where version > lastKnownVersion.
 * Used for replay after reconnect.
 *
 * Returns 403 if not the owner.
 * Returns 404 if interview not found.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const [interview] = await db
    .select({ userId: interviews.userId })
    .from(interviews)
    .where(eq(interviews.id, id))
    .limit(1);

  if (!interview) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (interview.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse lastKnownVersion
  const url = new URL(request.url);
  const lastKnownVersion = Math.max(
    0,
    parseInt(url.searchParams.get("lastKnownVersion") ?? "0", 10) || 0,
  );

  // Fetch events
  const events = await getEventsSince(id, lastKnownVersion);

  // Build SSE response
  const sse = events
    .map((event: InterviewEvent) => encodeEvent(event))
    .join("");

  return new NextResponse(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
