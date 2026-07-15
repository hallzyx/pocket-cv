import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { professionalProfile, cvs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";
import { mergeCvIntoProfile } from "@/lib/profile/sync";

/**
 * POST /api/profile/sync
 * Body: { cvId: number, contentJson: CvContent }
 * Merges CV content into the professional_profile.
 * - experiences/skills/projects/education: items not already in the profile (by id) are appended
 * - personalInfo/preferences: overwritten with CV values
 * Returns the updated profile.
 */
export async function POST(request: NextRequest) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.contentJson) {
    return NextResponse.json({ error: "contentJson is required" }, { status: 400 });
  }

  // Upsert the profile with merged content
  const [profile] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  if (!profile) {
    // No profile exists yet — create from CV content
    const profileId = (await import("@paralleldrive/cuid2")).createId();
    await db.insert(professionalProfile).values({
      id: profileId,
      userId: user.id,
      personalInfo: body.contentJson.personalInfo ?? {},
      experiences: body.contentJson.experiences ?? [],
      education: body.contentJson.education ?? [],
      skills: body.contentJson.skills ?? [],
      projects: body.contentJson.projects ?? [],
      achievements: body.contentJson.achievements ?? [],
      preferences: body.contentJson.languages
        ? { languages: body.contentJson.languages }
        : {},
    });

    const [created] = await db
      .select()
      .from(professionalProfile)
      .where(eq(professionalProfile.userId, user.id))
      .limit(1);

    return NextResponse.json(created);
  }

  // Merge CV content into existing profile
  const updates = mergeCvIntoProfile(profile, body.contentJson);
  if (Object.keys(updates).length > 0) {
    await db
      .update(professionalProfile)
      .set(updates)
      .where(eq(professionalProfile.id, profile.id));
  }

  const [updated] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  return NextResponse.json(updated);
}
