import { spawn, execSync } from "node:child_process";
import type { SpawnOptions, ChildProcess } from "node:child_process";
import { platform } from "node:os";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export class CompileError extends Error {
  constructor(
    message: string,
    public readonly log?: string,
  ) {
    super(message);
    this.name = "CompileError";
  }
}

// ── Injectable boundary types (for testing) ──

export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type MkdtempFunction = (prefix: string) => Promise<string>;

export type RmFunction = (
  path: string,
  options?: { recursive?: boolean; force?: boolean },
) => Promise<void>;

export interface CompileLatexOptions {
  /** Custom timeout in ms (default: 30s). */
  timeoutMs?: number;
  /** Override spawn for testing. */
  spawn?: SpawnFunction;
  /** Override mkdtemp for testing. */
  mkdtemp?: MkdtempFunction;
  /** Override rm for testing. */
  rm?: RmFunction;
  /** Override killProcessTree for testing. */
  killProcessTree?: (pid: number) => Promise<void>;
  /**
   * Override the bounded fallback for waitForChildExit (default: 1000ms).
   * Only used in tests to avoid long fallback delays.
   */
  childExitFallbackMs?: number;
}

/**
 * Default timeout for LaTeX compilation (30 seconds).
 * Overridable per-call via `compileLatex(tex, { timeoutMs })`.
 */
export const DEFAULT_COMPILE_TIMEOUT_MS = 30_000;

// ── Process-tree termination ──

/**
 * Kill a process and its complete descendant tree.
 *
 * - On Windows: uses `taskkill /T /F` for reliable tree termination.
 * - On POSIX: uses `process.kill(-pid)` to kill the process group
 *   (requires `detached: true` when spawning).
 *
 * Errors are swallowed — the function is best-effort.
 * Returns a Promise so callers can `await` the termination command completion.
 */
export async function killProcessTree(pid: number): Promise<void> {
  try {
    if (platform() === "win32") {
      execSync(`taskkill /T /F /PID ${pid}`, {
        stdio: "ignore",
        timeout: 5000,
      });
    } else {
      // Negative PID = process group
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Already terminated or permission denied — best effort
  }
}

/**
 * Default bounded fallback for waitForChildExit (1 second).
 * Short timeout to avoid hanging forever if the child never emits close/exit.
 */
const CHILD_EXIT_FALLBACK_MS = 1_000;

/**
 * Wait for a child process to emit `close` or `exit`, with a bounded
 * fallback timeout so we never hang indefinitely.
 *
 * If the child has already exited (exitCode !== null), resolves immediately.
 * NOTE: child.killed is NOT sufficient — it only means a signal was sent.
 */
function waitForChildExit(
  child: ChildProcess,
  fallbackMs = CHILD_EXIT_FALLBACK_MS,
): Promise<void> {
  return new Promise<void>((resolve) => {
    // Already exited — resolve immediately.
    // NOTE: child.killed is NOT sufficient evidence. In Node.js it only means
    // a signal was sent, not that the process has emitted close/exit.
    // Only child.exitCode confirms actual process termination.
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => resolve(), fallbackMs);

    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Result from the internal spawn wrapper.
 */
interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run tectonic via child_process.spawn with a configurable timeout.
 * On timeout, kills the entire process tree and throws.
 */
function spawnTectonic(
  tectonicPath: string,
  texPath: string,
  outputDir: string,
  timeoutMs: number,
  spawnFn?: SpawnFunction,
  killProcessTreeFn?: (pid: number) => Promise<void>,
  childExitFallbackMs?: number,
): Promise<SpawnResult> {
  const doSpawn = spawnFn ?? spawn;
  const doKillTree = killProcessTreeFn ?? killProcessTree;
  const exitFallback = childExitFallbackMs ?? CHILD_EXIT_FALLBACK_MS;

  return new Promise((resolve, reject) => {
    const child = doSpawn(tectonicPath, [texPath, `--outdir=${outputDir}`], {
      stdio: ["ignore", "pipe", "pipe"],
      // detached: true creates a new process group
      // so kill(-pid) works on POSIX and taskkill /T works on Windows
      detached: true,
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (timedOut) return; // already rejected
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on("error", (err) => {
      if (timedOut) return; // already rejected
      reject(err);
    });

    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      const timer = setTimeout(async () => {
        timedOut = true;

        if (child.pid) {
          // 1. Full process-tree termination (await completion)
          await doKillTree(child.pid);

          // 2. Safety net on direct child
          try {
            child.kill("SIGKILL");
          } catch {
            // Already terminated
          }

          // 3. Await child close/exit confirmation (bounded fallback)
          await waitForChildExit(child, exitFallback);
        }

        reject(
          new CompileError(
            `Compilation timed out after ${timeoutMs}ms`,
            stderr,
          ),
        );
      }, timeoutMs);

      // Clean up timer if child exits before timeout
      child.on("close", () => clearTimeout(timer));
      child.on("error", () => clearTimeout(timer));
    }
  });
}

/**
 * Compile a LaTeX source string into a PDF Buffer using Tectonic directly.
 *
 * Uses `child_process.spawn` so the process can be killed on timeout.
 * The temp directory is cleaned up after compilation regardless of outcome.
 *
 * @param texSource  Raw LaTeX source.
 * @param opts       Optional overrides — see `CompileLatexOptions`.
 */
export async function compileLatex(
  texSource: string,
  opts?: CompileLatexOptions,
): Promise<Buffer> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS;
  const mkdtempFn = opts?.mkdtemp ?? mkdtemp;
  const rmFn = opts?.rm ?? rm;
  const killProcessTreeFn = opts?.killProcessTree;
  const childExitFallbackMs = opts?.childExitFallbackMs;

  const tmpDir = await mkdtempFn(join(tmpdir(), "pocketcv-latex-"));

  try {
    // Write source to a temp .tex file
    const texPath = join(tmpDir, "input.tex");
    await writeFile(texPath, texSource, "utf-8");

    // Resolve Tectonic binary via node-latex-compiler's platform resolver.
    // tectonicPath is a runtime property not exposed in the public types.
    const { LatexCompiler } = await import("node-latex-compiler");
    const compiler = new LatexCompiler();
    const tectonicPath = (compiler as { tectonicPath?: string | null }).tectonicPath ?? null;

    if (!tectonicPath) {
      throw new CompileError(
        "Tectonic executable not found. Run 'npx node-latex-compiler' or install @node-latex-compiler/bin-* for your platform.",
      );
    }

    const result = await spawnTectonic(
      tectonicPath,
      texPath,
      tmpDir,
      timeoutMs,
      opts?.spawn,
      killProcessTreeFn,
      childExitFallbackMs,
    );

    if (result.exitCode !== 0) {
      throw new CompileError(
        `Tectonic exited with code ${result.exitCode ?? -1}`,
        result.stderr || result.stdout,
      );
    }

    // Read generated PDF
    const pdfPath = join(tmpDir, "input.pdf");
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await readFile(pdfPath);
    } catch {
      throw new CompileError("Compilation produced no PDF output", result.stderr);
    }

    if (pdfBuffer.byteLength === 0) {
      throw new CompileError("Compilation produced empty PDF", result.stderr);
    }

    return pdfBuffer;
  } catch (err) {
    if (err instanceof CompileError) throw err;
    const message = err instanceof Error ? err.message : "Unknown compilation error";
    throw new CompileError(`LaTeX compilation failed: ${message}`);
  } finally {
    // Cleanup: ignore errors on temp file removal
    await rmFn(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
