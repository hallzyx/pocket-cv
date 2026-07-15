// ---------------------------------------------------------------------------
// M2 Interview Agent — Atomic emitter (commit-before-enqueue)
//
// In one DB transaction:
// 1. Lock and read the interview row (FOR UPDATE)
// 2. Allocate the next version number
// 3. Write profile/tool/audit/interview projection updates as applicable
// 4. Insert the event record
// 5. Commit succeeds → enqueue the SSE event
//
// A rollback emits nothing. A disconnect after commit is replayed.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { interviewEvents } from "@/lib/db/schema";
import { createId } from "@paralleldrive/cuid2";
import type { InterviewEvent } from "./types";
import { encodeEvent } from "./sse";
import type { PoolConnection } from "mysql2/promise";

export type EmitResult = {
  version: number;
  sseChunk: string;
  /** true when a terminal status update affected zero rows (race lost) */
  raceLost?: boolean;
  raceLostReason?: string;
};

/**
 * Emit a single event — atomic commit-before-enqueue.
 *
 * Uses a raw transaction to ensure atomicity:
 * 1. SELECT ... FOR UPDATE on the interview row
 * 2. INSERT into interview_events with next version
 * 3. Apply any side-effect updates (interview, profile, ai_run)
 * 4. COMMIT
 * 5. Return the SSE chunk for the controller to enqueue
 *
 * @returns The version number and SSE text, or null if the interview is gone.
 */
export async function emitEvent(params: {
  interviewId: string;
  eventType: InterviewEvent["type"];
  payload: Record<string, unknown>;
  /** Optional: profile updates to persist atomically with the event (camelCase keys) */
  profileUpdates?: Record<string, unknown>;
  /** Optional: interview projection updates (camelCase keys) */
  interviewUpdates?: Record<string, unknown>;
  /** Optional: run completion metadata (updates ai_runs directly) */
  runCompletion?: {
    runId: string;
    tokensIn: number;
    tokensOut: number;
    providerResponseId?: string;
  };
  /** Optional: run failure metadata */
  runFailure?: {
    runId: string;
    error: string;
  };
  /** Optional: run cancellation metadata (sets status to 'cancelled') */
  runCancellation?: {
    runId: string;
    error: string;
  };
}): Promise<EmitResult | null> {
  const conn: PoolConnection = await (db as unknown as {
    $client: { getConnection: () => Promise<PoolConnection> };
  }).$client.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Lock and read interview (FOR UPDATE)
    const [interviewRow] = await conn.query(
      "SELECT id, transcript_version FROM interviews WHERE id = ? FOR UPDATE",
      [params.interviewId],
    );
    const rows = interviewRow as Array<{ id: string; transcript_version: number }>;
    if (!rows || rows.length === 0) {
      await conn.rollback();
      return null;
    }

    const nextVersion = rows[0].transcript_version + 1;

    // 2. Insert event record
    const eventId = createId();
    await conn.query(
      "INSERT INTO interview_events (id, interview_id, version, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
      [
        eventId,
        params.interviewId,
        nextVersion,
        params.eventType,
        JSON.stringify(params.payload),
      ],
    );

    // 3. Update interview transcript_version
    await conn.query(
      "UPDATE interviews SET transcript_version = ? WHERE id = ?",
      [nextVersion, params.interviewId],
    );

    // 3a. Apply interview projection updates (e.g. transcript, status)
    if (params.interviewUpdates && Object.keys(params.interviewUpdates).length > 0) {
      const setClauses: string[] = [];
      const setValues: unknown[] = [];
      for (const [key, value] of Object.entries(params.interviewUpdates)) {
        // Map camelCase to snake_case
        const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        setClauses.push(`${snakeKey} = ?`);
        setValues.push(
          value !== null && typeof value === "object" ? JSON.stringify(value) : value,
        );
      }
      if (setClauses.length > 0) {
        setValues.push(params.interviewId);
        await conn.query(
          `UPDATE interviews SET ${setClauses.join(", ")} WHERE id = ?`,
          setValues,
        );
      }
    }

    // 3b. Apply profile updates
    if (params.profileUpdates && Object.keys(params.profileUpdates).length > 0) {
      const [profileRow] = await conn.query(
        "SELECT id FROM professional_profile WHERE user_id = (SELECT user_id FROM interviews WHERE id = ?)",
        [params.interviewId],
      );
      const profileRows = profileRow as Array<{ id: string }>;

      if (profileRows && profileRows.length > 0) {
        const setClauses: string[] = [];
        const setValues: unknown[] = [];
        for (const [key, value] of Object.entries(params.profileUpdates)) {
          const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
          setClauses.push(`${snakeKey} = ?`);
          setValues.push(JSON.stringify(value));
        }
        setValues.push(profileRows[0].id);
        await conn.query(
          `UPDATE professional_profile SET ${setClauses.join(", ")} WHERE id = ?`,
          setValues,
        );
      }
    }

    // 3c. Apply run completion (only if still 'running' — atomic terminal arbitration)
    if (params.runCompletion) {
      const [result] = await conn.query(
        "UPDATE ai_runs SET status = 'completed', tokens_in = ?, tokens_out = ?, provider_response_id = ? WHERE id = ? AND status = 'running'",
        [
          params.runCompletion.tokensIn,
          params.runCompletion.tokensOut,
          params.runCompletion.providerResponseId ?? null,
          params.runCompletion.runId,
        ],
      );
      const affected = (result as { affectedRows: number }).affectedRows;
      if (affected === 0) {
        await conn.rollback();
        return {
          version: 0,
          sseChunk: "",
          raceLost: true,
          raceLostReason: "Run was already terminated (completion race lost)",
        };
      }
    }

    // 3d. Apply run failure (only if still 'running' — atomic terminal arbitration)
    if (params.runFailure) {
      const [result] = await conn.query(
        "UPDATE ai_runs SET status = 'failed', error = ? WHERE id = ? AND status = 'running'",
        [params.runFailure.error, params.runFailure.runId],
      );
      const affected = (result as { affectedRows: number }).affectedRows;
      if (affected === 0) {
        await conn.rollback();
        return {
          version: 0,
          sseChunk: "",
          raceLost: true,
          raceLostReason: "Run was already terminated (failure race lost)",
        };
      }
    }

    // 3e. Apply run cancellation (only if still 'running' — atomic terminal arbitration)
    if (params.runCancellation) {
      const [result] = await conn.query(
        "UPDATE ai_runs SET status = 'cancelled', error = ? WHERE id = ? AND status = 'running'",
        [params.runCancellation.error, params.runCancellation.runId],
      );
      const affected = (result as { affectedRows: number }).affectedRows;
      if (affected === 0) {
        await conn.rollback();
        return {
          version: 0,
          sseChunk: "",
          raceLost: true,
          raceLostReason: "Run was already terminated (cancellation race lost)",
        };
      }
    }

    // 4. Commit
    await conn.commit();

    // 5. Build SSE chunk
    const event: InterviewEvent = {
      version: nextVersion,
      type: params.eventType,
      payload: params.payload,
    };

    return {
      version: nextVersion,
      sseChunk: encodeEvent(event),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Get all events for an interview with version > lastKnownVersion.
 * Used for replay on reconnection.
 */
export async function getEventsSince(
  interviewId: string,
  lastKnownVersion: number,
): Promise<InterviewEvent[]> {
  const conn: PoolConnection = await (db as unknown as {
    $client: { getConnection: () => Promise<PoolConnection> };
  }).$client.getConnection();

  try {
    const [rows] = await conn.query(
      "SELECT version, event_type, payload FROM interview_events WHERE interview_id = ? AND version > ? ORDER BY version ASC",
      [interviewId, lastKnownVersion],
    );

    return (rows as Array<{ version: number; event_type: string; payload: string }>).map(
      (r) => ({
        version: r.version,
        type: r.event_type as InterviewEvent["type"],
        payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      }),
    );
  } finally {
    conn.release();
  }
}
