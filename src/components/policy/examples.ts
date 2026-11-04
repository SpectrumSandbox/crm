/*
 * Live recomputation of the policy's printed figures with the compensation engine:
 * the §5.1 rate table and the §16 worked examples 16.1, 16.2, 16.4, 16.7 and 16.8.
 * Printed figures are read from the policy text itself (so the comparison is always against what the page shows);
 * engine figures come from src/lib/initiatives/engine.ts on fixtures that mirror each example.
 */
import { computeRun, floorRp, memberWeight, netRevenue, projectCycles, projectRate, revenueShareRate, splitBonus } from "@/lib/initiatives/engine";
import type { EmployeeProfile, Initiative, InitiativeMember, ProjectRole, ProjectType, RevenueEntry } from "@/lib/initiatives/types";
import { findSub, plainText, type Block, type PolicySub } from "./model";

/* ───────────────────────── check model ───────────────────────── */

export type Fmt = "rp" | "pct" | "num" | "text";

export interface CheckItem {
  label: string;
  printed: number | string | null;
  engine: number | string;
  fmt: Fmt;
  /** rupiah difference accepted as a known rounding effect (shown, not hidden) */
  tolerance?: number;
  note?: string;
  /** decimals the printed percentage carries ("20.060%" → 3; trailing zeros are lost when parsed) */
  printedDecimals?: number;
}

export interface CheckMatrix {
  columns: { key: string; label: string; fmt: Fmt }[];
  rows: { label: string; cells: Record<string, CheckItem> }[];
}

export interface ExampleCheck {
  id: string;
  title: string;
  /** what the engine was asked to do */
  method: string;
  items: CheckItem[];
  matrix?: CheckMatrix;
  /** §16.2 only: the Rp1 rounding explanation, with live numbers */
  rounding?: {
    rate: number;
    cumNet: number;
    cumPoolExact: number;
    cumPoolFloor: number;
    allocated: number;
    cumulativePool: number;
    paymentNet: number;
    perPaymentExact: number;
    perPaymentPool: number;
  };
}

export type CheckStatus = "match" | "rounding" | "differs" | "unknown";

/** Decimals a printed percentage was given with ("20.060%" → 3). */
const pctDecimals = (v: number | string | null) => {
  if (typeof v !== "number") return 2;
  const s = String(v);
  return s.includes(".") ? s.split(".")[1].length : 0;
};

export function checkStatus(c: CheckItem): CheckStatus {
  if (c.printed == null) return "unknown";
  if (c.fmt === "text") return String(c.printed) === String(c.engine) ? "match" : "differs";
  const p = Number(c.printed);
  const e = Number(c.engine);
  if (c.fmt === "pct") {
    const d = c.printedDecimals ?? pctDecimals(c.printed);
    const f = 10 ** d;
    return Math.round(e * f) / f === Math.round(p * f) / f ? "match" : "differs";
  }
  const diff = Math.abs(p - e);
  if (diff < 0.5) return "match";
  if (c.tolerance && diff <= c.tolerance + 1e-9) return "rounding";
  return "differs";
}

/* ───────────────────────── reading the printed figures ───────────────────────── */

/** "Rp38,345,806" → 38345806; "−Rp30,000,000" → −30000000; "—" → 0 */
export function parseRp(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = plainText(s).trim();
  if (t === "—" || t === "-" || t === "") return 0;
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return null;
  return (/[−-]\s*Rp/.test(t) ? -1 : 1) * Number(digits);
}
/** "33.33%" → { value: 33.33, decimals: 2 } */
export function parsePct(s: string | undefined | null): { value: number; decimals: number } | null {
  const m = s ? /([\d.]+)\s*%/.exec(plainText(s)) : null;
  if (!m) return null;
  return { value: Number(m[1]), decimals: m[1].includes(".") ? m[1].split(".")[1].length : 0 };
}

const paragraphs = (sub: PolicySub | null) => (sub ? sub.blocks.filter((b): b is Extract<Block, { kind: "p" }> => b.kind === "p").map((b) => plainText(b.text)) : []);
const tables = (sub: PolicySub | null) => (sub ? sub.blocks.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table") : []);
const firstMatch = (texts: string[], re: RegExp) => {
  for (const t of texts) {
    const m = re.exec(t);
    if (m) return m;
  }
  return null;
};
const allMatches = (texts: string[], re: RegExp) => texts.flatMap((t) => [...t.matchAll(re)]);

/* ───────────────────────── fixtures ───────────────────────── */

const M = 1_000_000;
const pad = (n: number) => String(n).padStart(2, "0");
const wib = (d: string, h = 9) => new Date(`${d}T${pad(h)}:00:00+07:00`).toISOString();
const RICH = { companyRevenue: 100_000 * M, directCosts: 0, overheads: 0, cash: 100_000 * M, fixedCostsMonthly: 0 };

let seq = 0;
function mkIni(type: ProjectType, o: Partial<Initiative> = {}): Initiative {
  seq++;
  return {
    id: `ex-${seq}`,
    trackingNo: "",
    code: null,
    title: "Worked example",
    type,
    status: "active",
    initiatorId: "ex",
    origination: "personal",
    summary: "",
    valueProposition: "",
    scope: "",
    deliverables: "",
    exclusions: "",
    successCriteria: "",
    startDate: wib("2027-01-01", 0),
    endDate: wib("2027-06-30", 17),
    milestones: [],
    companyId: null,
    dealId: null,
    contractStatus: "signed",
    newClient: false,
    paymentTermsDays: 30,
    revenue: { expected: 0, best: 0, worst: 0 },
    costs: { materials: 0, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 },
    risks: [],
    highRisk: false,
    warranty: false,
    deferralMonths: 6,
    lockedSharePct: null,
    policyVersion: "4.0",
    submittedAt: null,
    acknowledgedAt: null,
    primaryReviewerId: null,
    scores: null,
    decision: null,
    appeal: null,
    approvedAt: wib("2026-12-20"),
    completedAt: null,
    epicId: null,
    createdAt: wib("2026-12-01"),
    updatedAt: wib("2026-12-01"),
    ...o,
  };
}
function mkMem(userId: string, ini: Initiative, roles: ProjectRole[], o: Partial<InitiativeMember> = {}): InitiativeMember {
  seq++;
  return {
    id: `exm-${seq}`,
    initiativeId: ini.id,
    userId,
    roles,
    specialistWeight: null,
    weightOverride: null,
    allocationFactor: 1,
    consent: "accepted",
    managerApproved: true,
    prcApproved: true,
    application: false,
    allocationPct: 20,
    joinedAt: ini.startDate,
    leftAt: null,
    removal: { stage: "none", updatedAt: null, note: "" },
    ...o,
  };
}
const profile = (userId: string, o: Partial<EmployeeProfile> = {}): EmployeeProfile => ({
  userId,
  employmentType: "full_time_permanent",
  hireDate: wib("2024-01-01"),
  probationEndDate: null,
  annualBaseSalary: 300 * M,
  directManagerId: null,
  goodStanding: true,
  activeWrittenWarning: false,
  onPIP: false,
  pipApprovedByPRC: false,
  underInvestigation: false,
  suspended: false,
  unpaidLeaveDays: 0,
  resignationNoticeAt: null,
  terminationNoticeAt: null,
  separation: null,
  acknowledgmentSignedAt: wib("2026-12-10"),
  governanceRoles: [],
  ...o,
});
const entry = (ini: Initiative, id: string, collected: string, revenue: number, directCosts: number, work: [string, string]): RevenueEntry => ({
  id,
  initiativeId: ini.id,
  month: collected.slice(0, 7),
  revenue,
  directCosts,
  basis: "milestone",
  received: true,
  collectedAt: collected,
  workPeriodStart: work[0],
  workPeriodEnd: work[1],
  note: "",
});
const w = (roles: ProjectRole[]) => memberWeight({ roles, specialistWeight: null, weightOverride: null });

/* ───────────────────────── §5.1 rate table ───────────────────────── */

export function rateTableCheck(): ExampleCheck {
  const sub = findSub("s-5-1");
  const table = tables(sub).find((t) => /projected annual net revenue/i.test(t.head[0] ?? ""));
  const rows = (table?.rows ?? []).map((r) => {
    const x = parseRp(r[0]) ?? 0;
    const rate = revenueShareRate(x);
    const pct = parsePct(r[1]);
    return {
      label: `x = Rp${x.toLocaleString("en-US")}`,
      cells: {
        rate: { label: "Rate (y)", printed: pct?.value ?? null, printedDecimals: pct?.decimals, engine: rate * 100, fmt: "pct" as const },
        pool: { label: "Pool per year", printed: parseRp(r[2]), engine: floorRp(x * rate), fmt: "rp" as const },
      },
    };
  });
  return {
    id: "s-5-1",
    title: "§5.1 rate table",
    method: "revenueShareRate(x) on the curve in force (40 % → 10 % at Rp1,500,000,000); pool per year = x × y, rounded down (§8.5).",
    items: [],
    matrix: {
      columns: [
        { key: "rate", label: "Rate (y)", fmt: "pct" },
        { key: "pool", label: "Bonus pool per year", fmt: "rp" },
      ],
      rows,
    },
  };
}

/* ───────────────────────── §16.1 Type A consulting ───────────────────────── */

export function example161(): ExampleCheck {
  const sub = findSub("s-16-1");
  const ps = paragraphs(sub);
  const table = tables(sub)[0];
  const revenue = parseRp(firstMatch(ps, /Revenue (Rp[\d,]+)/)?.[1]) ?? 600 * M;
  const costs = parseRp(firstMatch(ps, /direct costs (Rp[\d,]+)/)?.[1]) ?? 100 * M;
  const n = netRevenue(revenue, costs);
  const ini = mkIni("A", { startDate: wib("2027-01-01", 0), endDate: wib("2027-08-31", 17), revenue: { expected: revenue, best: revenue, worst: revenue }, costs: { materials: costs, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 } });
  const r = projectRate(ini);
  const team: { userId: string; roles: ProjectRole[] }[] = [
    { userId: "lead", roles: ["initiator", "project_lead"] },
    { userId: "tl", roles: ["technical_lead"] },
    { userId: "e1", roles: ["engineer"] },
    { userId: "e2", roles: ["engineer"] },
  ];
  const s = splitBonus(
    team.map((t) => ({ userId: t.userId, weight: w(t.roles) })),
    r.rate,
    n.net,
  );
  const ratePrinted = parsePct(firstMatch(ps, /= ([\d.]+%) \(rounded/)?.[1]);
  const items: CheckItem[] = [
    { label: "UMKM final tax (0.5 % of revenue, §5.4)", printed: parseRp(firstMatch(ps, /UMKM final tax (Rp[\d,]+)/)?.[1]), engine: n.tax, fmt: "rp" },
    { label: "Net revenue = x (contract ≤ 12 months)", printed: parseRp(firstMatch(ps, /both (Rp[\d,]+)/)?.[1]), engine: r.x, fmt: "rp" },
    { label: "Revenue-share rate y", printed: ratePrinted?.value ?? null, printedDecimals: ratePrinted?.decimals, engine: r.rate * 100, fmt: "pct" },
    { label: "Bonus pool", printed: parseRp(firstMatch(ps, /Bonus pool = (Rp[\d,]+)/)?.[1]), engine: s.pool, fmt: "rp" },
    { label: "Total weight", printed: Number(firstMatch(ps, /total weight is ([\d.]+?)\.?$/)?.[1] ?? NaN) || null, engine: s.total, fmt: "num" },
    ...(table?.rows ?? []).map((row, i) => ({ label: `${plainText(row[0])} (weight ${row[1]})`, printed: parseRp(row[2]), engine: s.shares[i]?.bonus ?? 0, fmt: "rp" as const })),
  ];
  return { id: "s-16-1", title: "§16.1 recomputed", method: "netRevenue → projectRate (8-month contract, so x = total net) → splitBonus by weight (all members full period, A = 1.0).", items };
}

/* ───────────────────────── §16.2 Type B with team changes ───────────────────────── */

export function example162(): ExampleCheck {
  const sub = findSub("s-16-2");
  const ps = paragraphs(sub);
  const table = tables(sub)[0];
  const ini = mkIni("B", { revenue: { expected: 750 * M, best: 750 * M, worst: 750 * M }, costs: { materials: 250 * M, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 } });
  const rate = projectRate(ini);
  const end3 = wib("2027-03-31", 17);
  const start4 = wib("2027-04-01", 0);
  const mems = [
    mkMem("rina", ini, ["initiator", "project_lead"]),
    mkMem("budi", ini, ["technical_lead"]),
    mkMem("eko", ini, ["engineer"]),
    mkMem("dewi", ini, ["engineer"], { leftAt: end3 }),
    mkMem("fajar", ini, ["engineer"], { joinedAt: start4 }),
    mkMem("sari", ini, ["secretary"], { allocationFactor: 0.5 }),
  ];
  const entries = [entry(ini, "design", wib("2027-04-12"), 300 * M, 50 * M, [ini.startDate, end3]), entry(ini, "install", wib("2027-07-12"), 450 * M, 200 * M, [start4, ini.endDate])];
  const profiles = ["rina", "budi", "eko", "dewi", "fajar", "sari"].map((u) => profile(u));
  const apr = computeRun({ month: "2027-04", initiatives: [ini], members: mems, entries, profiles, adjustments: [], ...RICH });
  const jul = computeRun({ month: "2027-07", initiatives: [ini], members: mems, entries, profiles, adjustments: [], ...RICH });
  const pay = (run: typeof apr, u: string) => run.lines.find((l) => l.userId === u)?.payable ?? 0;

  // the printed example rounds each payment's pool on its own
  const n1 = netRevenue(300 * M, 50 * M).net;
  const n2 = netRevenue(450 * M, 200 * M).net;
  const perPaymentPool = floorRp(rate.rate * n2);
  const installSplit = splitBonus(
    [
      { userId: "rina", weight: 2.5 },
      { userId: "budi", weight: 2 },
      { userId: "eko", weight: 1 },
      { userId: "fajar", weight: 1 },
      { userId: "sari", weight: 0.5 },
    ],
    1,
    perPaymentPool,
  );

  const ratePrinted = parsePct(firstMatch(ps, /= ([\d.]+%) \(rounded/)?.[1]);
  const pools = allMatches(ps, /pool of (Rp[\d,]+)/g).map((m) => parseRp(m[1]));
  const ids = ["rina", "budi", "eko", "dewi", "fajar", "sari"];
  const rows = (table?.rows ?? []).map((row, i) => {
    const u = ids[i] ?? "";
    const d = pay(apr, u);
    const inst = pay(jul, u);
    const perPay = installSplit.shares.find((s) => s.userId === u)?.bonus ?? 0;
    return {
      label: `${plainText(row[0])} · ${plainText(row[1])}`,
      cells: {
        design: { label: "Design pool", printed: parseRp(row[3]), engine: d, fmt: "rp" as const },
        install: { label: "Installation (§8.1 cumulative)", printed: parseRp(row[4]), engine: inst, fmt: "rp" as const, tolerance: 1 },
        perPayment: { label: "Installation (per-payment rounding)", printed: parseRp(row[4]), engine: perPay, fmt: "rp" as const },
        total: { label: "Total", printed: parseRp(row[5]), engine: d + inst, fmt: "rp" as const, tolerance: 1 },
      },
    };
  });
  const items: CheckItem[] = [
    { label: "Projected net revenue", printed: parseRp(firstMatch(ps, /projected net revenue of (Rp[\d,]+)/)?.[1]), engine: rate.projectedNet, fmt: "rp" },
    { label: "Revenue-share rate y", printed: ratePrinted?.value ?? null, printedDecimals: ratePrinted?.decimals, engine: rate.rate * 100, fmt: "pct" },
    { label: "Design milestone pool (months 1–3)", printed: pools[0] ?? null, engine: apr.totals.pool, fmt: "rp" },
    { label: "Installation milestone pool (§8.1 cumulative)", printed: pools[1] ?? null, engine: jul.totals.pool, fmt: "rp", tolerance: 1, note: "Cumulative rule — see the rounding note" },
    { label: "Installation milestone pool (per-payment rounding)", printed: pools[1] ?? null, engine: perPaymentPool, fmt: "rp" },
    { label: "Total effective weight in each work period", printed: Number(firstMatch(ps, /total effective weight of (\d+(?:\.\d+)?)/)?.[1] ?? NaN) || null, engine: apr.lines.reduce((s, l) => s + l.weight, 0), fmt: "num" },
  ];
  const cumNet = n1 + n2;
  const cumPoolExact = rate.rate * cumNet;
  return {
    id: "s-16-2",
    title: "§16.2 recomputed",
    method: "projectRate on the expected case, then computeRun for the April (design) and July (installation) salary cycles with Team Allocation Ledger rows: Dewi leaves 31 Mar, Fajar joins 1 Apr, Sari at A = 0.5 (§6.5–6.6).",
    items,
    matrix: {
      columns: [
        { key: "design", label: "Design pool", fmt: "rp" },
        { key: "install", label: "Installation · engine §8.1", fmt: "rp" },
        { key: "perPayment", label: "Installation · per payment", fmt: "rp" },
        { key: "total", label: "Total", fmt: "rp" },
      ],
      rows,
    },
    rounding: {
      rate: rate.rate,
      cumNet,
      cumPoolExact,
      cumPoolFloor: floorRp(cumPoolExact),
      allocated: apr.totals.pool,
      cumulativePool: jul.totals.pool,
      paymentNet: n2,
      perPaymentExact: rate.rate * n2,
      perPaymentPool,
    },
  };
}

/* ───────────────────────── §16.4 failed break-even test ───────────────────────── */

export function example164(): ExampleCheck {
  const sub = findSub("s-16-4");
  const ps = paragraphs(sub);
  const num = (re: RegExp) => parseRp(firstMatch(ps, re)?.[1]);
  const companyRevenue = num(/company revenue (Rp[\d,]+)/) ?? 1_200 * M;
  const directCosts = num(/direct project costs (Rp[\d,]+)/) ?? 380 * M;
  const overheads = num(/operating overheads (Rp[\d,]+)/) ?? 690 * M;
  const proposed = num(/proposed bonuses (Rp[\d,]+)/) ?? 160 * M;
  // a project whose collected payment produces exactly the proposed bonuses (y fixed at 100 % for the illustration)
  const ini = mkIni("A", { lockedSharePct: 1 });
  const mems = [mkMem("pl", ini, ["project_lead"]), mkMem("tl", ini, ["technical_lead"])];
  const revenue = proposed * 2;
  const entries = [entry(ini, "e", wib("2027-03-10"), revenue, revenue - proposed - revenue / 200, [wib("2027-02-01", 0), wib("2027-02-28", 17)])];
  const r = computeRun({ month: "2027-03", initiatives: [ini], members: mems, entries, profiles: [profile("pl"), profile("tl")], adjustments: [], companyRevenue, directCosts, overheads, cash: 100_000 * M, fixedCostsMonthly: 100 * M });
  const opPrinted = firstMatch(ps, /= ([−-]Rp[\d,]+)\. The test fails/);
  const payoutPrinted = parsePct(firstMatch(ps, /which is ([\d.]+%)/)?.[1]);
  const pl = r.lines.find((l) => l.userId === "pl");
  return {
    id: "s-16-4",
    title: "§16.4 recomputed",
    method: "computeRun with the rolling three-month figures (§9.1) and Rp160,000,000 of proposed bonuses split between two equal-weight members; §9.2 pays the largest share that passes and carries the rest forward.",
    items: [
      { label: "Proposed bonuses", printed: proposed, engine: r.proposed, fmt: "rp" },
      { label: "Operating result before bonuses are cut", printed: opPrinted ? parseRp(opPrinted[1]) : null, engine: r.operatingResultBefore, fmt: "rp" },
      { label: "Break-even test", printed: /The test fails/.test(ps.join(" ")) ? "Fails" : null, engine: r.breakEvenPassed ? "Passes" : "Fails", fmt: "text" },
      { label: "Largest payout that passes", printed: num(/largest payout that passes is (Rp[\d,]+)/), engine: r.totals.payable, fmt: "rp" },
      { label: "Share of proposed bonuses paid", printed: payoutPrinted?.value ?? null, printedDecimals: payoutPrinted?.decimals, engine: r.payoutPct * 100, fmt: "pct" },
      { label: "Carried forward to the next passing month", printed: num(/remaining (Rp[\d,]+) is carried forward/), engine: r.totals.carriedOver, fmt: "rp" },
      { label: "Each employee receives the same percentage (member 1 of 2)", printed: payoutPrinted?.value ?? null, printedDecimals: payoutPrinted?.decimals, engine: pl && pl.gross > 0 ? (pl.payable / pl.gross) * 100 : 0, fmt: "pct" },
    ],
  };
}

/* ───────────────────────── §16.7 multi-year project ───────────────────────── */

export function example167(): ExampleCheck {
  const sub = findSub("s-16-7");
  const ps = paragraphs(sub);
  const table = tables(sub)[0];
  // expected revenue 1.8B with 191M direct costs → projected net exactly 1.6B (UMKM 0.5 % of revenue)
  const ini = mkIni("B", { startDate: wib("2027-01-01", 0), endDate: wib("2028-12-31", 17), revenue: { expected: 1_800 * M, best: 1_800 * M, worst: 1_800 * M }, costs: { materials: 191 * M, subcontractors: 0, equipment: 0, travel: 0, other: 0, contingencyPct: 0 } });
  const r = projectRate(ini);
  const fixed = { ...ini, lockedSharePct: r.rate };
  const mems = [mkMem("a", fixed, ["project_lead"])];
  // net Rp700M in year 1 and Rp900M in year 2
  const e1 = entry(fixed, "y1", wib("2027-12-10"), 800 * M, 96 * M, [wib("2027-01-01", 0), wib("2027-12-31", 17)]);
  const e2 = entry(fixed, "y2", wib("2028-12-10"), 1_000 * M, 95 * M, [wib("2028-01-01", 0), wib("2028-12-31", 17)]);
  const y1 = computeRun({ month: "2027-12", initiatives: [fixed], members: mems, entries: [e1, e2], profiles: [profile("a")], adjustments: [], ...RICH });
  const y2 = computeRun({ month: "2028-12", initiatives: [fixed], members: mems, entries: [e1, e2], profiles: [profile("a")], adjustments: [], ...RICH });
  const ratePrinted = parsePct(firstMatch(ps, /= ([\d.]+%) \(rounded/)?.[1]);
  const rowsT = table?.rows ?? [];
  const engineNet = [netRevenue(800 * M, 96 * M).net, netRevenue(1_000 * M, 95 * M).net];
  const enginePool = [y1.totals.pool, y2.totals.pool];
  return {
    id: "s-16-7",
    title: "§16.7 recomputed",
    method: "contractedMonths = 24, so x = projected net × 12 ÷ 24 (projectedAnnualNet); the rate applies to every rupiah, pooled cumulatively (§8.1) through computeRun for each year's payment.",
    items: [
      { label: "Annual net revenue x", printed: parseRp(firstMatch(ps, /= (Rp[\d,]+), so its rate/)?.[1]), engine: r.x, fmt: "rp" },
      { label: "Revenue-share rate y", printed: ratePrinted?.value ?? null, printedDecimals: ratePrinted?.decimals, engine: r.rate * 100, fmt: "pct" },
    ],
    matrix: {
      columns: [
        { key: "net", label: "Net revenue", fmt: "rp" },
        { key: "pool", label: "Bonus pool", fmt: "rp" },
      ],
      rows: rowsT.map((row, i) => ({
        label: plainText(row[0]),
        cells: {
          net: { label: "Net revenue", printed: parseRp(row[1]), engine: i < 2 ? engineNet[i] : engineNet[0] + engineNet[1], fmt: "rp" as const },
          pool: { label: "Bonus pool", printed: parseRp(row[2]), engine: i < 2 ? enginePool[i] : enginePool[0] + enginePool[1], fmt: "rp" as const },
        },
      })),
    },
  };
}

/* ───────────────────────── §16.8 Type C guaranteed minimum ───────────────────────── */

const MONTHS_168 = ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09"];

function typeCRun(pools: number[], extra: (ini: Initiative) => InitiativeMember[] = () => []) {
  const ini = mkIni("C", { lockedSharePct: 1, standardBonus: 1 * M, startDate: wib("2027-01-01", 0), endDate: wib("2027-12-31", 17) });
  // revenue 2p, direct costs 0.99p → net revenue p exactly (0.5 % UMKM tax on 2p = 0.01p)
  const entries = pools.flatMap((p, i) => (p > 0 ? [entry(ini, `c${i}`, wib(`${MONTHS_168[i]}-10`), 2 * p, p - p / 100, [wib(`${MONTHS_168[i]}-01`, 0), wib(`${MONTHS_168[i]}-28`, 17)])] : []));
  const members = [mkMem("team", ini, ["project_lead"]), ...extra(ini)];
  return { ini, entries, members };
}

export function example168(): ExampleCheck {
  const sub = findSub("s-16-8");
  const ps = paragraphs(sub);
  const table = tables(sub)[0];
  const rowsT = table?.rows ?? [];
  const pools = rowsT.map((r) => parseRp(r[1]) ?? 0);
  const { ini, entries, members } = typeCRun(pools.length ? pools : [0, 0, 0, 0.4, 3, 0.8, 2, 1.5, 4].map((x) => x * M));
  const cycles = projectCycles(ini, { members, entries, profiles: [profile("team")] }, MONTHS_168[MONTHS_168.length - 1]);
  const rows = rowsT.map((row, i) => {
    const c = cycles[i];
    const m = c?.members.find((x) => x.userId === "team");
    return {
      label: plainText(row[0]),
      cells: {
        pool: { label: "Revenue-based pool", printed: parseRp(row[1]), engine: c?.revPool ?? 0, fmt: "rp" as const },
        topUp: { label: "Top-up", printed: parseRp(row[2]), engine: c?.topUp ?? 0, fmt: "rp" as const },
        deducted: { label: "Top-up deducted", printed: parseRp(row[3]), engine: m?.deducted ?? 0, fmt: "rp" as const },
        paid: { label: "Paid to team", printed: parseRp(row[4]), engine: m ? m.revShare - m.deducted + m.topUp : 0, fmt: "rp" as const },
        balance: { label: "Top-ups still to deduct", printed: parseRp(row[5]), engine: m?.balanceAfter ?? 0, fmt: "rp" as const },
        streak: { label: "Months in a row above", printed: Number(plainText(row[6] ?? "")), engine: c?.aboveStreak ?? 0, fmt: "num" as const },
      },
    };
  });

  // alternative: May pool of Rp12,000,000 ends the minimum at once
  const altMay = parseRp(firstMatch(ps, /Had May's pool been (Rp[\d,]+)/)?.[1]) ?? 12 * M;
  const alt = typeCRun([0, 0, 0, pools[3] ?? 0.4 * M, altMay, 0, 0, 0, 0]);
  const altCycles = projectCycles(alt.ini, { members: alt.members, entries: alt.entries, profiles: [profile("team")] }, "2027-09");
  const may = altCycles[4]?.members.find((x) => x.userId === "team");

  // probationary engineer joining 1 April with a three-month probation (ends 30 June)
  const prob = typeCRun(pools.length ? pools : [0, 0, 0, 0.4, 3, 0.8, 2, 1.5, 4].map((x) => x * M), (i) => [mkMem("ahmad", i, ["engineer"], { joinedAt: wib("2027-04-01", 0) })]);
  const probProfiles = [profile("team"), profile("ahmad", { employmentType: "probationary", probationEndDate: wib("2027-06-30", 17) })];
  const probLine = (month: string) => computeRun({ month, initiatives: [prob.ini], members: prob.members, entries: prob.entries, profiles: probProfiles, adjustments: [], ...RICH }).lines.find((l) => l.userId === "ahmad");
  const outcome = (month: string) => {
    const l = probLine(month);
    if (!l) return "—";
    if (l.withheld > 0 && l.payable <= 0) return "Held";
    return l.payable > 0 ? "Paid with salary" : "—";
  };
  const topUpsPaid = cycles.reduce((s, c) => s + c.topUp, 0);
  const minimumEnds = cycles.findIndex((c) => c.minimumEndsThisMonth);
  const probText = ps.join(" ");

  return {
    id: "s-16-8",
    title: "§16.8 recomputed",
    method: "projectCycles for a Type C project with a Rp1,000,000 standard bonus, revenue-based pools as printed and one unchanged team (§8.6 top-ups, top-up balance, deductions above the standard bonus, end after three months in a row).",
    items: [
      { label: "Top-ups paid by the company", printed: parseRp(firstMatch(ps, /company paid (Rp[\d,]+) in top-ups/)?.[1]), engine: topUpsPaid, fmt: "rp" },
      { label: "Minimum ends after", printed: /minimum ends after September/.test(probText) ? "September" : null, engine: minimumEnds >= 0 ? new Date(`${MONTHS_168[minimumEnds]}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" }) : "—", fmt: "text" },
      { label: "Alt. May pool Rp12,000,000: deducted in May", printed: parseRp(firstMatch(ps, /(Rp[\d,]+) would have been deducted/)?.[1]), engine: may?.deducted ?? 0, fmt: "rp" },
      { label: "Alt. May pool Rp12,000,000: team receives", printed: parseRp(firstMatch(ps, /team would have received (Rp[\d,]+)/)?.[1]), engine: may ? may.revShare - may.deducted : 0, fmt: "rp" },
      { label: "Probationary engineer · April (top-up month)", printed: /paid their share with salary in April/.test(probText) ? "Paid with salary" : null, engine: outcome("2027-04"), fmt: "text" },
      { label: "Probationary engineer · May", printed: /May share, after earlier top-ups are deducted, is held/.test(probText) ? "Held" : null, engine: outcome("2027-05"), fmt: "text" },
      { label: "Probationary engineer · June (top-up month)", printed: /in April and June/.test(probText) ? "Paid with salary" : null, engine: outcome("2027-06"), fmt: "text" },
    ],
    matrix: {
      columns: [
        { key: "pool", label: "Revenue-based pool", fmt: "rp" },
        { key: "topUp", label: "Top-up", fmt: "rp" },
        { key: "deducted", label: "Top-up deducted", fmt: "rp" },
        { key: "paid", label: "Paid to team", fmt: "rp" },
        { key: "balance", label: "Still to deduct", fmt: "rp" },
        { key: "streak", label: "Months above", fmt: "num" },
      ],
      rows,
    },
  };
}

/** Live checks keyed by the sub-section they sit under. */
export const LIVE_CHECKS: Record<string, () => ExampleCheck> = {
  "s-5-1": rateTableCheck,
  "s-16-1": example161,
  "s-16-2": example162,
  "s-16-4": example164,
  "s-16-7": example167,
  "s-16-8": example168,
};
