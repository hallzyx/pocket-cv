import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek";

const testSchema = z.object({ category: z.string() });
function mkProv() { vi.stubEnv("DEEPSEEK_API_KEY", "sk-test"); return new DeepSeekProvider(); }
function mockRes(body: Record<string, unknown>) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
}

describe("DeepSeekProvider.completeStructured", () => {
  beforeEach(() => { vi.stubEnv("DEEPSEEK_API_KEY", "sk-test"); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("1.4.1 sends configured model", async () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-reasoner");
    (fetch as any).mockResolvedValue(mockRes({ id:"r", choices:[{message:{content:'{"category":"FE"}'}}], usage:{prompt_tokens:10, completion_tokens:5} }));
    await mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema);
    expect(JSON.parse((fetch as any).mock.calls[0][1].body).model).toBe("deepseek-reasoner");
  });

  it("1.4.2 includes json_object and JSON instruction", async () => {
    (fetch as any).mockResolvedValue(mockRes({ id:"r", choices:[{message:{content:'{"category":"FE"}'}}], usage:{prompt_tokens:10, completion_tokens:5} }));
    await mkProv().completeStructured({ systemPrompt:"Return JSON only.", userPrompt:"y" }, testSchema);
    const b = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(b.response_format).toEqual({ type:"json_object" });
    expect(b.messages[0].content).toContain("JSON");
  });

  it("1.4.3 returns parsed data, ID and tokens", async () => {
    (fetch as any).mockResolvedValue(mockRes({ id:"r1", choices:[{message:{content:'{"category":"FE"}'}}], usage:{prompt_tokens:100, completion_tokens:50} }));
    const r = await mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema);
    expect(r.data).toEqual({ category:"FE" }); expect(r.responseId).toBe("r1"); expect(r.tokensIn).toBe(100); expect(r.tokensOut).toBe(50);
  });

  it("1.4.4 empty choices throws", async () => {
    (fetch as any).mockResolvedValue(mockRes({ id:"r", choices:[] }));
    await expect(mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema)).rejects.toThrow("empty response");
  });

  it("1.4.5 Zod-invalid content throws ZodError", async () => {
    (fetch as any).mockResolvedValue(mockRes({ id:"r", choices:[{message:{content:'{"name":"x"}'}}] }));
    await expect(mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema)).rejects.toThrow(z.ZodError);
  });

  it("1.4.5b malformed JSON throws ZodError with path response", async () => {
    (fetch as any).mockResolvedValue(mockRes({ id:"r2", choices:[{message:{content:"not json at all"}}], usage:{prompt_tokens:10, completion_tokens:5} }));
    const p = mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema);
    await expect(p).rejects.toThrow(z.ZodError);
    try { await p; } catch (e) {
      expect((e as z.ZodError).issues[0].path).toEqual(["response"]);
    }
  });

  it.each([
    ["missing",           {},                                         0, 0],
    ["null_usage",        { usage: null } as any,                     0, 0],
    ["bad_prompt_tokens", { usage: { prompt_tokens:"abc", completion_tokens:5 } }, 0, 5],
    ["negative_tokens",   { usage: { prompt_tokens:-1, completion_tokens:5 } },   0, 5],
    ["infinity",          { usage: { prompt_tokens:Infinity, completion_tokens:5 } }, 0, 5],
  ] as const)("1.4.6 usage %s → tokens coerced", async (_, overrides, expIn, expOut) => {
    (fetch as any).mockResolvedValue(mockRes({ id:"r", choices:[{message:{content:'{"category":"FE"}'}}], usage:{} as any, ...overrides }));
    const r = await mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema);
    expect(r.tokensIn).toBe(expIn);
    expect(r.tokensOut).toBe(expOut);
  });

  it("1.4.7 caller abort — no pending timer and fetch zero", async () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController(); ac.abort();
      const p = mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema, { signal: ac.signal });
      await expect(p).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("1.4.8 timeout cleanup", async () => {
    vi.useFakeTimers();
    try {
      (fetch as any).mockImplementation((_u: string, o: { signal?: AbortSignal }) => new Promise((_, rj) => {
        const rej = () => rj(new DOMException("Aborted", "AbortError"));
        if (o.signal?.aborted) { rej(); return; }
        o.signal?.addEventListener("abort", rej, { once: true });
      }));
      const p = mkProv().completeStructured({ systemPrompt:"x", userPrompt:"y" }, testSchema);
      const rejected = expect(p).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      await rejected;
      expect(fetch).toHaveBeenCalled();
      expect((fetch as any).mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
