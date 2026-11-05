/*
 * Pure deal helpers (no React): WIB calendar-day countdowns, rotting thresholds, next step, forecast categories,
 * origination evidence (Policy v4.0 §4.1) and deal-name prefixes. Amounts parse with parseIDR, days with daysFromNow (utils).
 */
import type { Activity, Company, Deal, DealOrigination, ForecastCategory, PipelineStage, SpectrumColor } from "../../lib/types";
import { daysFromNow, dueLabel } from "../../lib/utils";

const WIB = 7 * 3_600_000;

/* ───────────── rotting & next step ───────────── */

/** default idle thresholds (days) per stage — Pipedrive-style "rotting in" */
const DEFAULT_ROTTING: Record<string, number> = {
  "st-discovery": 21,
  "st-qualified": 14,
  "st-solution": 14,
  "st-proposal": 10,
  "st-negotiation": 7,
  "st-r-review": 21,
  "st-r-proposal": 14,
  "st-r-contract": 10,
};

export function rottingThreshold(stage: Pick<PipelineStage, "id" | "rottingDays" | "probability"> | undefined) {
  if (!stage) return 14;
  if (stage.rottingDays && stage.rottingDays > 0) return stage.rottingDays;
  return DEFAULT_ROTTING[stage.id] ?? (stage.probability >= 0.6 ? 10 : 14);
}

export interface DealActivitySignals {
  /** newest activity linked to the deal (any type except automatic Jira mirrors) */
  lastActivityAt: string | null;
  /** earliest open task linked to the deal */
  nextTask: Activity | null;
  openTasks: number;
}

/** one pass over the activities: deal id → last touch + next open task */
export function dealActivityIndex(activities: Activity[]): Map<string, DealActivitySignals> {
  const m = new Map<string, DealActivitySignals>();
  for (const a of activities) {
    for (const dealId of a.links.dealIds) {
      const cur = m.get(dealId) ?? { lastActivityAt: null, nextTask: null, openTasks: 0 };
      const isOpenTask = a.type === "task" && !a.done;
      if (a.type !== "jira" && !isOpenTask && (!cur.lastActivityAt || a.timestamp > cur.lastActivityAt)) cur.lastActivityAt = a.timestamp;
      if (isOpenTask) {
        cur.openTasks += 1;
        const due = a.dueAt ?? a.timestamp;
        if (!cur.nextTask || due < (cur.nextTask.dueAt ?? cur.nextTask.timestamp)) cur.nextTask = a;
      }
      m.set(dealId, cur);
    }
  }
  return m;
}

/** idle days = since the latest of (last activity, stage entry), in WIB days */
export function idleDays(deal: Pick<Deal, "stageEnteredAt">, sig: DealActivitySignals | undefined, now = Date.now()) {
  const last = [sig?.lastActivityAt, deal.stageEnteredAt].filter(Boolean).sort().pop() ?? deal.stageEnteredAt;
  return Math.max(0, -(daysFromNow(last, now) || 0));
}

export function isRotting(deal: Pick<Deal, "stageEnteredAt">, stage: PipelineStage | undefined, sig: DealActivitySignals | undefined, now = Date.now()) {
  if (!stage || stage.closed) return false;
  return idleDays(deal, sig, now) > rottingThreshold(stage);
}

export type NextStepState = { tone: "green" | "red" | "yellow"; label: string; task: Activity | null };

export function nextStepOf(sig: DealActivitySignals | undefined, now = Date.now()): NextStepState {
  const t = sig?.nextTask ?? null;
  if (!t) return { tone: "yellow", label: "No next step", task: null };
  const due = t.dueAt ?? t.timestamp;
  const overdue = Date.parse(due) < now;
  return { tone: overdue ? "red" : "green", label: `${t.subject} · ${dueLabel(due, now)}`, task: t };
}

/* ───────────── forecast categories ───────────── */

export const FORECAST_META: Record<ForecastCategory, { label: string; color: SpectrumColor; hint: string }> = {
  commit: { label: "Commit", color: "green", hint: "Owner is confident it closes in the period" },
  best_case: { label: "Best case", color: "cyan", hint: "Could close if things go well" },
  pipeline: { label: "Pipeline", color: "blue", hint: "Open, not yet forecastable" },
  omitted: { label: "Omitted", color: "red", hint: "Excluded from the forecast" },
};
export const FORECAST_ORDER: ForecastCategory[] = ["commit", "best_case", "pipeline", "omitted"];

export function defaultForecast(stage: Pick<PipelineStage, "probability" | "closed"> | undefined): ForecastCategory {
  if (!stage) return "pipeline";
  if (stage.closed === "lost") return "omitted";
  if (stage.closed === "won" || stage.probability >= 0.8) return "commit";
  if (stage.probability >= 0.4) return "best_case";
  return "pipeline";
}

export function forecastOf(deal: Pick<Deal, "forecastCategory">, stage: Pick<PipelineStage, "probability" | "closed"> | undefined): ForecastCategory {
  return deal.forecastCategory ?? defaultForecast(stage);
}

/** WIB month key yyyy-mm of an ISO date */
export function wibMonthKey(iso: string) {
  return new Date(Date.parse(iso) + WIB).toISOString().slice(0, 7);
}

/* ───────────── won / lost ───────────── */

export const LOST_REASONS = ["Price", "Lost to competitor", "Budget cut or postponed", "Technical fit", "Tender disqualified", "No decision", "Timing", "Other"] as const;
export const WIN_REASONS = ["Technical solution", "Relationship / trust", "Price", "Delivery time", "Local presence & support", "Track record", "Other"] as const;

/* ───────────── origination (§4.1) ───────────── */

export const ORIGINATION_SOURCES: Record<DealOrigination["channel"], { value: string; label: string }[]> = {
  personal: [
    { value: "network", label: "Own network / relationship" },
    { value: "own_idea", label: "Own idea pitched to the client" },
    { value: "event", label: "Met at an event (own initiative)" },
  ],
  follow_on: [{ value: "follow_on", label: "Follow-on scope from a client won under the policy" }],
  company: [
    { value: "website", label: "Website / email enquiry to the company" },
    { value: "tender", label: "Tender sent to the company" },
    { value: "management_referral", label: "Referral from management" },
    { value: "repeat_order", label: "Repeat order under an existing contract" },
  ],
};

export const ORIGINATION_LABEL: Record<DealOrigination["channel"], string> = {
  personal: "Personally originated",
  follow_on: "Follow-on scope",
  company: "Company channel",
};

/** earliest activity linked to the deal or its company — the main §4.1 evidence */
export function earliestEvidence(deal: Pick<Deal, "id" | "companyId">, activities: Activity[]): Activity | null {
  let best: Activity | null = null;
  for (const a of activities) {
    if (a.type === "jira") continue;
    if (!(a.links.dealIds.includes(deal.id) || (deal.companyId && a.links.companyIds.includes(deal.companyId)))) continue;
    if (!best || a.timestamp < best.timestamp) best = a;
  }
  return best;
}

/** recorded origination, or one derived from the earliest documented contact */
export function originationOf(deal: Deal, activities: Activity[]): DealOrigination & { derived: boolean } {
  if (deal.origination) return { ...deal.origination, derived: false };
  const ev = earliestEvidence(deal, activities);
  return {
    channel: deal.dealType === "Renewal" ? "company" : deal.dealType === "Expansion" ? "follow_on" : "personal",
    source: deal.dealType === "Renewal" ? "repeat_order" : deal.dealType === "Expansion" ? "follow_on" : undefined,
    originatorId: ev?.ownerId ?? deal.ownerId,
    firstContactAt: ev?.timestamp ?? null,
    evidenceActivityId: ev?.id ?? null,
    derived: true,
  };
}

/** origination is locked from Proposal Sent (probability ≥ 60 %) onwards and on closed deals */
export function originationLocks(stage: Pick<PipelineStage, "probability" | "closed"> | undefined) {
  return !!stage && (!!stage.closed || stage.probability >= 0.6);
}

/* ───────────── deal names ───────────── */

const LEGAL_WORDS = new Set(["pt", "tbk", "cv", "persero", "ud", "pd", "yayasan", "the", "and", "of", "&"]);

/** short code for a company: initials of its alphabetic words (skipping PT/Tbk/CV…), using the parent group's code */
export function companyCode(company: Pick<Company, "name" | "parentId">, companies: Pick<Company, "id" | "name" | "parentId">[]): string {
  const root = company.parentId ? companies.find((c) => c.id === company.parentId) ?? company : company;
  const base = root.name.split(/\s+[—–-]\s+/)[0];
  const words = base
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w && !LEGAL_WORDS.has(w.toLowerCase()));
  const code = words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  return code || base.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

export function composeDealName(name: string, company: Pick<Company, "name" | "parentId"> | undefined, companies: Pick<Company, "id" | "name" | "parentId">[]) {
  const n = name.trim();
  if (!n) return "";
  if (!company || /\s—\s/.test(n)) return n;
  return `${companyCode(company, companies)} — ${n}`;
}
