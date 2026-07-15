// ---------------------------------------------------------------------------
// M2 Interview Agent — core type definitions
//
// These types define the provider abstraction, tool results, event log
// entries, and SSE wire format. They intentionally use plain interfaces
// rather than Zod so that Zod-only concerns stay in tools.ts.
// ---------------------------------------------------------------------------

/** Provider event yielded by ChatProvider.stream() */
export type ProviderEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "error" | "cancelled" }
  | { type: "metadata"; responseId?: string; tokensIn?: number; tokensOut?: number };

/** Result of executing a single tool against the profile */
export type ToolResult = {
  status: "applied" | "confirmation_required" | "validation_error";
  data?: unknown;
  error?: string;
  /** Normalized fingerprint used for dedup, if applicable */
  fingerprint?: string;
  /** Human-readable description of what was done for the event log */
  summary?: string;
};

/** Durable event persisted in interview_events */
export type InterviewEvent = {
  version: number;
  type:
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "profile.updated"
    | "run.completed"
    | "run.failed"
    | "run.cancelled"
    | "done";
  payload: Record<string, unknown>;
};

/** Input to the agent loop */
export type AgentInput = {
  interviewId: string;
  userId: string;
  message: string;
  transcript: InterviewMessage[];
  transcriptVersion: number;
  profile: Record<string, unknown> | null;
};

/** Message format within the transcript (mirrors existing InterviewMessage) */
export type InterviewMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  level?: "critical" | "optional";
  timestamp: string;
};

/** Chat provider contract — abstract over any LLM API */
export interface ChatProvider {
  stream(
    input: ChatInput,
    options: { signal: AbortSignal },
  ): AsyncIterable<ProviderEvent>;
  /** Validate that the configured model is available. Throws if unavailable. */
  validateModel(): Promise<void>;
  /** The model identifier this provider is configured for */
  readonly model: string;
}

/** Input to ChatProvider.stream() */
export type ChatInput = {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  maxTokens?: number;
  temperature?: number;
};

/** SSE frame (raw wire format, before JSON) */
export type SseFrame = {
  event: string;
  data: string;
};

/**
 * Configuration limits for the agent loop.
 * These are concrete bounds from the M2 design document.
 */
export const AGENT_LIMITS = {
  /** Maximum tool calls per agent run */
  maxToolCalls: 6,
  /** Maximum user message length */
  maxUserChars: 8_000,
  /** Maximum transcript messages to include in context (newest first) */
  maxTranscriptMessages: 100,
  /** Maximum transcript characters to include in context */
  maxTranscriptChars: 100_000,
  /** Turn timeout in milliseconds */
  turnTimeoutMs: 60_000,
  /** Number of provider retries before marking run failed */
  maxRetries: 1,
} as const;

/**
 * Event type strings used in SSE and the event log.
 * Canonical list — keep in sync with InterviewEvent['type'].
 */
export const EVENT_TYPES = [
  "message.delta",
  "tool.started",
  "tool.completed",
  "profile.updated",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "done",
] as const;
