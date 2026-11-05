/* Pure report helpers (W10): WIB periods, deal close/stage history, issue cycle times, small statistics. */
import type { Activity, Deal, DealChange, Issue, IssueHistoryEntry, PipelineStage } from "@/lib/types";

export const WIB = 7 * 3_600_000;
export const DAY = 86_400_000;

/* ───────────── periods (WIB) ───────────── */

export interface Period {
  key: string;
  label: string;
  from: number;
  to: number;
}

const wibParts = (ms: number) => {
  const d = new Date(ms + WIB);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
};
const wibStart = (y: number, m: number) => Date.UTC(y, m, 1) - WIB;

export function quarterKey(ms: number) {
  const { y, m } = wibParts(ms);
  return `${y}-Q${Math.floor(m / 3) + 1}`;
}

export function quarterPeriod(key: string): Period {
  const [ys, qs] = key.split("-Q");
  const y = Number(ys);
  const q = Number(qs) - 1;
  return { key, label: `Q${q + 1} ${y}`, from: wibStart(y, q * 3), to: wibStart(y, q * 3 + 3) - 1 };
}

export function monthPeriod(key: string): Period {
  const [y, m] = key.split("-").map(Number);
  const from = wibStart(y, m - 1);
  return { key, label: new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1))), from, to: wibStart(y, m) - 1 };
}

export function monthsOfQuarter(key: string) {
  const [ys, qs] = key.split("-Q");
  const q = Number(qs) - 1;
  return [0, 1, 2].map((i) => `${ys}-${String(q * 3 + i + 1).padStart(2, "0")}`);
}

export function shiftQuarter(key: string, n: number) {
  const [ys, qs] = key.split("-Q");
  const idx = Number(ys) * 4 + Number(qs) - 1 + n;
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
}

/** Period presets for filters: this / last quarter, year to date, last 12 months, all time. */
export function periodPresets(now = Date.now()): Period[] {
  const q = quarterKey(now);
  const { y } = wibParts(now);
  return [
    { ...quarterPeriod(q), key: "this-q", label: `This quarter (${quarterPeriod(q).label})` },
    { ...quarterPeriod(shiftQuarter(q, -1)), key: "last-q", label: `Last quarter (${quarterPeriod(shiftQuarter(q, -1)).label})` },
    { key: "ytd", label: `${y} to date`, from: wibStart(y, 0), to: now },
    { key: "12m", label: "Last 12 months", from: now - 365 * DAY, to: now },
    { key: "all", label: "All time", from: 0, to: Number.MAX_SAFE_INTEGER },
  ];
}

export const inPeriod = (iso: string | null | undefined, p: Period) => !!iso && Date.parse(iso) >= p.from && Date.parse(iso) <= p.to;

/* ───────────── deals ───────────── */

/** When a closed deal closed: the last move into a closed stage (deal history), else the time it entered its stage. */
export function closedAtOf(deal: Deal, stage: PipelineStage | undefined, history: DealChange[]): string | null {
  if (!stage?.closed) return null;
  let best: string | null = null;
  for (const h of history) if (h.dealId === deal.id && h.field === "stageId" && h.to === deal.stageId && (!best || h.at > best)) best = h.at;
  return best ?? deal.stageEnteredAt;
}

/** Ordered stage visits: from deal history, falling back to "Stage changed: A → B" timeline notes, then the current stage. */
export function stageVisits(deal: Deal, history: DealChange[], activities: Activity[], stageByName: Map<string, string>): { stageId: string; at: string }[] {
  const rows = history.filter((h) => h.dealId === deal.id && h.field === "stageId").sort((a, b) => a.at.localeCompare(b.at));
  if (rows.length) {
    const out = [{ stageId: String(rows[0].from ?? deal.stageId), at: deal.createdAt }];
    rows.forEach((r) => out.push({ stageId: String(r.to), at: r.at }));
    return out;
  }
  const notes = activities
    .filter((a) => a.links.dealIds.includes(deal.id) && a.subject.startsWith("Stage changed: "))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((a) => {
      const [from, to] = a.subject.slice("Stage changed: ".length).split(" → ");
      return { from: stageByName.get(from?.trim() ?? ""), to: stageByName.get(to?.trim() ?? ""), at: a.timestamp };
    })
    .filter((x) => x.from && x.to);
  if (notes.length) {
    const out = [{ stageId: notes[0].from!, at: deal.createdAt }];
    notes.forEach((n) => out.push({ stageId: n.to!, at: n.at }));
    return out;
  }
  return [{ stageId: deal.stageId, at: deal.stageEnteredAt < deal.createdAt ? deal.stageEnteredAt : deal.createdAt }];
}

/* ───────────── issues ───────────── */

export interface IssueTimes {
  issue: Issue;
  doneAt: string | null;
  startedAt: string | null;
  /** true when done/started came from issue history (not inferred from timestamps) */
  exact: boolean;
}

export function issueTimes(issues: Issue[], history: IssueHistoryEntry[]): IssueTimes[] {
  const byIssue = new Map<string, IssueHistoryEntry[]>();
  history.forEach((h) => {
    if (h.field !== "status") return;
    const arr = byIssue.get(h.issueId) ?? [];
    arr.push(h);
    byIssue.set(h.issueId, arr);
  });
  return issues.map((issue) => {
    const hs = (byIssue.get(issue.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const started = hs.find((h) => h.to === "in_progress" || h.to === "in_review")?.at ?? null;
    let done: string | null = null;
    for (let k = hs.length - 1; k >= 0; k--) if (hs[k].to === "done") {
      done = hs[k].at;
      break;
    }
    const exactDone = issue.status === "done" ? !!done : true;
    if (issue.status === "done" && !done) done = issue.updatedAt;
    if (issue.status !== "done") done = null;
    return { issue, doneAt: done, startedAt: started, exact: exactDone && (!!started || issue.status === "backlog" || issue.status === "todo") };
  });
}

/** Monday 00:00 WIB of the week containing ms */
export function weekStart(ms: number) {
  const d = new Date(ms + WIB);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) - WIB;
}

/* ───────────── stats ───────────── */

export function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (v: number[]) => quantile(v, 0.5);
export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
export const days = (fromIso: string, toIso: string | number) => (Number(typeof toIso === "number" ? toIso : Date.parse(toIso)) - Date.parse(fromIso)) / DAY;
export const fmtDays = (n: number | null) => (n === null ? "—" : n < 1 ? `${Math.round(n * 24)}h` : `${n < 10 ? n.toFixed(1) : Math.round(n)}d`);
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
