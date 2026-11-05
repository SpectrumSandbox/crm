"use client";

import { useEffect, useMemo, useState } from "react";
import { useCrm, useUi } from "@/lib/store";
import { companyMatchReasons } from "@/lib/smart-lists";
import { lifecycleMeta } from "@/lib/meta";
import type { Company } from "@/lib/types";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";

/** Merge two company records; contacts, deals, tickets, activities, Jira links, initiatives and child units move over. */
export function MergeCompaniesDialog({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const mergeCompanies = useCrm((s) => s.mergeCompanies);
  const undoMerge = useCrm((s) => s.undoMerge);
  const notify = useUi((s) => s.notify);

  const pair = useMemo(() => ids.map((id) => companies.find((c) => c.id === id)).filter((c): c is Company => !!c), [ids, companies]);
  const usage = (id: string) => contacts.filter((c) => c.companyId === id).length + deals.filter((d) => d.companyId === id).length * 3 + tickets.filter((t) => t.companyId === id).length;
  const [keepId, setKeepId] = useState(() => (usage(ids[0]) >= usage(ids[1]) ? ids[0] : ids[1]));
  useEffect(() => {
    if (pair.length < 2) onClose();
  }, [pair.length, onClose]);
  if (pair.length < 2) return null;

  const keep = pair.find((c) => c.id === keepId) ?? pair[0];
  const drop = pair.find((c) => c.id !== keep.id)!;
  const reasons = companyMatchReasons(pair[0], pair[1]);
  const parentOf = (c: Company) => companies.find((p) => p.id === c.parentId)?.name ?? "";
  const rows: { label: string; value: (c: Company) => string }[] = [
    { label: "Domain", value: (c) => c.domain },
    { label: "Parent", value: parentOf },
    { label: "Industry", value: (c) => c.industry },
    { label: "Tier", value: (c) => c.tier },
    { label: "Lifecycle", value: (c) => lifecycleMeta[c.lifecycleStage].label },
    { label: "City", value: (c) => c.city },
    { label: "Phone", value: (c) => c.phone },
    { label: "Annual revenue", value: (c) => (c.annualRevenue ? formatIDR(c.annualRevenue) : "") },
    { label: "Created", value: (c) => formatDate(c.createdAt) },
    { label: "Contacts · deals · tickets", value: (c) => `${contacts.filter((x) => x.companyId === c.id).length} · ${deals.filter((d) => d.companyId === c.id).length} · ${tickets.filter((t) => t.companyId === c.id).length}` },
  ];

  const merge = () => {
    const snap = mergeCompanies(keep.id, drop.id);
    if (!snap) return;
    notify(`Merged ${snap.label} into ${keep.name}${snap.summary.length ? ` · moved ${snap.summary.join(", ")}` : ""}`, { label: "Undo", run: () => undoMerge(snap) });
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Merge companies"
      description="Pick the record to keep. Empty fields are filled from the other; the higher tier and the furthest lifecycle stage win."
      className="w-[min(720px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={merge}>
            Merge into {keep.name}
          </Button>
        </>
      }
    >
      {reasons.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-2xs text-sg-muted">
          Why they look the same:
          {reasons.map((r) => (
            <Chip key={r} color="yellow">
              {r}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr>
              <th className="w-40" />
              {pair.map((c) => (
                <th key={c.id} className="px-2 pb-2 text-left">
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5", c.id === keep.id ? "border-sg-white bg-sg-card-2" : "border-sg-line")}>
                    <input type="radio" name="keep-company" checked={c.id === keep.id} onChange={() => setKeepId(c.id)} className="accent-white" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-sg-white">{c.name}</span>
                      <span className="block text-2xs font-normal text-sg-dim">{c.id === keep.id ? "Keep this record" : "Merge into the other"}</span>
                    </span>
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const kv = r.value(keep);
              return (
                <tr key={r.label} className="border-t border-sg-line">
                  <td className="py-1.5 pr-2 text-2xs uppercase tracking-[0.1em] text-sg-dim">{r.label}</td>
                  {pair.map((c) => {
                    const v = r.value(c);
                    const fills = c.id === drop.id && !kv && !!v;
                    return (
                      <td key={c.id} className={cn("px-2 py-1.5", c.id === keep.id ? "text-sg-white" : "text-sg-muted", fills && "text-soft-green")}>
                        {v || <span className="text-sg-dim">—</span>}
                        {fills ? <span className="ml-1 text-2xs">(fills the blank)</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-2xs text-sg-dim">Child business units of the merged company move under the one you keep. Account plans are combined. You can undo from the confirmation toast.</p>
    </Modal>
  );
}
