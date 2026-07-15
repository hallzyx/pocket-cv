import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, professionalProfile } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUserOrNull } from "@/lib/auth/session";
import { createProvider } from "@/lib/ai/provider";
import { runAgent } from "@/lib/ai/agent";
import { emitEvent } from "@/lib/ai/atomic-emitter";
import type { AgentInput } from "@/lib/ai/types";
import { AGENT_LIMITS } from "@/lib/ai/types";

/**
 * POST /api/interviews/[id]/messages
 * Sends a user message to the interview agent and returns a streaming SSE response.
 *
 * Body: { message: string }
 * Returns a ReadableStream of SSE events.
 * Returns 400 if message is missing or too long.
 * Returns 403 if not the owner.
 * Returns 404 if interview not found.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Fetch interview
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

  // Parse body
  const body = await request.json().catch(() => ({}));
  const message =
    typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  if (message.length > AGENT_LIMITS.maxUserChars) {
    return NextResponse.json(
      { error: `Message exceeds ${AGENT_LIMITS.maxUserChars} character limit` },
      { status: 400 },
    );
  }

  // Check interview is in a valid state
  if (interview.status === "completed") {
    return NextResponse.json(
      { error: "Interview is already completed" },
      { status: 400 },
    );
  }

  if (interview.status === "paused") {
    return NextResponse.json(
      { error: "Interview is paused. Resume before sending messages." },
      { status: 400 },
    );
  }

  // Get the user's profile for context
  const [profile] = await db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.userId, user.id))
    .limit(1);

  // Create provider (DeepSeek by default)
  const providerName = (process.env.AI_PROVIDER ?? "deepseek") as "deepseek";
  const provider = createProvider(providerName);

  // Build SSE stream
  const abortController = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      // Safe enqueue helper — swallows errors after stream cancel
      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(new TextEncoder().encode(chunk));
        } catch {
          // Stream cancelled by transport disconnect — agent continues durably
        }
      };

      // Safe close helper — swallows errors after stream cancel
      const safeClose = () => {
        try { controller.close(); } catch { /* stream already cancelled */ }
      };

      // Safe error helper — swallows errors after stream cancel
      const safeError = (err: unknown) => {
        try { controller.error(err); } catch { /* stream already cancelled */ }
      };

      // Track runId so the catch block can atomically terminalize if needed
      let agentRunId: string | undefined;

      try {
        // Persist the user message as an event first
        const userMsgResult = await emitEvent({
          interviewId: id,
          eventType: "message.delta",
          payload: { content: message, role: "user" },
          interviewUpdates: {
            transcript: JSON.stringify([
              ...((interview.transcript as Array<Record<string, unknown>>) ?? []),
              {
                role: "user",
                content: message,
                timestamp: new Date().toISOString(),
              },
            ]),
          },
        });

        if (userMsgResult) {
          safeEnqueue(userMsgResult.sseChunk);
        }

        // Build agent input
        const agentInput: AgentInput = {
          interviewId: id,
          userId: user.id,
          message,
          transcript: (interview.transcript ?? []) as AgentInput["transcript"],
          transcriptVersion: interview.transcriptVersion,
          profile: profile
            ? {
                personalInfo: profile.personalInfo,
                experiences: profile.experiences,
                education: profile.education,
                skills: profile.skills,
                projects: profile.projects,
                achievements: profile.achievements,
                preferences: profile.preferences,
              }
            : null,
        };

        // Run the agent loop
        const agentResult = await runAgent(agentInput, provider, (chunk: string) => {
          safeEnqueue(chunk);
        }, abortController);

        agentRunId = agentResult.runId;

        safeClose();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Internal error";
        // Atomic terminalization: if a run was created, persist exactly one
        // run.failed terminal event with runFailure to update DB status atomically.
        // If agentRunId is undefined, the error occurred before run creation.
        try {
          const failResult = await emitEvent({
            interviewId: id,
            eventType: "run.failed",
            payload: { error: errorMessage },
            ...(agentRunId
              ? { runFailure: { runId: agentRunId, error: errorMessage } }
              : {}),
          });
          if (failResult) {
            safeEnqueue(failResult.sseChunk);
          }
        } catch {
          // Failed to emit failure event — stream is best-effort
        }
        safeError(err);
      }
    },
    cancel() {
      // Transport disconnect does NOT abort the agent run.
      // The run continues durably in the background; the client
      // reconnects via GET /events with lastKnownVersion for replay.
      // Only the explicit POST /runs/[runId]/cancel endpoint aborts.
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
