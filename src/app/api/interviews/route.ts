import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getUserOrNull } from "@/lib/auth/session";
import type { PoolConnection } from "mysql2/promise";

/**
 * GET /api/interviews
 * Returns all interviews for the authenticated user, ordered by most recent first.
 * Returns 401 if not authenticated.
 */
export async function GET() {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(interviews)
    .where(eq(interviews.userId, user.id))
    .orderBy(desc(interviews.updatedAt));

  return NextResponse.json(result);
}

/**
 * POST /api/interviews
 * Creates a new interview session in 'active' state.
 * Uses MySQL GET_LOCK for user-level serialization so that two concurrent
 * POSTs by the same user produce exactly one interview row.
 * If the user already has an active or paused interview, auto-resumes it
 * (returns the existing one with 200).
 * Body: { purpose?: string }
 * Returns 201 with the created interview (or 200 if resuming existing).
 * Returns 401 if not authenticated.
 */
export async function POST(request: NextRequest) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body once, outside the lock
  const body = await request.json().catch(() => ({}));
  const purpose =
    typeof body.purpose === "string" && body.purpose.trim().length > 0
      ? body.purpose.trim()
      : null;

  // User-level MySQL named lock — serializes all POSTs for this user
  const conn: PoolConnection = await (db as unknown as {
    $client: { getConnection: () => Promise<PoolConnection> };
  }).$client.getConnection();

  const lockName = `pcv_int_${Buffer.from(user.id, "utf-8").toString("hex")}`;

  try {
    const [lockRows] = await conn.query("SELECT GET_LOCK(?, 10)", [lockName]);
    const lockVal = Object.values((lockRows as Array<Record<string, unknown>>)[0])[0];
    if (lockVal !== 1) {
      throw new Error("Failed to acquire user interview lock (timeout or deadlock)");
    }

    // Within lock: find latest active or paused interview
    const [intRows] = await conn.query(
      "SELECT * FROM interviews WHERE user_id = ? AND (status = 'active' OR status = 'paused') ORDER BY updated_at DESC LIMIT 1",
      [user.id],
    );
    const existing = (intRows as Array<Record<string, unknown>>)[0] ?? null;

    if (existing) {
      // Atomically resume paused → active
      if (existing.status === "paused") {
        await conn.query(
          "UPDATE interviews SET status = 'active', updated_at = NOW() WHERE id = ?",
          [existing.id],
        );
        existing.status = "active";
      }

      // Update purpose if provided (doesn't change dedup — same interview returned)
      if (purpose) {
        await conn.query(
          "UPDATE interviews SET purpose = ?, updated_at = NOW() WHERE id = ?",
          [purpose, existing.id],
        );
        existing.purpose = purpose;
      }

      return NextResponse.json(existing, { status: 200 });
    }

    // No existing active/paused interview — create new one
    const id = createId();
    await conn.query(
      "INSERT INTO interviews (id, user_id, status, purpose, transcript, transcript_version, created_at, updated_at) VALUES (?, ?, 'active', ?, '[]', 0, NOW(), NOW())",
      [id, user.id, purpose],
    );

    // Read back the created interview
    const [createdRows] = await conn.query("SELECT * FROM interviews WHERE id = ?", [id]);
    const created = (createdRows as Array<Record<string, unknown>>)[0];

    return NextResponse.json(created, { status: 201 });
  } finally {
    // Always release the named lock (GET_LOCK is session-scoped, not transaction-scoped)
    await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    conn.release();
  }
}


