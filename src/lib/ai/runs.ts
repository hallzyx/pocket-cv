// ---------------------------------------------------------------------------
// M2 Interview Agent — ai_runs CRUD, cancellation registry, concurrent-run guard
//
// The cancellation registry maps run IDs to AbortControllers so that
// explicit cancellation can signal the in-progress provider stream.
// A DB-enforced concurrent-run guard prevents more than one `running`
// run per user at a time (checked at run creation).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { aiRuns } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { PoolConnection } from "mysql2/promise";

/** In-memory cancellation registry: runId → AbortController */
const cancellationRegistry = new Map<string, AbortController>();

/**
 * Register an AbortController for a run.
 */
export function registerRunAbortController(
  runId: string,
  controller: AbortController,
): void {
  cancellationRegistry.set(runId, controller);
}

/**
 * Unregister a run's AbortController (after run completes or is cleaned up).
 */
export function unregisterRunAbortController(runId: string): void {
  cancellationRegistry.delete(runId);
}

/**
 * Get the AbortController for a run, if any.
 */
export function getRunAbortController(
  runId: string,
): AbortController | undefined {
  return cancellationRegistry.get(runId);
}

/**
 * Check if a user already has a run with status 'running'.
 * Returns the existing run id, or null if none.
 */
export async function checkConcurrentRun(
  userId: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, userId), eq(aiRuns.status, "running")))
    .limit(1);

  return existing?.id ?? null;
}

/**
 * Create a new ai_run record in 'running' status.
 * Uses MySQL GET_LOCK for user-level concurrency control across different interviews.
 * @throws {Error} if user already has a running run
 */
export async function createRun(params: {
  userId: string;
  interviewId: string;
  model: string;
  task: string;
}): Promise<{ id: string }> {
  const conn = await (db as unknown as {
    $client: { getConnection: () => Promise<PoolConnection> };
  }).$client.getConnection();

  // Build a stable user-level lock name (hex-encoded to handle any chars)
  const lockName = `pcv_run_${Buffer.from(params.userId, "utf-8").toString("hex")}`;

  try {
    // Acquire user-level MySQL named lock (10s timeout)
    const [lockRows] = await conn.query("SELECT GET_LOCK(?, 10)", [lockName]);
    const lockVal = Object.values((lockRows as Array<Record<string, unknown>>)[0])[0];
    if (lockVal !== 1) {
      throw new Error("Failed to acquire user concurrency lock (timeout or deadlock)");
    }

    await conn.beginTransaction();

    // Verify interview exists and is owned by this user
    const [intRows] = await conn.query(
      "SELECT id FROM interviews WHERE id = ? AND user_id = ? FOR UPDATE",
      [params.interviewId, params.userId],
    );
    if ((intRows as Array<unknown>).length === 0) {
      await conn.rollback();
      throw new Error(`Interview ${params.interviewId} not found or not owned by user`);
    }

    // Now check for existing running runs for this user (across ALL interviews)
    const [existingRows] = await conn.query(
      "SELECT id FROM ai_runs WHERE user_id = ? AND status = 'running' LIMIT 1",
      [params.userId],
    );
    const existing = existingRows as Array<{ id: string }>;
    if (existing && existing.length > 0) {
      await conn.rollback();
      throw new Error(
        `User ${params.userId} already has running run ${existing[0].id}. Complete or cancel it first.`,
      );
    }

    // Insert the new run
    const id = createId();
    await conn.query(
      "INSERT INTO ai_runs (id, user_id, interview_id, model, task, status, tokens_in, tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, 'running', 0, 0, '0')",
      [id, params.userId, params.interviewId, params.model as string, params.task],
    );

    await conn.commit();
    return { id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    // Always release the named lock (GET_LOCK is session-scoped, not transaction-scoped)
    await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    conn.release();
  }
}

/**
 * Get a run by its id.
 */
export async function getRun(runId: string) {
  const [run] = await db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.id, runId))
    .limit(1);
  return run ?? null;
}

/**
 * Signal cancellation for a running run.
 * Returns true if the run was found and signalled.
 */
export function signalCancel(runId: string): boolean {
  const controller = cancellationRegistry.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

// ── M3 Adaptation helpers ──────────────────────────────────────────────

export async function createExtractionAttempt(p: { jobOfferId: string; userId: string; model: string; attempt: number; task: string }): Promise<{ id: string }> {
  const id = createId();
  await db.insert(aiRuns).values({ id, userId: p.userId, jobOfferId: p.jobOfferId, model: p.model, attempt: p.attempt, task: p.task, status: "running", tokensIn: 0, tokensOut: 0, costUsd: "0" });
  return { id };
}

export async function completeExtractionAttempt(p: { attemptId: string; tokensIn: number; tokensOut: number; providerResponseId?: string; jobOfferId?: string }): Promise<void> {
  await db.update(aiRuns).set({ status: "completed", tokensIn: p.tokensIn, tokensOut: p.tokensOut, providerResponseId: p.providerResponseId ?? null, jobOfferId: p.jobOfferId ?? undefined }).where(eq(aiRuns.id, p.attemptId));
}

export async function failExtractionAttempt(p: { attemptId: string; error: string; tokensIn: number; tokensOut: number; providerResponseId?: string }): Promise<void> {
  await db.update(aiRuns).set({ status: "failed", error: p.error, tokensIn: p.tokensIn, tokensOut: p.tokensOut, providerResponseId: p.providerResponseId ?? null }).where(eq(aiRuns.id, p.attemptId));
}
