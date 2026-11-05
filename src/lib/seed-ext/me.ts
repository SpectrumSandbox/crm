/* Extra persisted + synced collections for the "me" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot).
 *
 * disputes            §14 disputes and appeals (personal — visible to the employee, the handler and Finance/HR/PRC/ExCo)
 * agreementSignatures Annex B/C typed-name e-signature records (append-only)
 * companySummaries    §9.6 monthly company financial summary — aggregate figures only, visible to every employee
 *
 * Relative imports only (compiled by scripts/tsconfig.json through src/lib/seed.ts).
 */
import { initiativeSeed } from "../initiatives/seed";
import { paymentDate } from "../initiatives/engine";
import type { AgreementSignature, CompanySummary, Dispute } from "../initiatives/types";
import { buildCompanySummary, stageDeadline } from "../slices/program-extras";

const wib = (date: string, hour = 9, minute = 0) => new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`).toISOString();

const { bonusRuns, deferredBonuses, probationOutcomes, initiativeMembers } = initiativeSeed;

/** §9.6 summaries published for the released cycles of the demo data. */
const companySummaries: CompanySummary[] = bonusRuns
  .filter((r) => r.status === "released")
  .map((r) =>
    buildCompanySummary(
      r,
      { runs: bonusRuns.filter((x) => x.month <= r.month), deferred: deferredBonuses.filter((d) => d.month <= r.month), clawbacks: [], outcomes: probationOutcomes },
      { id: `csum-${r.month}`, publishedAt: r.releasedAt ?? paymentDate(r.month), publishedById: "u-maria", note: "Published with the release of the cycle (§9.6). Detailed figures go to the PRC only." },
    ),
  )
  .sort((a, b) => b.month.localeCompare(a.month));

/** Two sample §14 disputes so the queue is not empty: one at direct resolution, one escalated to the PRC. */
const disputes: Dispute[] = (() => {
  const out: Dispute[] = [];
  const line = (month: string, initiativeId: string, userId: string) => {
    const run = bonusRuns.find((r) => r.month === month);
    const l = run?.lines.find((x) => x.initiativeId === initiativeId && x.userId === userId);
    return run && l ? { run, l } : null;
  };
  const team = (initiativeId: string) => [...new Set(initiativeMembers.filter((m) => m.initiativeId === initiativeId).map((m) => m.userId))];

  const ayu = line("2026-09", "ini-cam-uas", "u-ayu");
  if (ayu) {
    const raised = wib("2026-10-06", 10, 15);
    const escalated = wib("2026-10-21", 14, 0);
    out.push({
      id: "dsp-demo-1",
      number: "DSP-2026-0001",
      raisedById: "u-ayu",
      category: "ledger",
      subject: "September work period starts on 1 Sep, not 15 Sep",
      detail: "My ledger row on the CAM UAS project shows a work period from 15 September, but I started on the flight-test rig on 1 September (see the kickoff minutes and Jira CAM-14). The weight-days for the September cycle are understated.",
      initiativeId: "ini-cam-uas",
      runMonth: "2026-09",
      lineRef: `line:${ayu.run.id}:ini-cam-uas`,
      amount: ayu.l.payable,
      claimedAmount: null,
      eventAt: paymentDate("2026-09"),
      raisedAt: raised,
      late: false,
      stage: "prc",
      stageStartedAt: escalated,
      dueAt: stageDeadline(escalated),
      handlerId: "u-sinta",
      involvedIds: team("ini-cam-uas"),
      proposal: { outcome: "rejected", text: "The PMO ledger was built from the signed Role and Weight Agreement, which records 15 September.", correction: null, byId: "u-sinta", at: wib("2026-10-14", 16, 0) },
      votes: [{ userId: "u-rani", stage: "prc", vote: "uphold", at: wib("2026-10-27", 11, 0) }],
      prcDecision: null,
      excoDecision: null,
      outcome: null,
      closedAt: null,
      correction: null,
      events: [
        { id: "dev-d1-1", at: raised, actorId: "u-ayu", kind: "raised", stage: "direct", text: "Ledger entry dispute raised · handled by Sinta Maharani" },
        { id: "dev-d1-2", at: wib("2026-10-14", 16, 0), actorId: "u-sinta", kind: "proposed", stage: "direct", text: "Not upheld proposed: The PMO ledger was built from the signed Role and Weight Agreement, which records 15 September." },
        { id: "dev-d1-3", at: escalated, actorId: "u-ayu", kind: "escalated", stage: "prc", text: "Escalated to the PRC: the agreement date is not my start date — the kickoff minutes show me on the rig from 1 September." },
        { id: "dev-d1-4", at: wib("2026-10-27", 11, 0), actorId: "u-rani", kind: "vote", stage: "prc", text: "Rani Wijaya voted to uphold the dispute" },
      ],
      demo: true,
    });
  }

  const lia = line("2026-10", "ini-cam-uas", "u-lia") ?? line("2026-09", "ini-cam-uas", "u-lia");
  if (lia) {
    const month = lia.run.month;
    const raised = wib("2026-11-02", 9, 40);
    out.push({
      id: "dsp-demo-2",
      number: "DSP-2026-0002",
      raisedById: "u-lia",
      category: "calculation",
      subject: "Allocation factor 0.5 applied twice",
      detail: "My statement for CAM UAS looks like the 0.5 allocation factor was applied to both the weight and the weight-days. Please check the calculation.",
      initiativeId: "ini-cam-uas",
      runMonth: month,
      lineRef: `line:${lia.run.id}:ini-cam-uas`,
      amount: lia.l.payable,
      claimedAmount: lia.l.payable * 2,
      eventAt: paymentDate(month),
      raisedAt: raised,
      ...(Date.parse(raised) - Date.parse(paymentDate(month)) > 30 * 86_400_000
        ? { late: true, lateReason: "Statement received late — I was on site at the CAM hangar without e-mail access." }
        : { late: false }),
      stage: "direct",
      stageStartedAt: raised,
      dueAt: stageDeadline(raised),
      handlerId: "u-maria",
      involvedIds: ["u-lia"],
      proposal: null,
      votes: [],
      prcDecision: null,
      excoDecision: null,
      outcome: null,
      closedAt: null,
      correction: null,
      events: [{ id: "dev-d2-1", at: raised, actorId: "u-lia", kind: "raised", stage: "direct", text: "Bonus calculation dispute raised · handled by Maria Gunadi" }],
      demo: true,
    });
  }
  return out;
})();

export const meSeed = {
  disputes,
  agreementSignatures: [] as AgreementSignature[],
  companySummaries,
};
