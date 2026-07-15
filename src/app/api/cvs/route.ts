import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cvs, professionalProfile } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getUserOrNull } from "@/lib/auth/session";
import type { CvContent } from "@/lib/db/schema";

/**
 * GET /api/cvs
 * Returns all CVs for the authenticated user, ordered by updatedAt desc.
 * Returns 401 if not authenticated.
 * Returns [] if user has no CVs.
 */
export async function GET() {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, user.id))
    .orderBy(desc(cvs.updatedAt));

  return NextResponse.json(result);
}

/**
 * POST /api/cvs
 * Creates a new CV seeded from the user's professional_profile.
 * Returns 201 with the created CV.
 * Returns 400 if title is missing.
 * Returns 401 if not authenticated.
 */
export async function POST(request: NextRequest) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // Seed contentJson from the user's professional_profile
  const [profile] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  const contentJson: CvContent = profile
    ? {
        personalInfo: profile.personalInfo ?? {},
        experiences: profile.experiences ?? [],
        education: profile.education ?? [],
        skills: profile.skills ?? [],
        projects: profile.projects ?? [],
        achievements: profile.achievements ?? [],
      }
    : {
        personalInfo: {},
        experiences: [],
        education: [],
        skills: [],
      };

  const id = createId();
  await db.insert(cvs).values({
    id,
    userId: user.id,
    title: body.title.trim(),
    jobOfferId: body.jobOfferId ?? null,
    contentJson,
    source: "manual",
  });

  const [created] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.id, id))
    .limit(1);

  return NextResponse.json(created, { status: 201 });
}
