"use client";

import type { AtsResult } from "@/lib/ats";

interface AtsGaugeProps {
  result: AtsResult | null;
  loading?: boolean;
}

function GaugeCircle({ score }: { score: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color =
    score < 50
      ? "stroke-red-500"
      : score < 75
        ? "stroke-amber-500"
        : "stroke-emerald-500";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="110" height="110" className="-rotate-90">
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-zinc-200 dark:text-zinc-800"
        />
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span className="absolute text-2xl font-bold tracking-tight">{score}</span>
    </div>
  );
}

function BreakdownBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = Math.round((value / max) * 100);
  const color =
    pct < 50
      ? "bg-red-500"
      : pct < 75
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </span>
        <span className="text-zinc-500">
          {value}/{max}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AtsGauge({ result, loading }: AtsGaugeProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
        <div className="animate-pulse space-y-4">
          <div className="mx-auto h-28 w-28 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 rounded bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-xl border border-black/[.08] bg-white p-5 text-center dark:border-white/[.145] dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">
          Save your CV to see the ATS score.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.145] dark:bg-zinc-950">
      <h3 className="mb-4 text-sm font-semibold">ATS Score</h3>

      <div className="flex flex-col items-center gap-4">
        <GaugeCircle score={result.score} />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          out of 100
        </span>
      </div>

      <div className="mt-5 space-y-3">
        <BreakdownBar label="Completeness" value={result.breakdown.completeness} max={40} />
        <BreakdownBar label="Impact" value={result.breakdown.impact} max={30} />
        <BreakdownBar label="Format" value={result.breakdown.format} max={20} />
        <BreakdownBar label="Keywords" value={result.breakdown.keywords} max={10} />
      </div>

      {result.suggestions.length > 0 && (
        <div className="mt-5 space-y-1.5 border-t border-black/[.06] pt-4 dark:border-white/[.1]">
          <p className="mb-2 text-xs font-semibold text-zinc-500">Suggestions</p>
          {result.suggestions.map((s, i) => (
            <p
              key={i}
              className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400"
            >
              <span className="mr-1.5 text-amber-500">→</span>
              {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
