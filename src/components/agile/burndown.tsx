"use client";

import { useMemo } from "react";
import type { Issue, IssueHistoryEntry, Sprint } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { useCrm } from "@/lib/store";
import { computeBurndownSeries } from "@/lib/slices/agile-extras";

export interface BurndownPoint {
  day: string; // yyyy-mm-dd (WIB)
  ideal: number;
  remaining: number | null; // null for days still ahead
}

/** Burndown from recorded history (see computeBurndownSeries): done issues burn on the day they became Done. */
export function computeBurndown(sprint: Sprint, issues: Issue[], history: IssueHistoryEntry[] = [], now = Date.now()) {
  return computeBurndownSeries(sprint, issues, history, now);
}

export function Burndown({ sprint, issues, mini, className }: { sprint: Sprint; issues: Issue[]; mini?: boolean; className?: string }) {
  const history = useCrm((s) => s.issueHistory);
  const data = useMemo(() => computeBurndown(sprint, issues, history), [sprint, issues, history]);
  const { points, total, remaining, added } = data;
  const W = mini ? 120 : 560;
  const H = mini ? 34 : 180;
  const pad = mini ? { l: 1, r: 1, t: 2, b: 2 } : { l: 30, r: 10, t: 10, b: 22 };
  const max = Math.max(total, 1);
  const n = points.length;
  const x = (d: number) => pad.l + (n === 1 ? 0 : (d / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

  const idealPath = `M ${x(0)} ${y(points[0]?.ideal ?? 0)} L ${x(n - 1)} ${y(0)}`;
  const actual = points.map((p, d) => ({ d, v: p.remaining })).filter((p): p is { d: number; v: number } => p.v !== null);
  // stepped line: horizontal then vertical
  const actualPath = actual.map((p, k) => (k === 0 ? `M ${x(p.d)} ${y(p.v)}` : `H ${x(p.d)} V ${y(p.v)}`)).join(" ");
  const last = actual[actual.length - 1];
  const todayIdx = last?.d ?? -1;
  const behind = last ? last.v > (points[last.d]?.ideal ?? 0) + 0.01 : false;
  const ticks = mini ? [] : [0, Math.round(max / 2), max];
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  const summary = `${sprint.name}: ${remaining} of ${total} points remaining${last ? (behind ? ", behind the ideal line" : ", on or ahead of the ideal line") : ""}`;

  return (
    <figure className={cn("min-w-0", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className={cn("block w-full", mini ? "h-[34px]" : "h-auto")} role="img" aria-label={summary} preserveAspectRatio={mini ? "none" : "xMidYMid meet"}>
        <title>{summary}</title>
        {!mini &&
          ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--sg-line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-sg-dim" fontSize={9}>
                {t}
              </text>
            </g>
          ))}
        {!mini &&
          points.map((p, d) =>
            d % labelEvery === 0 || d === n - 1 ? (
              <text key={p.day} x={x(d)} y={H - 6} textAnchor="middle" className="fill-sg-dim" fontSize={9}>
                {formatDate(`${p.day}T05:00:00Z`, "short")}
              </text>
            ) : null,
          )}
        {todayIdx >= 0 && todayIdx < n - 1 && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" className="text-sg-dim" />}
        <path d={idealPath} fill="none" stroke="currentColor" strokeWidth={mini ? 1 : 1.5} strokeDasharray="4 4" className="text-sg-muted" vectorEffect="non-scaling-stroke" />
        {actualPath && <path d={actualPath} fill="none" stroke="currentColor" strokeWidth={mini ? 1.5 : 2} className={behind ? "text-soft-orange" : "text-soft-cyan"} vectorEffect="non-scaling-stroke" />}
        {!mini && last && <circle cx={x(last.d)} cy={y(last.v)} r={3} className={behind ? "fill-soft-orange" : "fill-soft-cyan"} />}
      </svg>
      {!mini && (
        <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-sg-dim">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0 w-4 border-t border-dashed border-sg-muted" /> Ideal
          </span>
          <span className="flex items-center gap-1">
            <span className={cn("inline-block h-0 w-4 border-t-2", behind ? "border-soft-orange" : "border-soft-cyan")} /> Remaining ({remaining} pts)
          </span>
          {added > 0 && <span className="text-soft-orange">+{added} pts added after the start</span>}
          <span className="ml-auto italic">From recorded status changes — work burns on the day it moved to Done.</span>
        </figcaption>
      )}
    </figure>
  );
}
