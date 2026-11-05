"use client";

/* Deal record panels: origination evidence (§4.1), closed-won handoff banner, outcome summary and change history. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, History, Lock, Pencil, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { Deal, DealChange, DealOrigination } from "@/lib/types";
import { cn, formatDate, formatIDR, fromDateInput, isDateInput, toDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { FORECAST_META, ORIGINATION_LABEL, ORIGINATION_SOURCES, originationLocks, originationOf } from "./deal-signals";

const EMPTY_HISTORY: DealChange[] = [];

/* ───────────── origination (§4.1) ───────────── */

export function OriginationCard({ deal }: { deal: Deal }) {
  const activities = useCrm((s) => s.activities);
  const users = useCrm((s) => s.users);
  const pipelines = useCrm((s) => s.pipelines);
  const access = useAccess();
  const [editing, setEditing] = useState(false);
  const o = useMemo(() => originationOf(deal, activities), [deal, activities]);
  const stage = useMemo(() => pipelines.flatMap((p) => p.stages).find((s) => s.id === deal.stageId), [pipelines, deal.stageId]);
  const locked = !!deal.origination?.lockedAt || originationLocks(stage);
  const canEdit = !locked || access.prc;
  const evidence = activities.find((a) => a.id === o.evidenceActivityId);
  const sourceLabel = ORIGINATION_SOURCES[o.channel].find((x) => x.value === o.source)?.label;
  const originator = users.find((u) => u.id === o.originatorId);

  return (
    <div className="mt-4 rounded-lg border border-sg-line p-3">
      <div className="flex items-center justify-between">
        <span className="sg-eyebrow flex items-center gap-1.5">
          {locked ? <Lock className="size-3" /> : <ShieldCheck className="size-3" />} Origination · §4.1
        </span>
        <Button size="xs" variant="ghost" onClick={() => setEditing(true)} disabled={!canEdit} title={canEdit ? (locked ? "Amend as PRC — the change is logged" : "Record the origination evidence") : "Locked from Proposal Sent — only the PRC can amend it (disputes §14)"}>
          <Pencil /> {o.derived && !locked ? "Confirm" : locked ? "Amend" : "Edit"}
        </Button>
      </div>
      <div className="mt-1.5 text-sm font-semibold text-sg-white">{ORIGINATION_LABEL[o.channel]}</div>
      {sourceLabel && <div className="text-2xs text-sg-muted">{sourceLabel}</div>}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs">
        <dt className="text-sg-dim">Originator</dt>
        <dd className="text-sg-text">{o.channel === "company" ? "None — company channel (PRC appoints a Project Lead)" : (originator?.name ?? "—")}</dd>
        <dt className="text-sg-dim">First contact</dt>
        <dd className="text-sg-text">
          {o.firstContactAt ? formatDate(o.firstContactAt) : "—"}
          {evidence ? <span className="text-sg-dim"> · {evidence.subject}</span> : null}
        </dd>
      </dl>
      <p className={cn("mt-2 text-2xs", o.derived ? "text-soft-yellow" : "text-sg-dim")}>
        {o.derived
          ? "Derived from the earliest CRM activity — confirm it before Proposal Sent, when it locks."
          : locked
            ? `Locked${deal.origination?.lockedAt ? ` ${formatDate(deal.origination.lockedAt)}` : " at Proposal Sent"}. Disputes go to the PRC (§14).`
            : `Recorded by ${users.find((u) => u.id === deal.origination?.recordedById)?.name ?? "—"}${deal.origination?.recordedAt ? ` · ${formatDate(deal.origination.recordedAt)}` : ""}. Locks at Proposal Sent.`}
      </p>
      {deal.origination?.note && <p className="mt-1 whitespace-pre-line text-2xs text-sg-muted">{deal.origination.note}</p>}
      {editing && <OriginationDialog deal={deal} initial={o} locked={locked} onClose={() => setEditing(false)} />}
    </div>
  );
}

function OriginationDialog({ deal, initial, locked, onClose }: { deal: Deal; initial: DealOrigination; locked: boolean; onClose: () => void }) {
  const users = useCrm((s) => s.users);
  const activities = useCrm((s) => s.activities);
  const setDealOrigination = useCrm((s) => s.setDealOrigination);
  const notify = useUi((s) => s.notify);
  const [channel, setChannel] = useState(initial.channel);
  const [source, setSource] = useState(initial.source ?? "");
  const [originatorId, setOriginatorId] = useState(initial.originatorId ?? deal.ownerId);
  const [firstContact, setFirstContact] = useState(toDateInput(initial.firstContactAt));
  const [evidenceId, setEvidenceId] = useState(initial.evidenceActivityId ?? "");
  const [note, setNote] = useState(initial.note ?? "");
  const [reason, setReason] = useState("");
  const candidates = useMemo(
    () =>
      activities
        .filter((a) => a.type !== "jira" && (a.links.dealIds.includes(deal.id) || (!!deal.companyId && a.links.companyIds.includes(deal.companyId))))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, 12),
    [activities, deal.id, deal.companyId],
  );
  const dateOk = !firstContact || isDateInput(firstContact);
  const valid = dateOk && (!locked || reason.trim().length > 3);
  const save = () => {
    if (!valid) return;
    const ev = activities.find((a) => a.id === evidenceId);
    const err = setDealOrigination(
      deal.id,
      {
        channel,
        source: source || undefined,
        originatorId: channel === "company" ? null : originatorId,
        firstContactAt: ev ? ev.timestamp : firstContact ? fromDateInput(firstContact) : null,
        evidenceActivityId: ev?.id ?? null,
        note: note.trim() || undefined,
      },
      locked ? reason : undefined,
    );
    if (err) {
      notify(err);
      return;
    }
    notify(locked ? "Origination amended — logged on the timeline" : "Origination recorded");
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={locked ? "Amend origination (PRC)" : "Origination evidence"}
      description="The Project Initiator personally originated the opportunity; the earliest documented client contact in the CRM is the main evidence (§4.1)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel">
          <Select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as DealOrigination["channel"]);
              setSource("");
            }}
          >
            {(["personal", "follow_on", "company"] as const).map((c) => (
              <option key={c} value={c}>
                {ORIGINATION_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">— not specified —</option>
            {ORIGINATION_SOURCES[channel].map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Originator" className="col-span-2" hint={channel === "company" ? "Company channels carry no Project Initiator weight." : undefined}>
          <Select value={channel === "company" ? "" : originatorId} onChange={(e) => setOriginatorId(e.target.value)} disabled={channel === "company"}>
            {channel === "company" && <option value="">None (company channel)</option>}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Evidence: earliest documented contact" className="col-span-2">
          <Select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
            <option value="">No CRM activity — enter a date</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {formatDate(a.timestamp)} · {a.type} · {a.subject.slice(0, 60)}
              </option>
            ))}
          </Select>
        </Field>
        {!evidenceId && (
          <Field label="First contact date">
            <Input type="date" value={firstContact} onChange={(e) => setFirstContact(e.target.value)} aria-invalid={!dateOk} />
          </Field>
        )}
        <Field label="Note" className="col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Met Rina at the Hydro Expo booth we paid for — company channel" />
        </Field>
        {locked && (
          <Field label="Reason for amending (required)" className="col-span-2" hint="Recorded on the deal timeline for the PRC record.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ───────────── closed outcome + handoff ───────────── */

export function DealOutcome({ deal, closed }: { deal: Deal; closed?: "won" | "lost" }) {
  const initiatives = useCrm((s) => s.initiatives);
  const quotes = useCrm((s) => s.quotes);
  const linked = useMemo(() => initiatives.filter((i) => i.dealId === deal.id), [initiatives, deal.id]);
  const signed = useMemo(() => quotes.some((q) => q.dealId === deal.id && q.status === "signed"), [quotes, deal.id]);
  if (!closed) return null;
  if (closed === "lost")
    return (
      <div className="mt-3 rounded-lg border border-soft-red/40 bg-soft-red/10 p-3 text-xs">
        <div className="font-semibold text-soft-red">Lost{deal.lostReason ? ` · ${deal.lostReason}` : " · no reason recorded"}</div>
        {deal.lostToCompetitor && <div className="text-sg-text">to {deal.lostToCompetitor}</div>}
        {deal.closeNote && <p className="mt-1 whitespace-pre-line text-sg-muted">{deal.closeNote}</p>}
      </div>
    );
  return (
    <div className="mt-3 space-y-2">
      {(deal.poNumber || deal.winReason || deal.closeNote) && (
        <div className="rounded-lg border border-soft-green/30 bg-soft-green/10 p-3 text-xs">
          <div className="font-semibold text-soft-green">Won{deal.winReason ? ` · ${deal.winReason}` : ""}</div>
          {deal.poNumber && <div className="text-sg-text">PO / contract {deal.poNumber}</div>}
          {deal.closeNote && <p className="mt-1 whitespace-pre-line text-sg-muted">{deal.closeNote}</p>}
        </div>
      )}
      {!linked.length && (
        <div className="rounded-lg border border-soft-yellow/40 bg-soft-yellow/10 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-soft-yellow">
            <Briefcase className="size-3.5" /> Won {formatIDR(deal.amount)} — no PRC proposal yet
          </div>
          <p className="mt-0.5 text-sg-muted">Delivery and project bonuses start from an approved initiative (§4.3).</p>
          <Link href={`/initiatives/new?fromDeal=${encodeURIComponent(deal.id)}`} className="mt-1.5 inline-flex h-6 items-center gap-1 rounded bg-sg-white px-2 text-2xs font-bold text-sg-bg hover:bg-sg-white/90">
            Propose initiative
          </Link>
        </div>
      )}
      {!signed && (
        <p className="flex items-center gap-1.5 text-2xs text-soft-yellow">
          <TriangleAlert className="size-3" /> No signed quote on this deal
        </p>
      )}
    </div>
  );
}

/* ───────────── change history ───────────── */

export function useDealHistory(dealId: string) {
  const raw = useCrm((s) => s.dealHistory);
  const all = raw ?? EMPTY_HISTORY;
  return useMemo(() => all.filter((h) => h.dealId === dealId).sort((a, b) => b.at.localeCompare(a.at)), [all, dealId]);
}

export function DealHistoryList({ dealId }: { dealId: string }) {
  const rows = useDealHistory(dealId);
  const users = useCrm((s) => s.users);
  const pipelines = useCrm((s) => s.pipelines);
  const stageName = (id: unknown) => pipelines.flatMap((p) => p.stages).find((s) => s.id === id)?.name ?? String(id ?? "—");
  const fmt = (h: DealChange, v: string | number | null) => {
    if (v === null || v === undefined || v === "") return "—";
    if (h.field === "amount") return formatIDR(Number(v), "full");
    if (h.field === "closeDate") return formatDate(String(v));
    if (h.field === "stageId") return stageName(v);
    if (h.field === "ownerId") return users.find((u) => u.id === v)?.name ?? String(v);
    return FORECAST_META[v as keyof typeof FORECAST_META]?.label ?? String(v);
  };
  const label: Record<DealChange["field"], string> = { amount: "Amount", closeDate: "Close date", stageId: "Stage", ownerId: "Owner", forecastCategory: "Forecast" };
  const pushes = rows.filter((h) => h.field === "closeDate" && h.from && h.to && String(h.to).slice(0, 7) > String(h.from).slice(0, 7)).length;
  if (!rows.length) return <p className="px-1 py-1 text-2xs text-sg-dim">No tracked changes yet.</p>;
  return (
    <div className="space-y-1.5">
      {pushes > 0 && (
        <p className="flex items-center gap-1 text-2xs font-semibold text-soft-orange">
          <History className="size-3" /> Close date pushed to a later month ×{pushes}
        </p>
      )}
      <ol className="space-y-1.5">
        {rows.slice(0, 12).map((h) => {
          const up = h.field === "amount" && Number(h.to) > Number(h.from);
          const down = h.field === "amount" && Number(h.to) < Number(h.from);
          return (
            <li key={h.id} className="rounded-md border border-sg-line bg-sg-bg/40 px-2 py-1.5 text-2xs">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sg-white">{label[h.field]}</span>
                <span className="ml-auto text-sg-dim">
                  {formatDate(h.at, "short")} · {users.find((u) => u.id === h.byId)?.name.split(" ")[0] ?? "—"}
                </span>
              </div>
              <div className="sg-num mt-0.5 text-sg-muted">
                {fmt(h, h.from)} → <span className={cn("font-semibold", up ? "text-soft-green" : down ? "text-soft-red" : "text-sg-text")}>{fmt(h, h.to)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length > 12 && <p className="text-2xs text-sg-dim">+ {rows.length - 12} earlier changes</p>}
    </div>
  );
}
