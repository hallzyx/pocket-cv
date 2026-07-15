"use client";

import { useState, useRef, useCallback } from "react";

interface EditorPreviewProps {
  texSource: string;
  loading?: boolean;
}

/**
 * Very basic LaTeX syntax highlighting.
 * Commands ( \command ) → blue, comments ( % ) → gray.
 */
function highlightLatex(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    // Comment (full line or after command)
    const commentIdx = remaining.indexOf("%");
    if (commentIdx >= 0) {
      // Anything before the % is regular text
      if (commentIdx > 0) {
        const before = remaining.slice(0, commentIdx);
        nodes.push(...highlightCommands(before));
      }
      nodes.push(
        <span key={nodes.length} className="text-zinc-400 dark:text-zinc-600">
          {remaining.slice(commentIdx)}
        </span>,
      );
      break;
    }

    // No comment, just highlight commands
    nodes.push(...highlightCommands(remaining));
    break;
  }

  return nodes;
}

function highlightCommands(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(\\[a-zA-Z]+(?:\{[^}]*\})?)/g);

  for (const part of parts) {
    if (part.startsWith("\\")) {
      nodes.push(
        <span key={nodes.length} className="text-blue-600 dark:text-blue-400">
          {part}
        </span>,
      );
    } else if (part.trim()) {
      nodes.push(<span key={nodes.length}>{part}</span>);
    } else {
      nodes.push(<span key={nodes.length}>{part}</span>);
    }
  }

  return nodes;
}

export function EditorPreview({ texSource, loading }: EditorPreviewProps) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const lines = texSource.split("\n");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(texSource);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = texSource;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [texSource]);

  if (loading) {
    return (
      <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-zinc-200 dark:bg-zinc-800"
              style={{ width: `${40 + Math.random() * 60}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/[.06] px-4 py-2.5 dark:border-white/[.1]">
        <h3 className="text-sm font-semibold">LaTeX Preview</h3>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg border border-black/[.1] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Code */}
      <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
        <pre
          ref={preRef}
          className="flex p-4 font-mono text-xs leading-relaxed"
        >
          {/* Line numbers */}
          <span className="mr-4 select-none text-right text-zinc-300 dark:text-zinc-700">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </span>

          {/* Code content */}
          <span className="text-zinc-800 dark:text-zinc-200">
            {lines.map((line, i) => (
              <div key={i}>{highlightLatex(line)}</div>
            ))}
          </span>
        </pre>
      </div>
    </div>
  );
}
