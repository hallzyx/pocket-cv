import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cvs, professionalProfile } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";
import { mergeCvIntoProfile } from "@/lib/profile/sync";

/**
 * GET /api/cvs/[cvId]
 * Returns a single CV by id.
 * Returns 403 if not the owner.
 * Returns 404 if not found.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cvId: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cvId } = await params;

  const [cv] = await db.select().from(cvs).where(eq(cvs.id, cvId)).limit(1);
  if (!cv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (cv.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(cv);
}

/**
 * PATCH /api/cvs/[cvId]
 * Updates contentJson, title, texSource, atsScore.
 * Returns 403 if not the owner.
 * After updating the CV, automatically syncs changes back to professional_profile.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cvId: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cvId } = await params;

  const [cv] = await db.select().from(cvs).where(eq(cvs.id, cvId)).limit(1);
  if (!cv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (cv.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return NextResponse.json({ error: "Title must be a non-empty string" }, { status: 400 });
    }
    updates.title = body.title.trim();
  }
  if (body.contentJson !== undefined) {
    updates.contentJson = body.contentJson;
  }
  if (body.texSource !== undefined) {
    updates.texSource = body.texSource;
  }
  if (body.atsScore !== undefined) {
    updates.atsScore = body.atsScore;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(cvs).set(updates).where(eq(cvs.id, cvId));
  }

  // After updating CV, sync changes back to professional_profile (profile grows)
  // Get the updated CV to use its contentJson
  const [updated] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.id, cvId))
    .limit(1);

  if (updated?.contentJson) {
    const [profile] = await db
      .select()
      .from(professionalProfile)
      .where(eq(professionalProfile.userId, user.id))
      .limit(1);

    if (profile) {
      const syncUpdates = mergeCvIntoProfile(profile, updated.contentJson);
      if (Object.keys(syncUpdates).length > 0) {
        await db
          .update(professionalProfile)
          .set(syncUpdates)
          .where(eq(professionalProfile.id, profile.id));
      }
    }
  }

  return NextResponse.json(updated ?? cv);
}

/**
 * DELETE /api/cvs/[cvId]
 * Deletes a CV by id.
 * Returns 403 if not the owner.
 * Returns 204 on success.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ cvId: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cvId } = await params;

  const [cv] = await db.select().from(cvs).where(eq(cvs.id, cvId)).limit(1);
  if (!cv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (cv.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(cvs).where(eq(cvs.id, cvId));

  return new NextResponse(null, { status: 204 });
}
