import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { professionalProfile } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getUserOrNull } from "@/lib/auth/session";

/**
 * GET /api/profile
 * Returns the user's professional_profile.
 * Returns 404 if no profile exists yet.
 * Returns 401 if not authenticated.
 */
export async function GET() {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [profile] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}

/**
 * PATCH /api/profile
 * Updates profile fields. Creates the profile if it doesn't exist (upsert).
 * Returns 401 if not authenticated.
 */
export async function PATCH(request: NextRequest) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const allowedFields = [
    "personalInfo",
    "experiences",
    "education",
    "skills",
    "projects",
    "achievements",
    "preferences",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Upsert: check if profile exists
  const [existing] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  if (existing) {
    await db
      .update(professionalProfile)
      .set(updates)
      .where(eq(professionalProfile.id, existing.id));
  } else {
    const id = createId();
    await db.insert(professionalProfile).values({
      id,
      userId: user.id,
      ...updates,
    } as typeof professionalProfile.$inferInsert);
  }

  const [profile] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  return NextResponse.json(profile);
}
