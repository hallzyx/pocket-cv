// ---------------------------------------------------------------------------
// M2 Interview Agent — bounded agent loop
//
// Stateless execution: each POST to /messages creates one agent run.
// The loop enforces:
//   - ≤6 tool calls per run
//   - 60-second turn timeout (per provider interaction)
//   - 1 provider retry before any durable model output
//   - 8k user character limit
//   - 100-message / 100k-char transcript context window
//   - Errors produce events but never fabricate an assistant turn
// ---------------------------------------------------------------------------

import type {
  AgentInput,
  ChatProvider,
  ProviderEvent,
  InterviewEvent,
} from "./types";
import { AGENT_LIMITS } from "./types";
import { registerTools, findTool, type RegisteredTool } from "./tools";
import { emitEvent } from "./atomic-emitter";
import { createRun, registerRunAbortController, unregisterRunAbortController } from "./runs";

export type AgentResult = {
  /** The ai_run ID created for this agent execution, if a run was created */
  runId?: string;
  /** Final events emitted during this run */
  events: InterviewEvent[];
  /** Whether the run completed successfully */
  success: boolean;
  /** Error message if the run failed */
  error?: string;
  /** Token usage */
  tokensIn: number;
  tokensOut: number;
  /** Provider response id */
  providerResponseId?: string;
};

/**
 * Run one agent turn: receive user message, run the bounded tool loop,
 * emit events atomically.
 *
 * This is a Pull-based helper invoked by the route handler. The route
 * handler owns the SSE ReadableStream controller; this function calls
 * emitEvent() which returns SSE chunks, and the route enqueues them.
 */
export async function runAgent(
  input: AgentInput,
  provider: ChatProvider,
  enqueueSse: (chunk: string) => void,
  abortController: AbortController,
): Promise<AgentResult> {
  const signal = abortController.signal;
  const tools: RegisteredTool[] = registerTools();
  const events: InterviewEvent[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let providerResponseId: string | undefined;

  // -- Validate input constraints --
  if (input.message.length > AGENT_LIMITS.maxUserChars) {
    const error = `Message exceeds ${AGENT_LIMITS.maxUserChars} character limit`;
    const failResult = await emitEvent({
      interviewId: input.interviewId,
      eventType: "run.failed",
      payload: { error },
    });
    if (failResult) {
      enqueueSse(failResult.sseChunk);
      events.push({
        version: failResult.version,
        type: "run.failed",
        payload: { error },
      });
    }
    return { events, success: false, error, tokensIn: 0, tokensOut: 0 };
  }

  // -- Create the ai_run record --
  let runId: string;
  try {
    const run = await createRun({
      userId: input.userId,
      interviewId: input.interviewId,
      model: provider.model,
      task: "interview-agent",
    });
    runId = run.id;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to create run";
    const failResult = await emitEvent({
      interviewId: input.interviewId,
      eventType: "run.failed",
      payload: { error },
    });
    if (failResult) {
      enqueueSse(failResult.sseChunk);
      events.push({
        version: failResult.version,
        type: "run.failed",
        payload: { error },
      });
    }
    return { events, success: false, error, tokensIn: 0, tokensOut: 0 };
  }

  // Register the abort controller for this run
  registerRunAbortController(runId, abortController);

  try {
    // -- Build system prompt --
    const systemPrompt = buildSystemPrompt(input.profile);

    // -- Build transcript context (newest messages, bounded) --
    const transcriptMessages = input.transcript
      .slice(-AGENT_LIMITS.maxTranscriptMessages)
      .reduce<Array<{ role: "system" | "user" | "assistant"; content: string }>>(
        (acc, m) => {
          const chars = acc.reduce((s, x) => s + x.content.length, 0);
          if (chars > AGENT_LIMITS.maxTranscriptChars) return acc;
          acc.push({
            role: m.role === "tool" ? "assistant" : m.role,
            content: m.content,
          });
          return acc;
        },
        [],
      );

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...transcriptMessages,
      { role: "user" as const, content: input.message },
    ];

    // -- Main tool loop --
    let toolCallCount = 0;
    let success = true;
    let error: string | undefined;

    loop: while (toolCallCount <= AGENT_LIMITS.maxToolCalls) {
      // Check for cancellation
      if (signal.aborted) {
        const cancelResult = await handleCancellation(
          input.interviewId,
          runId,
          "run.cancelled",
          { reason: "aborted" },
        );
        if (cancelResult) {
          enqueueSse(cancelResult.sseChunk);
          events.push(cancelResult.event);
        }
        success = false;
        error = "Cancelled";
        break;
      }

      // -- Call provider with retry --
      let providerEvents: ProviderEvent[] = [];
      let providerError: string | undefined;
      // Track whether any durable output was committed — prevents retry after
      // the provider has emitted text/tool/profile that was persisted.
      let hasDurableOutput = false;

      for (let attempt = 0; attempt <= AGENT_LIMITS.maxRetries; attempt++) {
        try {
          const collected: ProviderEvent[] = [];
          const timeoutSignal = AbortSignal.timeout(AGENT_LIMITS.turnTimeoutMs);
          // Combine the run signal with the timeout
          const combinedSignal = AbortSignal.any
            ? AbortSignal.any([signal, timeoutSignal])
            : signal; // fallback for older Node

          const stream = provider.stream(
            {
              model: provider.model,
              messages,
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
            { signal: combinedSignal },
          );

          for await (const evt of stream) {
            if (signal.aborted) {
              break;
            }
            collected.push(evt);

            if (evt.type === "metadata") {
              if (evt.tokensIn) tokensIn += evt.tokensIn;
              if (evt.tokensOut) tokensOut += evt.tokensOut;
              if (evt.responseId) providerResponseId = evt.responseId;
            }

            if (evt.type === "delta") {
              const result = await emitEvent({
                interviewId: input.interviewId,
                eventType: "message.delta",
                payload: { content: evt.content, runId },
              });
              if (result) {
                hasDurableOutput = true;
                enqueueSse(result.sseChunk);
                events.push({
                  version: result.version,
                  type: "message.delta",
                  payload: { content: evt.content, runId },
                });
              }
            }

            if (evt.type === "done") {
              if (evt.finishReason === "cancelled") {
                const cancelResult = await handleCancellation(
                  input.interviewId,
                  runId,
                  "run.cancelled",
                  { reason: "provider cancelled" },
                );
                if (cancelResult) {
                  enqueueSse(cancelResult.sseChunk);
                  events.push(cancelResult.event);
                }
                success = false;
                error = "Provider cancelled";
                break loop;
              }

              if (evt.finishReason === "error") {
                providerError = "Provider returned error finish reason";
                break;
              }
            }

            if (evt.type === "error") {
              providerError = evt.message;
              break;
            }
          }

          if (!providerError) {
            providerEvents = collected;
            break; // Success — exit retry loop
          }
        } catch (err) {
          if (signal.aborted) {
            const cancelResult = await handleCancellation(
              input.interviewId,
              runId,
              "run.cancelled",
              { reason: "aborted during stream" },
            );
            if (cancelResult) {
              enqueueSse(cancelResult.sseChunk);
              events.push(cancelResult.event);
            }
            success = false;
            error = "Cancelled during stream";
            break loop;
          }
          providerError = err instanceof Error ? err.message : "Unknown provider error";
        }

        // If durable output was committed and the provider still errors,
        // do NOT retry — the retry would produce duplicate committed deltas.
        if (hasDurableOutput && providerError) {
          break;
        }

        // If we still have an error and retries remain, continue
        if (providerError && attempt < AGENT_LIMITS.maxRetries) {
          continue;
        }
      }

      // If all retries failed, emit run.failed with atomic runFailure
      if (providerError && !signal.aborted) {
        const failedResult = await emitEvent({
          interviewId: input.interviewId,
          eventType: "run.failed",
          payload: { error: providerError },
          runFailure: { runId, error: providerError },
        });

        if (failedResult) {
          if (failedResult.raceLost) {
            // Another process (e.g. cancel) already terminated the run — don't overwrite
            success = true; // The run wasn't really ours to fail, report clean exit
          } else {
            enqueueSse(failedResult.sseChunk);
            events.push({
              version: failedResult.version,
              type: "run.failed",
              payload: { error: providerError },
            });
          }
        }

        success = false;
        error = providerError;
        break;
      }

      // -- Process tool calls from the provider --
      const toolCalls = providerEvents.filter((e) => e.type === "tool_call");

      if (toolCalls.length === 0) {
        // No tool calls — run is complete (assistant generated text)
        break;
      }

      for (const tc of toolCalls) {
        if (tc.type !== "tool_call") continue;

        toolCallCount++;
        if (toolCallCount > AGENT_LIMITS.maxToolCalls) {
          // Exceeded tool call limit
          break;
        }

        // Emit tool.started
        const startedResult = await emitEvent({
          interviewId: input.interviewId,
          eventType: "tool.started",
          payload: { toolName: tc.name, toolId: tc.id, runId },
        });
        if (startedResult) {
          enqueueSse(startedResult.sseChunk);
          events.push({
            version: startedResult.version,
            type: "tool.started",
            payload: { toolName: tc.name, toolId: tc.id, runId },
          });
        }

        // Execute tool
        const tool = findTool(tc.name, tools);
        if (!tool) {
          // Unknown tool — emit validation error
          const errorResult = await emitEvent({
            interviewId: input.interviewId,
            eventType: "tool.completed",
            payload: {
              toolName: tc.name,
              toolId: tc.id,
              status: "validation_error",
              error: `Unknown tool: ${tc.name}`,
              runId,
            },
          });

          if (errorResult) {
            enqueueSse(errorResult.sseChunk);
            events.push({
              version: errorResult.version,
              type: "tool.completed",
              payload: {
                toolName: tc.name,
                toolId: tc.id,
                status: "validation_error",
                error: `Unknown tool: ${tc.name}`,
                runId,
              },
            });
          }
          continue;
        }

        let profileUpdates: Record<string, unknown> | undefined;
        let interviewUpdates: Record<string, unknown> | undefined;

        const toolResult = await tool.handler(tc.arguments, {
          userId: input.userId,
          profile: input.profile as ToolContext["profile"],
          signal,
          saveProfile: async (updates) => {
            profileUpdates = updates;
          },
        });

        // Collect profile updates for the event
        if (toolResult.status === "applied" && profileUpdates) {
          interviewUpdates = { ...interviewUpdates, ...profileUpdates };
        }

        // Emit tool.completed
        const completedResult = await emitEvent({
          interviewId: input.interviewId,
          eventType: "tool.completed",
          payload: {
            toolName: tc.name,
            toolId: tc.id,
            status: toolResult.status,
            data: toolResult.data,
            error: toolResult.error,
            fingerprint: toolResult.fingerprint,
            summary: toolResult.summary,
            runId,
          },
          profileUpdates:
            toolResult.status === "applied" ? profileUpdates : undefined,
        });

        if (completedResult) {
          enqueueSse(completedResult.sseChunk);
          events.push({
            version: completedResult.version,
            type: "tool.completed",
            payload: {
              toolName: tc.name,
              toolId: tc.id,
              status: toolResult.status,
              data: toolResult.data,
              error: toolResult.error,
              summary: toolResult.summary,
              runId,
            },
          });

          // If profile was updated, emit profile.updated
          if (toolResult.status === "applied" && profileUpdates) {
            const profileResult = await emitEvent({
              interviewId: input.interviewId,
              eventType: "profile.updated",
              payload: { updates: profileUpdates, runId },
            });
            if (profileResult) {
              enqueueSse(profileResult.sseChunk);
              events.push({
                version: profileResult.version,
                type: "profile.updated",
                payload: { updates: profileUpdates, runId },
              });
            }
          }
        }
      }

      // After processing tool calls, if we haven't exceeded the limit, continue the loop
      // for the next provider interaction
      if (toolCallCount >= AGENT_LIMITS.maxToolCalls) {
        // We'll let the loop exit naturally below
      }
    }

    // -- Complete the run (single atomic transaction via emitEvent) --
    if (success) {
      const doneResult = await emitEvent({
        interviewId: input.interviewId,
        eventType: "run.completed",
        payload: { runId, tokensIn, tokensOut, providerResponseId },
        runCompletion: {
          runId,
          tokensIn,
          tokensOut,
          providerResponseId,
        },
      });

      if (doneResult) {
        if (doneResult.raceLost) {
          // Run was already terminated (e.g. cancelled) — don't claim success
          success = false;
          error = doneResult.raceLostReason;
        } else {
          enqueueSse(doneResult.sseChunk);
          events.push({
            version: doneResult.version,
            type: "run.completed",
            payload: { runId, tokensIn, tokensOut, providerResponseId },
          });
        }
      }
    }

    // Always emit a done event
    const finalDoneResult = await emitEvent({
      interviewId: input.interviewId,
      eventType: "done",
      payload: { success, runId },
    });

    if (finalDoneResult) {
      enqueueSse(finalDoneResult.sseChunk);
      events.push({
        version: finalDoneResult.version,
        type: "done",
        payload: { success, runId },
      });
    }

    return {
      runId,
      events,
      success,
      error,
      tokensIn,
      tokensOut,
      providerResponseId,
    };
  } catch (err) {
    // Unexpected throw — terminalize the run atomically so it is never
    // left in 'running' status. This allows the route handler catch block
    // to remain defense-in-depth only.
    const error = err instanceof Error ? err.message : "Unknown internal error";
    try {
      await emitEvent({
        interviewId: input.interviewId,
        eventType: "run.failed",
        payload: { error, runId },
        runFailure: { runId, error },
      });
    } catch {
      // Best-effort terminalization — if DB is down, the in-memory run
      // is lost but the route handler still gets a graceful failure.
    }
    return { runId, events, success: false, error, tokensIn, tokensOut };
  } finally {
    unregisterRunAbortController(runId);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function handleCancellation(
  interviewId: string,
  runId: string,
  eventType: "run.cancelled",
  payload: Record<string, unknown>,
): Promise<{ sseChunk: string; event: InterviewEvent } | null> {
  const result = await emitEvent({
    interviewId,
    eventType,
    payload: { ...payload, runId },
    runFailure: { runId, error: "Cancelled" },
  });

  if (!result || result.raceLost) return null;

  return {
    sseChunk: result.sseChunk,
    event: {
      version: result.version,
      type: eventType,
      payload: { ...payload, runId },
    },
  };
}

function buildSystemPrompt(profile: Record<string, unknown> | null): string {
  const profileSummary = profile
    ? `The user has the following profile data:\n${JSON.stringify(profile, null, 2)}`
    : "The user has no existing profile yet. You will build it from scratch.";

  return `You are an AI interview assistant helping the user build their professional profile.

Your job is to guide the user through building a complete profile by asking questions one at a time.
Start with personal info, then work through experience, education, skills, projects, and achievements.

Available tools:
- get_profile — Retrieve the current profile
- upsert_personal_info — Update name, headline, contact details
- add_or_merge_experience — Add or update a work experience entry
- add_or_merge_education — Add or update an education entry
- add_or_merge_skill_items — Add skills to an existing category or create a new one
- add_or_merge_project — Add or update a project entry
- add_or_merge_achievement — Add or update an achievement entry
- set_preferences — Update seniority, languages, section order

Rules:
1. Always ask one question at a time — don't overwhelm the user.
2. Use tools to persist data immediately when the user provides it.
3. If a tool returns "confirmation_required", explain the conflict to the user and wait for their response.
4. Be conversational and encouraging.
5. When you have enough information, ask if they'd like to review and finalize.

${profileSummary}`;
}

// Import needed for type reference
import type { ToolContext } from "./tools";
