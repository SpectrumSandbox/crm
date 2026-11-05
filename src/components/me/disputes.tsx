"use client";

/*
 * §14 disputes — shared pieces: stage / SLA / outcome chips, the "Raise a dispute" dialog (pre-filled from a statement
 * line, ledger row, deferred bonus or clawback notice) and the "My disputes" card on /me.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare, Plus, Scale } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { DISPUTE_CATEGORIES, type Dispute, type DisputeCategory, type DisputeOutcome, type DisputeStage } from "@/lib/initiatives/types";
import { DISPUTE_CATEGORY_META, DISPUTE_STAGE_META, disputeSla, disputeTimeLimit, isLateDispute, outcomeLabel, statementDate } from "@/lib/slices/program-extras";
import { POLICY } from "@/lib/initiatives/policy";
import type { SpectrumColor } from "@/lib/types";
import { cn, formatDate, formatIDR, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { MoneyInput } from "@/components/ui/money-input";
import { Modal } from "@/components/ui/overlays";
import { Cite } from "@/components/initiatives/shared";
import { cycleLabel } from "./helpers";
import { Card, RpFull } from "./ui";

export const STAGE_COLOR: Record<DisputeStage, SpectrumColor> = { direct: "blue", prc: "orange", exco: "magenta", closed: "green" };
const OUTCOME_COLOR: Record<DisputeOutcome, SpectrumColor> = { upheld: "green", partially_upheld: "cyan", rejected: "red", withdrawn: "blue", settled: "green" };

export function DisputeStageChip({ d }: { d: Dispute }) {
  if (d.stage === "closed" && d.outcome) return <Chip color={OUTCOME_COLOR[d.outcome]}>{outcomeLabel(d)}</Chip>;
  return (
    <Chip color={STAGE_COLOR[d.stage]} dot>
      {DISPUTE_STAGE_META[d.stage].label}
    </Chip>
  );
}

export function DisputeSlaChip({ d, now = Date.now() }: { d: Dispute; now?: number }) {
  const sla = disputeSla(d, now);
  if (!sla) return null;
  return (
    <Chip color={sla.overdue ? "red" : sla.days <= 2 ? "orange" : "blue"} title={`Due ${formatDate(d.dueAt, "datetime")} WIB — 10 business days per stage (§14)`}>
      {sla.overdue ? `${-sla.days || "<1"} bd overdue` : sla.days === 0 ? "due today" : `${sla.days} bd left`}
    </Chip>
  );
}

export interface DisputePrefill {
  category?: DisputeCategory;
  subject?: string;
  initiativeId?: string | null;
  runMonth?: string | null;
  lineRef?: string | null;
  amount?: number | null;
  /** decision / event date for non-statement categories */
  eventAt?: string | null;
  /** short description of the source record, shown read-only */
  source?: string;
}

export function RaiseDisputeButton({ prefill, label = "Dispute", size = "xs", variant = "ghost", className }: { prefill: DisputePrefill; label?: string; size?: "xs" | "sm"; variant?: "ghost" | "outline" | "subtle"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)} title="Raise a §14 dispute about this entry">
        <Scale /> {label}
      </Button>
      {open && <RaiseDisputeModal open={open} onOpenChange={setOpen} prefill={prefill} />}
    </>
  );
}

export function RaiseDisputeModal({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (v: boolean) => void; prefill: DisputePrefill }) {
  const userId = useCrm((s) => s.currentUserId);
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const raiseDispute = useCrm((s) => s.raiseDispute);
  const notify = useUi((s) => s.notify);
  const router = useRouter();

  const [category, setCategory] = useState<DisputeCategory>(prefill.category ?? "calculation");
  const [initiativeId, setInitiativeId] = useState<string>(prefill.initiativeId ?? "");
  const [subject, setSubject] = useState(prefill.subject ?? "");
  const [detail, setDetail] = useState("");
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);
  const [eventDate, setEventDate] = useState(toDateInput(prefill.eventAt ?? new Date().toISOString()));
  const [lateReason, setLateReason] = useState("");

  const myProjects = useMemo(() => {
    const ids = new Set(members.filter((m) => m.userId === userId).map((m) => m.initiativeId));
    return initiatives.filter((i) => ids.has(i.id) || i.initiatorId === userId).sort((a, b) => a.title.localeCompare(b.title));
  }, [members, initiatives, userId]);

  const meta = DISPUTE_CATEGORY_META[category];
  // §14 step 1: statement disputes count from the statement (salary) date; the rest from the decision or event
  const eventAt = meta.basis === "statement" && prefill.runMonth ? statementDate(prefill.runMonth) : eventDate ? new Date(`${eventDate}T12:00:00+07:00`).toISOString() : "";
  const validDate = !!eventAt && !Number.isNaN(Date.parse(eventAt)) && Date.parse(eventAt) <= Date.now() + 86_400_000;
  const late = validDate && isLateDispute(eventAt);
  const ok = subject.trim().length >= 4 && detail.trim().length >= 10 && validDate && (!late || lateReason.trim().length >= 5);

  const submit = () => {
    if (!ok) return;
    const id = raiseDispute({
      category,
      subject,
      detail,
      initiativeId: initiativeId || null,
      runMonth: prefill.runMonth ?? null,
      lineRef: prefill.lineRef ?? null,
      amount: prefill.amount ?? null,
      claimedAmount,
      eventAt,
      lateReason: late ? lateReason : undefined,
    });
    if (!id) {
      notify("The dispute could not be raised — check the fields");
      return;
    }
    onOpenChange(false);
    notify("Dispute raised — the handler has 10 business days to resolve it directly (§14)", { label: "Open", run: () => router.push(`/disputes/${id}`) });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Raise a dispute"
      description="Policy v4.0 §14 — settled directly first, then the PRC, then the Executive Committee"
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!ok} onClick={submit}>
            <Scale /> Raise dispute
          </Button>
        </>
      }
    >
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        {prefill.source && (
          <div className="rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2 text-xs">
            <div className="sg-eyebrow">Disputed entry</div>
            <div className="mt-0.5 font-semibold text-sg-white">{prefill.source}</div>
            {prefill.amount != null && (
              <div className="mt-0.5 text-2xs text-sg-muted">
                Figure on the record: <RpFull value={prefill.amount} className="font-semibold text-sg-white" />
              </div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What it concerns" hint={meta.hint}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory)}>
              {DISPUTE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DISPUTE_CATEGORY_META[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
              <option value="">Not about one project</option>
              {myProjects.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code || i.trackingNo || "Draft"} · {i.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Work period starts 1 Sep, not 15 Sep" autoFocus={!prefill.subject} />
        </Field>
        <Field label="What is wrong, and what should it be?" hint="Give the evidence — minutes, Jira keys, e-mails, dates">
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} autoFocus={!!prefill.subject} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount you think is right (optional)" hint={claimedAmount != null ? formatIDR(claimedAmount, "full") : "Whole rupiah, e.g. 4.137.512 or 4,1 jt"}>
            <MoneyInput value={claimedAmount} onValueChange={setClaimedAmount} />
          </Field>
          {meta.basis === "statement" && prefill.runMonth ? (
            <Field label="Statement date" hint={`${cycleLabel(prefill.runMonth)} cycle · salary date`}>
              <Input value={formatDate(eventAt, "medium")} readOnly aria-readonly />
            </Field>
          ) : (
            <Field label={meta.basis === "statement" ? "Statement date" : "Date of the decision or event"}>
              <Input type="date" value={eventDate} max={toDateInput(new Date().toISOString())} onChange={(e) => setEventDate(e.target.value)} />
            </Field>
          )}
        </div>
        {validDate && (
          <p className={cn("rounded-lg border px-3 py-2 text-2xs", late ? "border-soft-orange/40 bg-soft-orange/[0.06] text-sg-text" : "border-sg-line text-sg-muted")}>
            {late ? (
              <>
                <span className="font-semibold text-soft-orange">After the time limit.</span> {meta.basis === "statement" ? "Calculation and ledger disputes" : "Other disputes"} must be raised within {POLICY.statementDisputeDays} days ({meta.basis === "statement" ? "of the statement date" : "of the decision or event"}) — the limit was {formatDate(disputeTimeLimit(eventAt), "medium")}. Explain why it is late; the handler decides whether to hear it.
              </>
            ) : (
              <>
                Within the {POLICY.statementDisputeDays}-day limit (until {formatDate(disputeTimeLimit(eventAt), "medium")}). <Cite s="14" />
              </>
            )}
          </p>
        )}
        {late && (
          <Field label="Why is it late?">
            <Input value={lateReason} onChange={(e) => setLateReason(e.target.value)} placeholder="e.g. statement not received while on leave" />
          </Field>
        )}
        <p className="text-2xs text-sg-dim">
          Finance, HR, the PRC and the Executive Committee see your dispute; members involved are recused from deciding it. This process does not limit your rights under Indonesian industrial relations law, including bipartite negotiation (§14).
        </p>
      </div>
    </Modal>
  );
}

/** /me — my disputes and their stage. */
export function MyDisputes({ userId }: { userId: string }) {
  const disputes = useCrm((s) => s.disputes);
  const initiatives = useCrm((s) => s.initiatives);
  const [open, setOpen] = useState(false);
  const mine = useMemo(() => disputes.filter((d) => d.raisedById === userId).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)), [disputes, userId]);
  const openCount = mine.filter((d) => d.stage !== "closed").length;
  return (
    <Card
      id="disputes"
      title={
        <>
          My disputes <Cite s="14" />
        </>
      }
      action={
        <>
          {openCount > 0 && <span className="text-2xs text-sg-dim">{openCount} open</span>}
          <Link href="/disputes" className="text-2xs font-semibold text-sg-muted hover:text-sg-white">
            All disputes →
          </Link>
          <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
            <Plus /> Raise a dispute
          </Button>
        </>
      }
    >
      {mine.length === 0 ? (
        <p className="text-xs text-sg-dim">
          No disputes. If a statement figure, a ledger entry, a role, a rating, a removal, a probation or forfeiture decision or a clawback looks wrong, raise it within {POLICY.statementDisputeDays} days — use <span className="font-semibold text-sg-muted">Dispute</span> on the line, or the button above.
        </p>
      ) : (
        <ul className="divide-y divide-sg-line">
          {mine.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
              <Link href={`/disputes/${d.id}`} className="min-w-0 flex-1 text-xs hover:underline">
                <span className="sg-num mr-1.5 text-2xs text-sg-dim">{d.number}</span>
                <span className="font-semibold text-sg-white">{d.subject}</span>
                <span className="block text-2xs text-sg-dim">
                  {DISPUTE_CATEGORY_META[d.category].label}
                  {d.initiativeId ? ` · ${initiatives.find((i) => i.id === d.initiativeId)?.title ?? "project"}` : ""} · raised {formatDate(d.raisedAt, "medium")}
                </span>
              </Link>
              <MessageSquare className="size-3 text-sg-dim" aria-hidden />
              <span className="sg-num text-2xs text-sg-dim">{d.events.filter((e) => e.kind === "comment").length}</span>
              <DisputeSlaChip d={d} />
              <DisputeStageChip d={d} />
            </li>
          ))}
        </ul>
      )}
      {open && <RaiseDisputeModal open={open} onOpenChange={setOpen} prefill={{}} />}
    </Card>
  );
}
