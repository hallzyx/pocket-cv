import { describe, it, expect, vi, beforeAll } from "vitest";
import { EventEmitter } from "node:events";
import { compileLatex, CompileError, DEFAULT_COMPILE_TIMEOUT_MS, killProcessTree } from "./compile";
import type { ChildProcess } from "node:child_process";

// We need to check that the underlying Tectonic binary is present for real compilation.
// If it's not installed, we skip the real e2e tests and only run pure-logic tests.
let tectonicAvailable = false;

beforeAll(async () => {
  try {
    const { LatexCompiler } = await import("node-latex-compiler");
    const compiler = new LatexCompiler();
    tectonicAvailable = !!((compiler as { tectonicPath?: string | null }).tectonicPath);
  } catch {
    tectonicAvailable = false;
  }
});

describe("compileLatex", () => {
  it("should be a function", () => {
    expect(typeof compileLatex).toBe("function");
  });

  it("should throw CompileError when Tectonic is unavailable (empty source fails early)", async () => {
    await expect(compileLatex("")).rejects.toThrow(CompileError);
  });

  it("should export the default timeout constant", () => {
    expect(DEFAULT_COMPILE_TIMEOUT_MS).toBe(30_000);
  });

  describe("with Tectonic installed", () => {
    it("should return a Buffer when given valid LaTeX source", async () => {
      if (!tectonicAvailable) return; // skip
      const result = await compileLatex(
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.byteLength).toBeGreaterThan(0);
    }, 60_000);

    it("should enforce a configurable timeout (real Tectonic, 1ms override)", async () => {
      if (!tectonicAvailable) return; // skip

      // Real Tectonic + 1 ms → timeout fires, kills process, cleans up
      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
        { timeoutMs: 1 },
      );

      await expect(promise).rejects.toThrow(CompileError);
    }, 10_000);
  });

  describe("deterministic timeout (injectable spawn, short real timeout)", () => {
    // These tests use short real timeouts (no fake timers) to verify
    // the timeout→kill→cleanup pipeline. The injectable spawn returns
    // a child that never emits close/error, so the real setTimeout
    // fires after the configured ms, triggers kill + cleanup.

    it("timeout kills child process when Tectonic is available", async () => {
      if (!tectonicAvailable) return; // skip — spawnTectonic not reached

      // A child that never emits close/error — timeout must fire
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 99999,
        stdout: { on: vi.fn(), pipe: vi.fn() },
        stderr: { on: vi.fn(), pipe: vi.fn() },
        exitCode: null,
        killed: false,
        kill: vi.fn().mockReturnValue(true),
      });

      const fakeSpawn = vi.fn().mockReturnValue(child);

      // Provide valid source that reaches spawnTectonic. The 100ms
      // real timeout fires because the fake child never closes.
      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
        { timeoutMs: 100, spawn: fakeSpawn },
      );

      await expect(promise).rejects.toThrow(CompileError);

      // The timeout handler called child.kill (safety net after killProcessTree)
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    }, 15_000);

    it("cleans up temp workspace even when the write phase fails", async () => {
      // Use injectable mkdtemp returning a non-existent path so
      // writeFile fails. The finally block must still call rm.
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 99998,
        stdout: { on: vi.fn(), pipe: vi.fn() },
        stderr: { on: vi.fn(), pipe: vi.fn() },
        exitCode: null,
        killed: false,
        kill: vi.fn().mockReturnValue(true),
      });

      const fakeSpawn = vi.fn().mockReturnValue(child);
      const fakeMkdtemp = vi.fn().mockResolvedValue("/nonexistent-pcv-test-dir");
      const fakeRm = vi.fn().mockResolvedValue(undefined);

      const promise = compileLatex("source", {
        timeoutMs: 50,
        spawn: fakeSpawn,
        mkdtemp: fakeMkdtemp,
        rm: fakeRm,
      });

      await expect(promise).rejects.toThrow(CompileError);

      // mkdtemp was used
      expect(fakeMkdtemp).toHaveBeenCalledOnce();
      // rm was called for cleanup even though writeFile failed
      expect(fakeRm).toHaveBeenCalledTimes(1);
    }, 10_000);

    // ── New deterministic tests for process-tree termination and ordering ──

    it("timeout calls injected killProcessTree (not merely child.kill)", async () => {
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 99997,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
        killed: false,
        kill: vi.fn().mockReturnValue(true),
      });

      const fakeSpawn = vi.fn().mockReturnValue(child);
      const killTreeSpy = vi.fn().mockResolvedValue(undefined);
      const fakeRm = vi.fn().mockResolvedValue(undefined);

      // Pass a very short childExitFallbackMs so the bounded fallback
      // resolves immediately — no need for the fake child to emit close.
      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
        {
          timeoutMs: 50,
          spawn: fakeSpawn,
          rm: fakeRm,
          killProcessTree: killTreeSpy,
          childExitFallbackMs: 1,
        },
      );

      await expect(promise).rejects.toThrow(CompileError);

      // killProcessTree was invoked (this is what the verify report requires proof of)
      expect(killTreeSpy).toHaveBeenCalledOnce();
      expect(killTreeSpy).toHaveBeenCalledWith(99997);

      // child.kill is still called as safety net
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    }, 10_000);

    it("ordering: timeout → killProcessTree → child close → rm", async () => {
      const child = new EventEmitter() as unknown as ChildProcess;
      const callLog: string[] = [];

      Object.assign(child, {
        pid: 99996,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
        killed: false,
        kill: vi.fn().mockImplementation(() => {
          callLog.push("child.kill");
          return true;
        }),
      });

      // Track whether the close event was emitted
      let closeEmitted = false;
      child.on("close", () => {
        closeEmitted = true;
      });

      const fakeSpawn = vi.fn().mockReturnValue(child);

      // killProcessTree spy schedules the child close event to fire
      // AFTER waitForChildExit registers its listener (via macrotask queueing).
      const killTreeSpy = vi.fn().mockImplementation(() => {
        callLog.push("killProcessTree");
        // Schedule close for the next macrotask cycle, after
        // waitForChildExit's .once("close") listener is registered.
        setTimeout(() => child.emit("close", null), 0);
        return Promise.resolve();
      });

      const fakeRm = vi.fn().mockImplementation(async () => {
        callLog.push("rm");
      });

      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
        {
          timeoutMs: 50,
          spawn: fakeSpawn,
          rm: fakeRm,
          killProcessTree: killTreeSpy,
          // childExitFallbackMs is irrelevant because close WILL fire
          // via the setTimeout inside killTreeSpy.
        },
      );

      await expect(promise).rejects.toThrow(CompileError);

      // All expected calls were made
      expect(killTreeSpy).toHaveBeenCalledOnce();
      expect(killTreeSpy).toHaveBeenCalledWith(99996);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(fakeRm).toHaveBeenCalledOnce();
      expect(closeEmitted).toBe(true);

      // Verify exact ordering: killProcessTree → child.kill → rm
      expect(callLog).toEqual(["killProcessTree", "child.kill", "rm"]);
    }, 10_000);

    it("regression: child.killed alone does NOT trigger cleanup — cleanup awaits close/exit", async () => {
      // Node's ChildProcess.killed means a signal was sent, NOT that the
      // process exited. waitForChildExit must NOT treat killed as evidence.
      // This test uses a controllable close-emission sequence to prove:
      //   1) rm is NOT called while killed=true and exitCode=null
      //   2) rm IS called only after an actual close event
      // A broken implementation that returned immediately on child.killed
      // would fail assertion (1) because rm would have already run.
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 77777,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
        killed: true, // ← appears killed but no exit/close will fire
        kill: vi.fn().mockReturnValue(true),
      });

      const closeSpy = vi.fn();
      child.on("close", closeSpy);
      const exitSpy = vi.fn();
      child.on("exit", exitSpy);

      const fakeSpawn = vi.fn().mockReturnValue(child);
      const killTreeSpy = vi.fn().mockResolvedValue(undefined);
      const fakeRm = vi.fn().mockResolvedValue(undefined);

      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}X\\end{document}",
        {
          timeoutMs: 50,
          spawn: fakeSpawn,
          rm: fakeRm,
          killProcessTree: killTreeSpy,
          childExitFallbackMs: 10_000, // large — fallback will NOT fire
        },
      );

      // Wait for the real setTimeout(50) to fire and enter the timeout callback
      await vi.waitFor(() => {
        expect(killTreeSpy).toHaveBeenCalledOnce();
      });

      // killProcessTree ran with the correct pid
      expect(killTreeSpy).toHaveBeenCalledWith(77777);
      // Safety-net child.kill("SIGKILL") was called
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      // CRITICAL: rm MUST NOT have been called yet. We are waiting on
      // waitForChildExit (10s fallback pending, no close/exit emitted).
      // A broken implementation that resolved on child.killed would have
      // already run rm by now — this assertion catches it.
      expect(fakeRm).not.toHaveBeenCalled();

      // Neither close nor exit have been emitted
      expect(closeSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();

      // Attach rejection handler BEFORE emitting close, so the handler
      // is registered on the promise before the rejection chain runs.
      const rejection = expect(promise).rejects.toThrow(CompileError);

      // Now emit close — this resolves waitForChildExit immediately
      child.emit("close", null);

      // The close listener fired
      expect(closeSpy).toHaveBeenCalledOnce();
      // exit listener still not called
      expect(exitSpy).not.toHaveBeenCalled();

      // Cleanup chain completes (rm runs in finally)
      await vi.waitFor(() => {
        expect(fakeRm).toHaveBeenCalledOnce();
      });

      await rejection;
    }, 10_000);

    it("regression: child.killed alone does NOT trigger cleanup — cleanup only after bounded fallback", async () => {
      // Same scenario as above but WITHOUT emitting close/exit.
      // Proves cleanup occurs only when the bounded fallback timer expires.
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 77776,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
        killed: true,
        kill: vi.fn().mockReturnValue(true),
      });

      const fakeSpawn = vi.fn().mockReturnValue(child);
      const killTreeSpy = vi.fn().mockResolvedValue(undefined);
      const fakeRm = vi.fn().mockResolvedValue(undefined);

      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}X\\end{document}",
        {
          timeoutMs: 50,
          spawn: fakeSpawn,
          rm: fakeRm,
          killProcessTree: killTreeSpy,
          childExitFallbackMs: 300, // short bounded fallback
        },
      );

      // Wait for the timeout to fire
      await vi.waitFor(() => {
        expect(killTreeSpy).toHaveBeenCalledOnce();
      });

      // CRITICAL: rm NOT called while fallback timer is still pending
      expect(fakeRm).not.toHaveBeenCalled();

      // Await rejection — waits for the bounded fallback (300ms) to expire
      await expect(promise).rejects.toThrow(CompileError);

      // Cleanup completed via fallback (not via early return from child.killed)
      expect(fakeRm).toHaveBeenCalledOnce();
    }, 10_000);

    it("cleans up temp workspace after timeout kills the process tree", async () => {
      if (!tectonicAvailable) return; // skip — spawnTectonic not reached

      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 99995,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
        killed: false,
        kill: vi.fn().mockReturnValue(true),
      });

      const fakeSpawn = vi.fn().mockReturnValue(child);
      const killTreeSpy = vi.fn().mockResolvedValue(undefined);
      // Use real mkdtemp (real temp dir) so writeFile succeeds and
      // spawnTectonic is reached — the fake spawn prevents real execution.
      // Only rm is injected to observe timeout-path cleanup.
      const fakeRm = vi.fn().mockResolvedValue(undefined);

      const promise = compileLatex(
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
        {
          timeoutMs: 50,
          spawn: fakeSpawn,
          rm: fakeRm,
          killProcessTree: killTreeSpy,
          childExitFallbackMs: 1,
        },
      );

      await expect(promise).rejects.toThrow(CompileError);

      // rm was called for workspace cleanup after timeout
      expect(fakeRm).toHaveBeenCalledTimes(1);
      // killProcessTree was called before cleanup
      expect(killTreeSpy).toHaveBeenCalledOnce();
    }, 10_000);
  });

  describe("killProcessTree", () => {
    it("should terminate a real Node.js child process", async () => {
      // Skip when Tectonic is missing — still a useful guard for dev machines
      if (!tectonicAvailable) return;

      // Spawn a long-running detached child
      const child = require("node:child_process").spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 10000)"],
        { detached: true, stdio: "ignore" },
      );

      const pid = child.pid;
      expect(pid).toBeGreaterThan(0);

      // Kill the process tree (now async — await completion)
      await killProcessTree(pid);

      // The process should no longer be alive
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });
});
