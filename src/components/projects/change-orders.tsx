"use client";

/* §5.6 change-order register. Approved COs add to project revenue; if they move x by more than 10 % the PRC resets the
 * rate (§5.1) — the new rate applies to revenue realised after the reset, bonuses already paid are not recalculated. */
import { useMemo, useState } from "react";
import { FileText, Plus, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { ChangeOrder, Initiative } from "@/lib/initiatives/types";
import { changeOrderImpact, CO_STATUS_META, parseAmount } from "@/lib/initiatives/team-rules";
import { formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { PolicyRef } from "./shared";

const M = 1_000_000;

export function ChangeOrdersCard({ ini }: { ini: Initiative }) {
  const cos = useCrm((s) => s.changeOrders);
  const users = useCrm((s) => s.users);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const setChangeOrderStatus = useCrm((s) => s.setChangeOrderStatus);
  const recordRateReset = useCrm((s) => s.recordRateReset);
  const notify = useUi((s) => s.notify);
  const access = useAccess();
  const [raising, setRaising] = useState(false);
  const [resetPct, setResetPct] = useState("");
  const [resetNote, setResetNote] = useState("");
  const mine = useMemo(() => cos.filter((c) => c.initiativeId === ini.id).sort((a, b) => a.ref.localeCompare(b.ref)), [cos, ini.id]);
  const impact = useMemo(() => changeOrderImpact(ini, cos, adjustments), [ini, cos, adjustments]);
  const name = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.name ?? id : "—");
  const latestApproved = impact.approved.reduce<ChangeOrder | undefined>((m, c) => (!m || (c.decidedAt ?? "") > (m.decidedAt ?? "") ? c : m), undefined);

  const step = (c: ChangeOrder, status: ChangeOrder["status"], msg: string) => {
    setChangeOrderStatus(c.id, status);
    notify(`${c.ref} ${msg}`);
  };

  const resetRate = Number(resetPct.replace(",", ".")) / 100;
  const resetValid = latestApproved && Number.isFinite(resetRate) && resetRate > 0 && resetRate <= 0.6 && resetNote.trim().length >= 5;

  return (
    <section className="rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sg-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 text-sg-muted" />
          <h2 className="font-display text-sm font-extrabold text-sg-white">Change orders</h2>
          <PolicyRef s="5.6" />
          <span className="text-2xs text-sg-dim">Out-of-scope work only adds revenue once a change order is approved</span>
        </div>
        <Button size="xs" variant="outline" onClick={() => setRaising(true)}>
          <Plus /> Raise change order
        </Button>
      </header>
      {impact.approved.length ? (
        <div className="grid grid-cols-2 gap-3 border-b border-sg-line px-4 py-2.5 text-xs md:grid-cols-4">
          <Stat label="Approved price change" value={formatIDR(impact.priceDelta)} />
          <Stat label="Approved cost change" value={formatIDR(impact.costDelta)} />
          <Stat label="Schedule change" value={`${impact.scheduleDeltaDays >= 0 ? "+" : ""}${impact.scheduleDeltaDays} days`} />
          <Stat label="x moves" value={`${impact.movePct >= 0 ? "+" : ""}${(impact.movePct * 100).toFixed(1)}%`} tone={Math.abs(impact.movePct) > 0.1 ? "red" : undefined} />
        </div>
      ) : null}
      {impact.resetNeeded ? (
        <div className="space-y-2 border-b border-sg-line bg-soft-red/5 px-4 py-3 text-xs">
          <p className="flex items-start gap-1.5 text-soft-red">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> Approved change orders move x by {(impact.movePct * 100).toFixed(1)}% ({formatIDR(impact.xBefore)} → {formatIDR(impact.xAfter)}) — more than 10%, so the PRC must reset the rate <PolicyRef s="5.1" />. The curve gives {(impact.curveRateAfter * 100).toFixed(3)}%; the new rate applies to revenue realised after the reset.
          </p>
          {access.prc ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New rate y, %" className="w-32">
                <Input inputMode="decimal" value={resetPct} onChange={(e) => setResetPct(e.target.value)} placeholder={(impact.curveRateAfter * 100).toFixed(3)} />
              </Field>
              <Field label="PRC reasons" className="min-w-[220px] flex-1">
                <Input value={resetNote} onChange={(e) => setResetNote(e.target.value)} placeholder="Recorded with the reset" />
              </Field>
              <Button
                size="sm"
                variant="primary"
                disabled={!resetValid}
                onClick={() => {
                  if (!latestApproved || !resetValid) return;
                  recordRateReset(latestApproved.id, resetRate, resetNote);
                  notify(`Rate reset to ${(resetRate * 100).toFixed(3)}% recorded (§5.1)`);
                  setResetPct("");
                  setResetNote("");
                }}
              >
                Record PRC rate reset
              </Button>
            </div>
          ) : (
            <p className="text-sg-muted">Only the PRC records the rate reset.</p>
          )}
        </div>
      ) : impact.lastReset ? (
        <p className="border-b border-sg-line px-4 py-2 text-2xs text-sg-muted">Rate reset by the PRC on {formatDate(impact.lastReset, "medium")} — {impact.approved.find((c) => c.rateResetAt === impact.lastReset)?.rateResetNote}</p>
      ) : null}
      {mine.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
                <th className="px-4 py-2 font-semibold">Ref</th>
                <th className="px-2 py-2 font-semibold">Change</th>
                <th className="px-2 py-2 text-right font-semibold">Price</th>
                <th className="px-2 py-2 text-right font-semibold">Cost</th>
                <th className="px-2 py-2 text-right font-semibold">Days</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sg-line">
              {mine.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="sg-num whitespace-nowrap px-4 py-2 text-xs text-sg-white">{c.ref}</td>
                  <td className="px-2 py-2">
                    <div className="text-sg-white">{c.title}</div>
                    {c.description ? <div className="text-2xs text-sg-dim">{c.description}</div> : null}
                    <div className="text-2xs text-sg-dim">
                      Raised by {name(c.raisedById)} · {formatDate(c.raisedAt, "short")}
                      {c.decidedAt ? ` · ${c.status} by ${name(c.decidedById)} ${formatDate(c.decidedAt, "short")}` : ""}
                    </div>
                  </td>
                  <td className="sg-num whitespace-nowrap px-2 py-2 text-right text-sg-white">{formatIDR(c.priceDelta)}</td>
                  <td className="sg-num whitespace-nowrap px-2 py-2 text-right text-sg-muted">{formatIDR(c.costDelta)}</td>
                  <td className="sg-num whitespace-nowrap px-2 py-2 text-right text-sg-muted">{c.scheduleDeltaDays}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <Chip color={CO_STATUS_META[c.status].color} dot>
                      {CO_STATUS_META[c.status].label}
                    </Chip>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {c.status === "draft" ? (
                      <Button size="xs" variant="ghost" onClick={() => step(c, "submitted", "sent to the client")}>
                        Send to client
                      </Button>
                    ) : null}
                    {c.status === "submitted" ? (
                      <Button size="xs" variant="ghost" onClick={() => step(c, "client_signed", "signed by the client")}>
                        Client signed
                      </Button>
                    ) : null}
                    {c.status !== "approved" && c.status !== "rejected" ? (
                      access.prc || access.certify ? (
                        <>
                          <Button size="xs" variant="ghost" disabled={c.status !== "client_signed"} title={c.status !== "client_signed" ? "The client signs the change order first" : "Approve — adds to project revenue"} onClick={() => step(c, "approved", "approved — adds to project revenue")}>
                            Approve
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => step(c, "rejected", "rejected")}>
                            Reject
                          </Button>
                        </>
                      ) : (
                        <span className="text-2xs text-sg-dim">PRC / Finance approves</span>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-sg-muted">No change orders. The Project Lead raises one for any work outside the approved scope; out-of-scope work done without one adds cost but no revenue (§5.6).</p>
      )}
      {impact.open.length ? <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">{impact.open.length} open — not counted in revenue until approved.</p> : null}
      <RaiseDialog ini={ini} open={raising} onOpenChange={setRaising} />
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div>
      <div className="sg-eyebrow">{label}</div>
      <div className={tone === "red" ? "sg-num mt-0.5 font-semibold text-soft-red" : "sg-num mt-0.5 font-semibold text-sg-white"}>{value}</div>
    </div>
  );
}

function RaiseDialog({ ini, open, onOpenChange }: { ini: Initiative; open: boolean; onOpenChange: (o: boolean) => void }) {
  const createChangeOrder = useCrm((s) => s.createChangeOrder);
  const notify = useUi((s) => s.notify);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [days, setDays] = useState("0");
  const p = parseAmount(price);
  const c = parseAmount(cost);
  const d = Number(days);
  const errors: string[] = [];
  if (title.trim().length < 3) errors.push("Title");
  if (!Number.isFinite(p)) errors.push("Price change is not a number");
  if (!Number.isFinite(c)) errors.push("Cost change is not a number");
  if (!Number.isInteger(d)) errors.push("Schedule change in whole days");
  if (Number.isFinite(p) && Number.isFinite(c) && p === 0 && c === 0 && d === 0) errors.push("Enter the price, cost or schedule change");
  const submit = () => {
    if (errors.length) return;
    createChangeOrder({ initiativeId: ini.id, title: title.trim(), description: description.trim(), priceDelta: Math.round(p * M), costDelta: Math.round(c * M), scheduleDeltaDays: d });
    notify("Change order raised — send it to the client for signature");
    setTitle("");
    setDescription("");
    setPrice("");
    setCost("");
    setDays("0");
    onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Raise a change order"
      description="Work outside the approved scope (§5.6). Values exclude VAT; a reduction is entered as a negative number."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} title={errors.join("\n")} onClick={submit}>
            Raise change order
          </Button>
        </>
      }
    >
      <div
        className="grid gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <Field label="Title">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Additional sensor node at the east pier" />
        </Field>
        <Field label="Scope change">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price change, Rp million" hint={Number.isFinite(p) && p ? formatIDR(p * M, "full") : "e.g. 150 or 1.500"}>
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Cost change, Rp million" hint={Number.isFinite(c) && c ? formatIDR(c * M, "full") : undefined}>
            <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label="Schedule change, days">
            <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d-]/g, ""))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
