// ---------------------------------------------------------------------------
// DeepSeek provider adapter
//
// Connects to the DeepSeek API using OpenAI-compatible endpoints.
// Model validation happens at startup/first use via GET /models.
// Streaming uses server-sent events (SSE) in OpenAI format.
//
// If the exact streaming/tool event schema differs from expectations,
// uncertainty is kept isolated in adapter tests and fails closed.
// This adapter never fabricates pricing data.
// ---------------------------------------------------------------------------

import type { ChatProvider, ChatInput, ProviderEvent } from "./types";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/** Default model to use when DEEPSEEK_MODEL is not set */
const DEFAULT_MODEL = "deepseek-chat";

export class DeepSeekProvider implements ChatProvider {
  readonly model: string;

  private apiKey: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY ?? "";
    this.model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  }

  async validateModel(): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        "DeepSeek API key not configured. Set DEEPSEEK_API_KEY in environment.",
      );
    }

    // Fetch available models to validate the configured model ID.
    // Use a controller with timeout so we don't hang on cold start.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        // If we can't reach DeepSeek or auth fails, fail closed.
        throw new Error(
          `DeepSeek model validation failed (HTTP ${res.status}). ` +
            "Check DEEPSEEK_API_KEY and network connectivity.",
        );
      }

      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const available = body.data ?? [];

      const found = available.some((m: { id: string }) => m.id === this.model);
      if (!found) {
        const ids = available.map((m: { id: string }) => m.id).join(", ");
        throw new Error(
          `DeepSeek model "${this.model}" not found in available models: ${ids}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(
    input: ChatInput,
    { signal }: { signal: AbortSignal },
  ): AsyncIterable<ProviderEvent> {
    if (!this.apiKey) {
      yield { type: "error", message: "DeepSeek API key not configured" };
      return;
    }

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        tools:
          input.tools.length > 0
            ? input.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              }))
            : undefined,
        stream: true,
        max_tokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? 0.7,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      yield {
        type: "error",
        message: `DeepSeek API error (HTTP ${response.status}): ${errorText}`,
      };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: "error", message: "DeepSeek response body is null" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            yield {
              type: "done",
              finishReason: "stop",
            };
            return;
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: {
                      name?: string;
                      arguments?: string;
                    };
                  }>;
                };
                finish_reason?: "stop" | "tool_calls" | "length" | null;
              }>;
              id?: string;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
              };
            };

            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Text delta
            if (delta?.content) {
              yield { type: "delta", content: delta.content };
            }

            // Tool call delta (OpenAI streaming format)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name && tc.function?.arguments) {
                  let args: Record<string, unknown> = {};
                  try {
                    args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
                  } catch {
                    // If the arguments are not valid JSON (can happen in streaming),
                    // we skip until a complete tool call arrives.
                    continue;
                  }
                  yield {
                    type: "tool_call",
                    id: tc.id ?? `tc-${tc.index}`,
                    name: tc.function.name,
                    arguments: args,
                  };
                }
              }
            }

            // Finish reason
            if (choice.finish_reason) {
              const fr = choice.finish_reason;
              yield {
                type: "done",
                finishReason: fr === "length" ? "error" : fr === "tool_calls" ? "tool_calls" : "stop",
              };
            }

            // Metadata (may appear on last chunk)
            if (parsed.usage) {
              yield {
                type: "metadata",
                responseId: parsed.id,
                tokensIn: parsed.usage.prompt_tokens,
                tokensOut: parsed.usage.completion_tokens,
              };
            }
          } catch {
            // Malformed JSON line — skip silently
            continue;
          }
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        yield { type: "done", finishReason: "cancelled" };
        return;
      }
      yield {
        type: "error",
        message: err instanceof Error ? err.message : "Stream error",
      };
    }
  }
}
