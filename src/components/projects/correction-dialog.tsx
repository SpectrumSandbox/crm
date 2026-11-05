"use client";

/* §8.5 — a payment paid in a released cycle is never edited or deleted; Finance records a correcting entry (positive or
 * negative) that is settled in the next open cycle (engine: addRevenueCorrection). */
import { useEffect, useState } from "react";
import { useCrm, useUi } from "@/lib/store";
import type { RevenueEntry } from "@/lib/initiatives/types";
import { parseAmount } from "@/lib/initiatives/team-rules";
import { formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";

const M = 1_000_000;

export function CorrectionDialog({ entry, onClose }: { entry: RevenueEntry | null; onClose: () => void }) {
  const addRevenueCorrection = useCrm((s) => s.addRevenueCorrection);
  const notify = useUi((s) => s.notify);
  const [revenue, setRevenue] = useState("");
  const [costs, setCosts] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (entry) {
      setRevenue("");
      setCosts("");
      setNote("");
    }
  }, [entry]);
  const r = parseAmount(revenue);
  const c = parseAmount(costs);
  const errors: string[] = [];
  if (!Number.isFinite(r) || !Number.isFinite(c)) errors.push("Enter numbers (Rp million, e.g. -50 or 1,5)");
  else if (!r && !c) errors.push("Enter the revenue or cost change");
  if (note.trim().length < 5) errors.push("State the reason");
  const submit = () => {
    if (!entry || errors.length) return;
    const id = addRevenueCorrection(entry.id, { revenue: Math.round(r * M), directCosts: Math.round(c * M) }, note.trim());
    notify(id ? "Correction recorded — settled in the next open cycle (§8.5)" : "Correction refused");
    onClose();
  };
  return (
    <Modal
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      title="Record a payment correction"
      description="This payment was paid in a released cycle, so it can't be edited or deleted. The correction (negative to reduce) is a new entry settled in the next open cycle (§8.5); recovering an overpayment from someone follows §9.4."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} title={errors.join("\n")} onClick={submit}>
            Record correction
          </Button>
        </>
      }
    >
      {entry ? (
        <div
          className="grid gap-3"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        >
          <p className="text-xs text-sg-muted">
            Original: {formatIDR(entry.revenue, "full")} revenue · {formatIDR(entry.directCosts, "full")} direct costs · cycle {entry.month}
            {entry.note ? ` · ${entry.note}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Revenue change, Rp million" hint={revenue && Number.isFinite(r) ? formatIDR(r * M, "full") : "e.g. -25 or 12,5"}>
              <Input autoFocus inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
            </Field>
            <Field label="Direct cost change, Rp million" hint={costs && Number.isFinite(c) ? formatIDR(c * M, "full") : undefined}>
              <Input inputMode="decimal" value={costs} onChange={(e) => setCosts(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Invoice INV-0412 credited by 25 jt" />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}
