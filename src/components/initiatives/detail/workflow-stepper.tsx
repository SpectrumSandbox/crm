"use client";

import { Ban, Check, CircleAlert, Gavel, Hourglass, RotateCcw, Scale } from "lucide-react";
import type { Initiative } from "@/lib/initiatives/types";
import { addBusinessDays } from "@/lib/initiatives/engine";
import { POLICY } from "@/lib/initiatives/policy";
import { cn, formatDate } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";
import { Cite, initiativeStatusMeta } from "@/components/initiatives/shared";
import { SlaTimer } from "./ui";

const STEPS: { stage: number; label: string; hint: string }[] = [
  { stage: 1, label: "Submitted", hint: "Tracking no. issued" },
  { stage: 2, label: "Screening", hint: "Day 1–2" },
  { stage: 3, label: "Evaluation", hint: "Day 2–5" },
  { stage: 4, label: "PRC decision", hint: "Day 5" },
  { stage: 5, label: "Approved", hint: "Code & budget" },
  { stage: 6, label: "Active", hint: "Delivery" },
  { stage: 7, label: "Completed", hint: "Reconcile ≤ 30d" },
];

const branchMeta = {
  conditional: { icon: CircleAlert, color: "orange" as const, text: "Conditional approval — proceeds once the stated conditions are met" },
  deferred: { icon: Hourglass, color: "orange" as const, text: "Deferred — the PRC asked for more information or better timing; resubmission returns to evaluation" },
  rejected: { icon: Ban, color: "red" as const, text: "Rejected — the initiator may appeal to the Executive Committee within 10 business days" },
};

/** §2.3 approval workflow with SLA timers and decision branches. */
export function WorkflowStepper({ ini }: { ini: Initiative }) {
  const meta = initiativeStatusMeta[ini.status];
  const current = meta.stage;
  const branch = ini.status === "conditional" || ini.status === "deferred" || ini.status === "rejected" ? branchMeta[ini.status] : null;
  const ackDue = ini.submittedAt ? addBusinessDays(ini.submittedAt, POLICY.sla.acknowledgeBusinessDays) : null;
  const decisionDue = ini.submittedAt ? addBusinessDays(ini.submittedAt, POLICY.sla.decisionBusinessDays) : null;
  const appealDue = ini.appeal ? addBusinessDays(ini.appeal.filedAt, POLICY.sla.appealBusinessDays) : null;

  return (
    <div className="border-b border-sg-line bg-sg-bg px-5 py-3">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {current === 0 ? (
          <div className="mr-2 flex shrink-0 items-center gap-2 rounded-md border border-dashed border-sg-line-2 px-2.5 py-1.5 text-xs text-sg-muted">
            <span className="size-2 rounded-full bg-soft-blue" /> Draft — not yet submitted
          </div>
        ) : null}
        {STEPS.map((s, idx) => {
          const done = current > s.stage || (current === 7 && s.stage === 7);
          const here = current === s.stage && current !== 7;
          const isDecision = s.stage === 4;
          const branchHere = isDecision && branch;
          return (
            <div key={s.stage} className="flex shrink-0 items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                  branchHere
                    ? branch.color === "red"
                      ? "border-soft-red/50 bg-soft-red/10"
                      : "border-soft-orange/50 bg-soft-orange/10"
                    : here
                      ? "border-sg-white/60 bg-sg-card-2"
                      : done
                        ? "border-sg-line bg-sg-card"
                        : "border-sg-line/60 bg-transparent",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    branchHere ? (branch.color === "red" ? "bg-soft-red text-sg-bg" : "bg-soft-orange text-sg-bg") : done ? "bg-soft-green text-sg-bg" : here ? "bg-sg-white text-sg-bg" : "border border-sg-line-2 text-sg-dim",
                  )}
                >
                  {branchHere ? <branch.icon className="size-3" /> : done ? <Check className="size-3" /> : s.stage}
                </span>
                <div className="leading-tight">
                  <div className={cn("text-xs font-semibold", here || done || branchHere ? "text-sg-white" : "text-sg-muted")}>{branchHere ? meta.label : s.label}</div>
                  <div className="text-[10px] text-sg-dim">{s.hint}</div>
                </div>
              </div>
              {idx < STEPS.length - 1 ? <span className={cn("h-px w-4 shrink-0", current > s.stage ? "bg-soft-green/60" : "bg-sg-line")} /> : null}
            </div>
          );
        })}
        <Cite s="2.3" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1.5">
        {ackDue ? <SlaTimer label="Acknowledgment" dueIso={ackDue} doneIso={ini.acknowledgedAt} cite="2.3.2" /> : null}
        {decisionDue ? <SlaTimer label="PRC decision" dueIso={decisionDue} doneIso={ini.decision?.decidedAt ?? (current >= 5 ? ini.approvedAt : null)} cite="2.3.4" /> : null}
        {!ini.submittedAt ? <span className="text-xs text-sg-dim">SLA timers start when the proposal is submitted: acknowledgment in 1 business day, decision in 5.</span> : null}
        {branch ? (
          <span className="flex items-center gap-1.5 text-xs text-sg-muted">
            <Chip color={branch.color}>{meta.label}</Chip> {branch.text}
            {ini.status === "conditional" && ini.decision?.conditionsDueAt ? <span className="text-sg-text">· conditions due {formatDate(ini.decision.conditionsDueAt, "medium")}</span> : null}
          </span>
        ) : null}
      </div>

      {ini.appeal && appealDue ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-sg-line bg-sg-card px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-sg-white">
            <Scale className="size-3.5 text-soft-magenta" /> Appeal to the Executive Committee <Cite s="2.3.7" />
          </span>
          <Chip color={ini.appeal.status === "pending" ? "yellow" : ini.appeal.status === "upheld" ? "green" : "red"} dot>
            {ini.appeal.status === "pending" ? "Pending" : ini.appeal.status === "upheld" ? "Upheld — back to evaluation" : "Denied"}
          </Chip>
          <span className="text-sg-muted">
            Filed <span className="text-sg-text">{formatDate(ini.appeal.filedAt, "medium")}</span>
          </span>
          {ini.appeal.status === "pending" ? <SlaTimer label="Committee decision" dueIso={appealDue} doneIso={ini.appeal.decidedAt} /> : <span className="text-sg-muted">Decided {formatDate(ini.appeal.decidedAt, "medium")}</span>}
          <span className="flex min-w-0 items-center gap-1 text-sg-muted">
            {ini.appeal.status === "pending" ? <Gavel className="size-3" /> : <RotateCcw className="size-3" />}
            <span className="truncate" title={ini.appeal.reason}>
              “{ini.appeal.reason}”
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
