import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, aiRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";
import { signalCancel } from "@/lib/ai/runs";
import { emitEvent } from "@/lib/ai/atomic-emitter";

/**
 * POST /api/interviews/[id]/runs/[runId]/cancel
 *
 * Owner-only cancellation endpoint.
 * Single atomic transaction: marks the run 'cancelled' AND writes a
 * run.cancelled event in one DB transaction. If the run is already
 * terminated (race lost), returns 409 without writing an event.
 * On success, signals the in-process AbortController.
 *
 * Returns 200 on success.
 * Returns 409 if race lost (run already terminated).
 * Returns 403 if not the owner.
 * Returns 404 if interview or run not found.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, runId } = await params;

  // Verify interview exists and is owned
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

  // Verify run exists and belongs to this interview
  const [run] = await db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.id, runId))
    .limit(1);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.interviewId !== id) {
    return NextResponse.json({ error: "Run does not belong to this interview" }, { status: 400 });
  }

  if (run.status !== "running") {
    return NextResponse.json({
      error: `Run is not running (current status: ${run.status})`,
    }, { status: 400 });
  }

  // Single atomic transaction: cancel ai_run + insert interview_event
  const result = await emitEvent({
    interviewId: id,
    eventType: "run.cancelled",
    payload: {
      runId,
      reason: "Cancelled by user",
    },
    runCancellation: {
      runId,
      error: "Cancelled by user",
    },
  });

  if (!result || result.raceLost) {
    // Race lost — another terminal state was set first; no event was written
    return NextResponse.json({
      error: "Run was already terminated by another process",
    }, { status: 409 });
  }

  // Signal the in-progress AbortController
  signalCancel(runId);

  return NextResponse.json({ status: "cancelled", runId });
}
