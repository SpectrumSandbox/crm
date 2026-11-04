"use client";

/*
 * Printable PRC packet: Annex A (Part 1 summary, Part 2 delivery plan, Part 3 financials and risk, declaration,
 * For PRC use) and Annex D Part 1 (Role and Weight Agreement). Rendered in a light, paper-like layout through a
 * portal on <body>, so the dark app theme and the app shell are overridden on this page only, on screen and in print.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/store";
import type { Company, Contact, Deal, User } from "@/lib/types";
import type { CurveAdjustment, Initiative, InitiativeMember } from "@/lib/initiatives/types";
import { approvalTier, deferralShare, deferralTriggers, effectiveWeight, memberWeight, proposalEconomics, standardBonusOf } from "@/lib/initiatives/engine";
import { ORIGINATION_META, POLICY_VERSION, PROJECT_TYPE_META, RISK_CATEGORIES, ROLE_META, TIER_META } from "@/lib/initiatives/policy";
import { formatDate, formatIDR } from "@/lib/utils";
import { RateCurve, milestoneWorkPeriods, ratePct, rateSourceLabel } from "@/components/initiatives/shared";

const CONTRACT: Record<Initiative["contractStatus"], string> = { none: "None yet", verbal: "Verbal", loi: "Letter of intent (LOI)", signed: "Signed" };
const OUTCOME = { approved: "Approved", conditional: "Conditionally approved", deferred: "Deferred", rejected: "Rejected" } as const;
const rp = (n: number) => formatIDR(n, "full");
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

const CSS = `
#prc-print-root { position: fixed; inset: 0; z-index: 80; overflow: auto; background: #e9e9e6; color: #111; font-family: Montserrat, "Helvetica Neue", Arial, sans-serif; }
#prc-print-root .toolbar { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ccc; font-size: 12px; }
#prc-print-root .toolbar a, #prc-print-root .toolbar button { font: inherit; font-weight: 600; color: #111; background: #fff; border: 1px solid #999; border-radius: 3px; padding: 6px 12px; cursor: pointer; text-decoration: none; }
#prc-print-root .toolbar button.primary { background: #111; color: #fff; border-color: #111; }
#prc-print-root .paper { background: #fff; max-width: 860px; margin: 20px auto 48px; padding: 36px 40px; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
#prc-print-root h1 { font-size: 20px; font-weight: 800; margin: 0 0 2px; }
#prc-print-root h2 { font-size: 13px; font-weight: 800; margin: 22px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #111; text-transform: uppercase; letter-spacing: .04em; }
#prc-print-root h3 { font-size: 11.5px; font-weight: 700; margin: 12px 0 4px; }
#prc-print-root p, #prc-print-root li { font-size: 11px; line-height: 1.45; margin: 0 0 4px; }
#prc-print-root .meta { font-size: 10.5px; color: #444; }
#prc-print-root table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
#prc-print-root th, #prc-print-root td { border: 1px solid #888; padding: 4px 6px; font-size: 10.5px; text-align: left; vertical-align: top; }
#prc-print-root th { background: #f0f0ee; font-weight: 700; }
#prc-print-root td.k { width: 42%; background: #fafaf8; font-weight: 600; }
#prc-print-root .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#prc-print-root .muted { color: #555; }
#prc-print-root .sig { display: inline-block; min-width: 140px; border-bottom: 1px solid #111; height: 14px; }
#prc-print-root .pre { white-space: pre-wrap; }
#prc-print-root .curve { max-width: 360px; margin-top: 6px; }
@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background: #fff !important; }
  body > *:not(#prc-print-root) { display: none !important; }
  #prc-print-root { position: static; overflow: visible; background: #fff; }
  #prc-print-root .toolbar { display: none; }
  #prc-print-root .paper { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  #prc-print-root .break { break-before: page; }
  #prc-print-root table, #prc-print-root tr { break-inside: avoid; }
}
`;

export function PrintPacket({ id }: { id: string }) {
  const router = useRouter();
  const ini = useCrm((s) => s.initiatives.find((i) => i.id === id));
  const allMembers = useCrm((s) => s.initiativeMembers);
  const users = useCrm((s) => s.users);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const contacts = useCrm((s) => s.contacts);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(`/initiatives/${encodeURIComponent(id)}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, id]);

  const data = useMemo(() => (ini ? buildPacketData(ini, { allMembers, users, companies, deals, contacts, adjustments }) : null), [ini, allMembers, users, companies, deals, contacts, adjustments]);

  if (!mounted) return null;

  const body = !ini || !data ? (
    <div className="paper">
      <h1>Initiative not found</h1>
      <p>No initiative with id “{id}”.</p>
      <p>
        <Link href="/initiatives">Back to initiatives</Link>
      </p>
    </div>
  ) : (
    <Packet ini={ini} d={data} />
  );

  return createPortal(
    <div id="prc-print-root">
      <style>{CSS}</style>
      <div className="toolbar">
        <span>
          <Link href={ini ? `/initiatives/${encodeURIComponent(ini.id)}` : "/initiatives"}>← Back</Link>
          <span className="muted" style={{ marginLeft: 10 }}>
            PRC packet · {ini?.trackingNo || ini?.code || "draft"} · Esc to close
          </span>
        </span>
        <button type="button" className="primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {body}
    </div>,
    document.body,
  );
}

interface PacketContext {
  allMembers: InitiativeMember[];
  users: User[];
  companies: Company[];
  deals: Deal[];
  contacts: Contact[];
  adjustments: CurveAdjustment[];
}

function buildPacketData(ini: Initiative, c: PacketContext) {
  const name = (uid: string | null | undefined) => c.users.find((u) => u.id === uid)?.name ?? uid ?? "—";
  const members = c.allMembers.filter((m) => m.initiativeId === ini.id && m.consent !== "declined");
  // the agreement shows the rows signed before work began: each person's earliest row
  const initial = [...members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)).filter((m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i);
  const econ = proposalEconomics(ini, c.adjustments);
  const tier = approvalTier(ini);
  const deferral = deferralTriggers(ini, c.adjustments);
  const company = c.companies.find((x) => x.id === ini.companyId);
  const deal = c.deals.find((x) => x.id === ini.dealId);
  const clientContacts = deal ? c.contacts.filter((x) => deal.contactIds.includes(x.id)) : company ? c.contacts.filter((x) => x.companyId === company.id).slice(0, 2) : [];
  const lead = members.find((m) => m.roles.includes("project_lead") && (!m.leftAt || Date.parse(m.leftAt) > Date.now()));
  return { name, members, initial, econ, tier, deferral, company, deal, clientContacts, lead, periods: milestoneWorkPeriods(ini.milestones, ini.startDate), defPct: deferralShare(ini, c.adjustments) };
}
type Data = ReturnType<typeof buildPacketData>;

function Packet({ ini, d }: { ini: Initiative; d: Data }) {
  const { econ, tier } = d;
  const t = TIER_META[tier.tier];
  const exp = econ.expected;
  const allManagers = d.members.length > 0 && d.members.every((m) => m.managerApproved);
  const milestones = [...ini.milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overrides = d.initial.filter((m) => m.weightOverride != null);
  const prcChecked = d.initial.length > 0 && d.initial.every((m) => m.prcApproved);
  const dec = ini.decision;
  const approving = dec && (dec.outcome === "approved" || dec.outcome === "conditional");

  const summary: [string, React.ReactNode][] = [
    ["Project name", ini.title],
    ["Client and client contact", <>{d.company?.name ?? "—"}{d.clientContacts.length ? ` — ${d.clientContacts.map((c) => `${c.firstName} ${c.lastName}${c.jobTitle ? ` (${c.jobTitle})` : ""}`).join(", ")}` : ""}</>],
    ["Proposed by", d.name(ini.initiatorId)],
    ["Origination (how the opportunity arose; first CRM contact date)", <>{ini.origination ? ORIGINATION_META[ini.origination].label : "Not recorded"}; first CRM contact {ini.firstContactAt ? formatDate(ini.firstContactAt, "medium") : "—"}</>],
    ["Project type (A, B or C) and reason", <>{PROJECT_TYPE_META[ini.type].label} — {PROJECT_TYPE_META[ini.type].description}</>],
    ["Approval tier requested (1, 2 or 3)", <>{t.label} — {tier.reasons.join("; ")}</>],
    ["Contract status (verbal, LOI, signed)", CONTRACT[ini.contractStatus]],
    ["Start date and contracted end date", `${formatDate(ini.startDate, "medium")} — ${formatDate(ini.endDate, "medium")}`],
    ["Contracted duration (months)", String(econ.rate.months)],
    ["Contract value excluding VAT (Rp)", rp(exp.revenue)],
    ["Direct costs including contingency (Rp)", `${rp(exp.costs)} (contingency ${ini.costs.contingencyPct}%)`],
    ["Estimated taxes (Rp)", `${rp(exp.tax)} — UMKM final tax 0.5% of revenue (§5.4)`],
    ["Projected net revenue, total (Rp)", rp(exp.net)],
    ["Projected annual net revenue, x (Rp) (Section 5.1)", rp(econ.rate.x)],
    ["Resulting revenue-share rate, y (%)", `${ratePct(econ.rate.rate)} — ${rateSourceLabel(econ.rate.source)}`],
    ["Projected bonus pool (Rp)", rp(exp.pool)],
    ["Company margin after bonus pool (Rp and %)", `${rp(exp.companyMargin)} (${exp.revenue > 0 ? pct1(exp.marginPct) : "—"})`],
    ["Deferral triggers met (Section 9.3)", d.deferral.length ? `${d.deferral.join("; ")} — proposed ${Math.round((ini.deferralPct ?? 0.3) * 100)}% for ${ini.deferralMonths} months after close` : "None"],
    ["Proposed Project Lead", d.lead ? d.name(d.lead.userId) : "—"],
    ["Line manager agreement obtained for all members (yes or no)", allManagers ? "Yes" : "No"],
  ];
  if (ini.type === "C") summary.push(["Type C only: proposed standard bonus (Rp a month, at least 1,000,000) (Section 8.6)", rp(standardBonusOf(ini))]);

  return (
    <div className="paper">
      <div className="meta">Spectrum Group · Project Initiative and Compensation Policy v{POLICY_VERSION} · Annex A and Annex D · printed {formatDate(new Date().toISOString(), "datetime")}</div>
      <h1>Project proposal — {ini.title}</h1>
      <div className="meta">
        {ini.trackingNo ? `Tracking no. ${ini.trackingNo}` : "Not yet submitted"}
        {ini.code ? ` · Project code ${ini.code}` : ""} · {t.proposal} · submit to prc@company.com (§4.5)
        {ini.demo ? " · SAMPLE RECORD" : ""}
      </div>

      <h2>Part 1. Summary (all tiers)</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Entry</th>
          </tr>
        </thead>
        <tbody>
          {summary.map(([k, v]) => (
            <tr key={k}>
              <td className="k">{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {econ.rate.source !== "v3_flat" && econ.rate.x > 0 ? (
        <div className="curve">
          <RateCurve x={econ.rate.x} curve={econ.rate.curve} months={econ.rate.months} light />
        </div>
      ) : null}
      <h3>Business case and scope</h3>
      <p className="pre">{ini.summary || "—"}</p>
      {ini.valueProposition ? <p className="pre">{ini.valueProposition}</p> : null}
      <p className="pre">
        <strong>Deliverables and acceptance criteria:</strong> {ini.deliverables || "—"}
      </p>
      <p className="pre">
        <strong>Excluded:</strong> {ini.exclusions || "—"}
      </p>

      <h2 className="break">Part 2. Delivery plan (Tiers 2 and 3)</h2>
      <table>
        <thead>
          <tr>
            <th>Milestone</th>
            <th>Deliverable</th>
            <th>Planned acceptance date</th>
            <th className="num">Payment (Rp)</th>
            <th>Work period it pays for</th>
          </tr>
        </thead>
        <tbody>
          {milestones.length ? (
            milestones.map((m, i) => {
              const wp = d.periods.get(m.id);
              return (
                <tr key={m.id}>
                  <td>M{i + 1}</td>
                  <td>{m.name || "—"}</td>
                  <td>{formatDate(m.dueDate, "medium")}</td>
                  <td className="num">{m.paymentAmount > 0 ? rp(m.paymentAmount) : "—"}</td>
                  <td>{m.paymentAmount > 0 && wp ? `${formatDate(wp.from, "medium")} — ${formatDate(wp.to, "medium")}` : "Not a payment milestone"}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={5} className="muted">
                No milestones recorded.
              </td>
            </tr>
          )}
          {milestones.length ? (
            <tr>
              <td colSpan={3}>
                <strong>Total payments</strong>
              </td>
              <td className="num">
                <strong>{rp(milestones.reduce((s, m) => s + m.paymentAmount, 0))}</strong>
              </td>
              <td />
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="pre">
        <strong>Technical approach, standards and dependencies:</strong> {ini.scope || "—"}
      </p>
      <p className="pre">
        <strong>Success criteria:</strong> {ini.successCriteria || "—"}
      </p>

      <h2>Part 3. Financials and risk (Tiers 2 and 3)</h2>
      <table>
        <thead>
          <tr>
            <th>Case</th>
            <th className="num">Revenue (Rp)</th>
            <th className="num">Direct costs (Rp)</th>
            <th className="num">Taxes (Rp)</th>
            <th className="num">Net revenue (Rp)</th>
            <th className="num">Bonus pool (Rp)</th>
            <th className="num">Company margin (Rp)</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["Best", econ.best],
              ["Expected", econ.expected],
              ["Worst", econ.worst],
            ] as const
          ).map(([label, s]) => (
            <tr key={label}>
              <td>
                <strong>{label}</strong>
              </td>
              <td className="num">{rp(s.revenue)}</td>
              <td className="num">{rp(s.costs)}</td>
              <td className="num">{rp(s.tax)}</td>
              <td className="num">{rp(s.net)}</td>
              <td className="num">{rp(s.pool)}</td>
              <td className="num">
                {rp(s.companyMargin)} ({s.revenue > 0 ? pct1(s.marginPct) : "—"})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        One revenue-share rate for all cases, set from the expected case: {ratePct(econ.rate.rate)} on x = {rp(econ.rate.x)}. Break-even revenue {rp(econ.breakEvenRevenue)}. Payment terms {ini.paymentTermsDays} days.
      </p>
      <table>
        <thead>
          <tr>
            <th>Risk</th>
            <th>Category</th>
            <th>Likelihood / impact</th>
            <th>Mitigation</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {ini.risks.length ? (
            ini.risks.map((r) => (
              <tr key={r.id}>
                <td>{r.description || "—"}</td>
                <td>{RISK_CATEGORIES[r.category]}</td>
                <td style={{ textTransform: "capitalize" }}>{r.level}</td>
                <td>{r.mitigation || "—"}</td>
                <td>{d.lead ? d.name(d.lead.userId) : "Project Lead"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="muted">
                No risks recorded.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p>
        <strong>Client credit check.</strong> {ini.newClient ? "New client — no payment history with the company." : "Existing client with payment history."} {d.deal ? `CRM deal: ${d.deal.name} (${rp(d.deal.amount)}).` : ""}
        {ini.unusualTerms ? " New country or market, or unusual liability terms — legal and tax review attached (Tier 3)." : ""}
      </p>

      <h3>Declaration</h3>
      <p>I confirm that this proposal is accurate and complete, that no commitment has been made to the client beyond what it states, and that the projected figures are my honest expected case.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Signature</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{d.name(ini.initiatorId)}</td>
            <td>
              <span className="sig" />
            </td>
            <td>{ini.submittedAt ? formatDate(ini.submittedAt, "medium") : ""}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="break">Annex D Part 1. Role and Weight Agreement</h2>
      <table>
        <tbody>
          <tr>
            <td className="k">Project name and code</td>
            <td>
              {ini.title}
              {ini.code ? ` · ${ini.code}` : ""}
            </td>
          </tr>
          <tr>
            <td className="k">Start date</td>
            <td>{formatDate(ini.startDate, "medium")}</td>
          </tr>
          {ini.type === "C" ? (
            <tr>
              <td className="k">Type C only: standard bonus fixed by the PRC, and any increase agreed at kickoff (Rp a month, at least 1,000,000) (Section 8.6)</td>
              <td>{rp(standardBonusOf(ini))}{ini.approvedAt ? " — fixed at approval" : " — proposed"}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Role(s)</th>
            <th className="num">Standard weight</th>
            <th className="num">Agreed weight</th>
            <th className="num">Allocation factor</th>
            <th className="num">W × A</th>
            <th>Line manager agreed</th>
            <th>Signature</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {d.initial.length ? (
            d.initial.map((m) => (
              <tr key={m.id}>
                <td>{d.name(m.userId)}</td>
                <td>{m.roles.map((r) => ROLE_META[r].label).join(" + ")}</td>
                <td className="num">{memberWeight({ ...m, weightOverride: null }).toFixed(2)}</td>
                <td className="num">{memberWeight(m).toFixed(2)}</td>
                <td className="num">{(m.allocationFactor ?? 1).toFixed(2)}</td>
                <td className="num">{effectiveWeight(m).toFixed(2)}</td>
                <td>{m.managerApproved ? "Yes" : "No"}</td>
                <td>{m.consent === "accepted" ? "Signed" : <span className="sig" />}</td>
                <td>{m.consent === "accepted" ? formatDate(m.joinedAt, "medium") : ""}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={9} className="muted">
                No members on the agreement yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p>
        <strong>Reason for any non-standard weight:</strong> {overrides.length ? overrides.map((m) => `${d.name(m.userId)} — ${m.weightNote || "reason not recorded"}`).join("; ") : "None — standard weights (§6.1) apply."}
      </p>
      <p>
        <strong>PRC check</strong> (eligibility, leadership capacity, line manager agreement): {prcChecked ? `checked${ini.approvedAt ? ` at approval, ${formatDate(ini.approvedAt, "medium")}` : ""}` : "pending"} · name <span className="sig" /> · signature <span className="sig" /> · date <span className="sig" />
      </p>

      <h2>For PRC use</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Entry</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="k">Tracking number</td>
            <td>{ini.trackingNo || "—"}</td>
          </tr>
          <tr>
            <td className="k">Decision (approved, conditionally approved, deferred, rejected)</td>
            <td>{dec ? `${OUTCOME[dec.outcome]}${dec.ceoVeto ? " (CEO veto)" : ""} — ${dec.rationale}` : ""}</td>
          </tr>
          <tr>
            <td className="k">Project code</td>
            <td>{ini.code ?? ""}</td>
          </tr>
          <tr>
            <td className="k">Confirmed type, x and revenue-share rate</td>
            <td>{approving ? `Type ${ini.type} · x ${rp(econ.rate.x)} · y ${ratePct(econ.rate.rate)} (${rateSourceLabel(econ.rate.source)})` : ""}</td>
          </tr>
          <tr>
            <td className="k">Deferral applied (percentage and period)</td>
            <td>{approving ? (d.deferral.length ? `${Math.round(d.defPct * 100)}% for ${ini.deferralMonths} months after close` : "None") : ""}</td>
          </tr>
          <tr>
            <td className="k">Conditions and deadline</td>
            <td>{dec?.conditions ? `${dec.conditions}${dec.conditionsDueAt ? ` — by ${formatDate(dec.conditionsDueAt, "medium")}` : ""}` : ""}</td>
          </tr>
          <tr>
            <td className="k">Decision date and signatures</td>
            <td>
              {dec ? `${formatDate(dec.decidedAt, "medium")} · recorded by ${d.name(dec.decidedById)} · votes ${dec.votesFor} for / ${dec.votesAgainst} against · ` : ""}
              <span className="sig" />
            </td>
          </tr>
          {ini.type === "C" ? (
            <tr>
              <td className="k">Type C only: standard bonus approved (Rp a month)</td>
              <td>{approving ? rp(standardBonusOf(ini)) : ""}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="muted">
        Decided by {t.decides} within {t.decisionBusinessDays} business days (§4.2). Attach a conflict-of-interest declaration (Annex F) from every proposed member.
      </p>
    </div>
  );
}
