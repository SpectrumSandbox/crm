"use client";

/*
 * Every deal stage change in the CRM goes through requestDealStage():
 *   - open stages move at once (with an Undo toast that restores stage, close date and removes the logged entry);
 *   - closed stages (won / lost) open the close dialog first: lost reason + competitor, or PO number + win reason,
 *     then — for a win — the delivery handoff (propose an initiative to the PRC, open a delivery issue).
 * The dialog host is mounted once by GlobalDialogs (src/components/shell/dialogs.tsx).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { Briefcase, CircleCheck, Kanban, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Deal } from "@/lib/types";
import { formatIDR, parseIDR } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { LOST_REASONS, WIN_REASONS } from "./deal-signals";

interface Pending {
  dealId: string;
  stageId: string;
}

const useDealCloseUi = create<{ pending: Pending | null; handoff: string | null; open: (p: Pending) => void; showHandoff: (dealId: string) => void; close: () => void }>()((set) => ({
  pending: null,
  handoff: null,
  open: (pending) => set({ pending, handoff: null }),
  showHandoff: (handoff) => set({ pending: null, handoff }),
  close: () => set({ pending: null, handoff: null }),
}));

const shortName = (d: Pick<Deal, "name">) => d.name.split(" — ")[1] ?? d.name;

/** Apply any deal patch through changeDeal and toast an Undo. Returns false when nothing changed. */
export function applyDealChange(dealId: string, patch: Partial<Deal>, message?: string) {
  const st = useCrm.getState();
  const deal = st.deals.find((d) => d.id === dealId);
  if (!deal) return false;
  const undo = st.changeDeal(dealId, patch);
  if (!undo) return false;
  const notify = useUi.getState().notify;
  notify(message ?? `${shortName(deal)} updated`, {
    label: "Undo",
    run: () => {
      useCrm.getState().undoDealChange(undo);
      notify(`${shortName(deal)} restored`);
    },
  });
  return true;
}

/** Move a deal to a stage from anywhere (board drag, stage bar, buttons, palette). Closed stages ask for the outcome first. */
export function requestDealStage(dealId: string, stageId: string) {
  const st = useCrm.getState();
  const deal = st.deals.find((d) => d.id === dealId);
  const stage = st.pipelines.flatMap((p) => p.stages).find((s) => s.id === stageId);
  if (!deal || !stage || deal.stageId === stageId) return;
  if (stage.closed) {
    useDealCloseUi.getState().open({ dealId, stageId });
    return;
  }
  applyDealChange(dealId, { stageId }, `${shortName(deal)} → ${stage.name}`);
}

export function DealCloseHost() {
  const pending = useDealCloseUi((s) => s.pending);
  const handoff = useDealCloseUi((s) => s.handoff);
  if (pending) return <CloseDialog key={`${pending.dealId}:${pending.stageId}`} pending={pending} />;
  if (handoff) return <HandoffDialog dealId={handoff} />;
  return null;
}

function CloseDialog({ pending }: { pending: Pending }) {
  const close = useDealCloseUi((s) => s.close);
  const showHandoff = useDealCloseUi((s) => s.showHandoff);
  const deal = useCrm((s) => s.deals.find((d) => d.id === pending.dealId));
  const pipelines = useCrm((s) => s.pipelines);
  const changeDeal = useCrm((s) => s.changeDeal);
  const notify = useUi((s) => s.notify);
  const stage = useMemo(() => pipelines.flatMap((p) => p.stages).find((s) => s.id === pending.stageId), [pipelines, pending.stageId]);
  const won = stage?.closed === "won";

  const [reason, setReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(() => (deal ? String(deal.amount) : ""));
  const [po, setPo] = useState("");
  const parsed = parseIDR(amount);

  if (!deal || !stage) return null;
  const needsCompetitor = !won && reason === "Lost to competitor";
  const valid = won ? parsed !== null && parsed >= 0 : !!reason && (!needsCompetitor || competitor.trim().length > 1);

  const confirm = () => {
    if (!valid) return;
    const patch: Partial<Deal> = won
      ? { stageId: stage.id, amount: parsed ?? deal.amount, poNumber: po.trim() || undefined, winReason: reason || undefined, closeNote: note.trim() || undefined }
      : { stageId: stage.id, lostReason: reason, lostToCompetitor: needsCompetitor ? competitor.trim() : undefined, closeNote: note.trim() || undefined };
    const undo = changeDeal(deal.id, patch);
    if (!undo) return;
    notify(`${shortName(deal)} — ${stage.name.toLowerCase()} · logged on the timeline`, {
      label: "Undo",
      run: () => {
        useCrm.getState().undoDealChange(undo);
        useDealCloseUi.getState().close();
        notify(`${shortName(deal)} reopened in its previous stage`);
      },
    });
    if (won) showHandoff(deal.id);
    else close();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={won ? `Mark “${shortName(deal)}” ${stage.name.toLowerCase()}` : `Mark “${shortName(deal)}” ${stage.name.toLowerCase()}`}
      description={won ? "Confirm the final amount — the close date is set to today (WIB)." : "Why was it lost? Reasons feed win/loss reporting."}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant={won ? "primary" : "danger"} onClick={confirm} disabled={!valid}>
            {won ? <CircleCheck /> : null} Mark {stage.name.toLowerCase()}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            confirm();
          }
        }}
      >
        {won ? (
          <>
            <Field label="Final amount (IDR)" hint={parsed !== null ? formatIDR(parsed, "full") : "Type e.g. 8.400.000.000 or 8,4 M"}>
              <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={parsed === null ? "border-soft-red/60" : undefined} aria-invalid={parsed === null} />
            </Field>
            <Field label="PO / contract number" hint="Optional — from the client's PO or SPK">
              <Input value={po} onChange={(e) => setPo(e.target.value)} placeholder="e.g. PO/NHS/2026/118" />
            </Field>
            <Field label="Main reason we won" className="col-span-2">
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">— not recorded —</option>
                {WIN_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Lost reason" className="col-span-2">
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Lost reason">
                {LOST_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={reason === r}
                    onClick={() => setReason(r)}
                    className={reason === r ? "h-7 rounded border border-soft-red bg-soft-red/15 px-2.5 text-xs font-semibold text-soft-red" : "h-7 rounded border border-sg-line px-2.5 text-xs font-semibold text-sg-muted hover:text-sg-white"}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>
            {needsCompetitor && (
              <Field label="Competitor" className="col-span-2">
                <Input autoFocus value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Who won the work?" />
              </Field>
            )}
          </>
        )}
        <Field label="Note" className="col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={won ? "Anything delivery should know (scope, LD clause, payment terms)…" : "What would have changed the outcome?"} />
        </Field>
        {!won && !reason && <p className="col-span-2 text-2xs text-soft-orange">Pick a lost reason to continue.</p>}
      </form>
    </Modal>
  );
}

/** After a win: the delivery handoff — PRC proposal (§4.3) and a delivery issue. */
function HandoffDialog({ dealId }: { dealId: string }) {
  const router = useRouter();
  const close = useDealCloseUi((s) => s.close);
  const deal = useCrm((s) => s.deals.find((d) => d.id === dealId));
  const quotes = useCrm((s) => s.quotes);
  const initiatives = useCrm((s) => s.initiatives);
  const openDialog = useUi((s) => s.openDialog);
  const dealQuotes = useMemo(() => quotes.filter((q) => q.dealId === dealId), [quotes, dealId]);
  const linked = useMemo(() => initiatives.filter((i) => i.dealId === dealId), [initiatives, dealId]);
  if (!deal) return null;
  const signed = dealQuotes.find((q) => q.status === "signed");

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Closed won — hand off to delivery"
      description={`${deal.name} · ${formatIDR(deal.amount, "full")}`}
      footer={
        <Button variant="ghost" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        {!signed && (
          <p className="flex items-start gap-2 rounded-lg border border-soft-yellow/40 bg-soft-yellow/10 px-3 py-2 text-xs text-sg-text">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-soft-yellow" />
            <span>
              No signed quote on this deal{dealQuotes.length ? ` (latest: ${dealQuotes[0].number}, ${dealQuotes[0].status.replace("_", " ")})` : ""}. Record the client's signature on the quote, or attach the PO / contract, before delivery starts.
            </span>
          </p>
        )}
        <div className="rounded-lg border border-sg-line p-3">
          <div className="sg-eyebrow mb-1 flex items-center gap-1.5">
            <Briefcase className="size-3" /> Project initiative (PRC)
          </div>
          {linked.length ? (
            <ul className="space-y-1">
              {linked.map((i) => (
                <li key={i.id}>
                  <Link href={`/initiatives/${i.id}`} onClick={close} className="font-semibold text-sg-white hover:underline">
                    {i.code ?? i.trackingNo ?? i.title}
                  </Link>{" "}
                  <span className="text-xs text-sg-muted">{i.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="text-xs text-sg-muted">No proposal yet. Start one prefilled from this deal — client, revenue, contract status, first CRM contact and milestones.</p>
              <Button
                className="mt-2"
                variant="primary"
                size="sm"
                onClick={() => {
                  close();
                  router.push(`/initiatives/new?fromDeal=${encodeURIComponent(dealId)}`);
                }}
              >
                <Briefcase /> Propose initiative
              </Button>
            </>
          )}
        </div>
        <div className="rounded-lg border border-sg-line p-3">
          <div className="sg-eyebrow mb-1 flex items-center gap-1.5">
            <Kanban className="size-3" /> Delivery work
          </div>
          <p className="text-xs text-sg-muted">Open the kick-off issue in Jira, linked to this deal as “implements”.</p>
          <Button
            className="mt-2"
            variant="outline"
            size="sm"
            onClick={() => {
              close();
              openDialog({ kind: "createIssue", link: { crmType: "deal", crmId: dealId, linkType: "implements" } });
            }}
          >
            <Kanban /> Create delivery issue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
