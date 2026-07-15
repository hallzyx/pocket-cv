import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";

/**
 * PATCH /api/interviews/[id]
 * Transitions interview state: pause, resume, or complete.
 * Body: { status: "paused" | "active" | "completed" }
 * Returns 401 if not authenticated, 403 if not the owner, 404 if not found.
 */
export async function PATCH(
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
    .select()
    .from(interviews)
    .where(eq(interviews.id, id))
    .limit(1);

  if (!interview) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (interview.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const newStatus = body.status as string;

  if (!["paused", "active", "completed"].includes(newStatus)) {
    return NextResponse.json(
      { error: "Invalid status. Must be: paused, active, or completed" },
      { status: 400 },
    );
  }

  // Validate transitions
  if (interview.status === "completed" && newStatus !== "completed") {
    return NextResponse.json(
      { error: "Cannot change status of a completed interview" },
      { status: 400 },
    );
  }

  await db
    .update(interviews)
    .set({ status: newStatus as "paused" | "active" | "completed" })
    .where(eq(interviews.id, id));

  const [updated] = await db
    .select()
    .from(interviews)
    .where(eq(interviews.id, id))
    .limit(1);

  return NextResponse.json(updated);
}
