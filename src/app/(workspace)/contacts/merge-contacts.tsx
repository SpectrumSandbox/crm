"use client";

import { useEffect, useMemo, useState } from "react";
import { useCrm, useUi } from "@/lib/store";
import { contactMatchReasons, formatPhone } from "@/lib/smart-lists";
import { useCompanyMap } from "@/lib/selectors";
import { lifecycleMeta } from "@/lib/meta";
import type { Contact } from "@/lib/types";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";

/** Merge two contact records: the survivor keeps its values, blanks are filled from the other, references move over. */
export function MergeContactsDialog({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const contacts = useCrm((s) => s.contacts);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const activities = useCrm((s) => s.activities);
  const mergeContacts = useCrm((s) => s.mergeContacts);
  const undoMerge = useCrm((s) => s.undoMerge);
  const notify = useUi((s) => s.notify);
  const companyMap = useCompanyMap();

  const pair = useMemo(() => ids.map((id) => contacts.find((c) => c.id === id)).filter((c): c is Contact => !!c), [ids, contacts]);
  // default survivor: the record with more history
  const usage = (id: string) => deals.filter((d) => d.contactIds.includes(id)).length * 3 + tickets.filter((t) => t.contactId === id).length * 2 + activities.filter((a) => a.links.contactIds.includes(id)).length;
  const [keepId, setKeepId] = useState(() => (usage(ids[0]) >= usage(ids[1]) ? ids[0] : ids[1]));
  useEffect(() => {
    if (pair.length < 2) onClose();
  }, [pair.length, onClose]);
  if (pair.length < 2) return null;

  const keep = pair.find((c) => c.id === keepId) ?? pair[0];
  const drop = pair.find((c) => c.id !== keep.id)!;
  const reasons = contactMatchReasons(pair[0], pair[1]);
  const rows: { label: string; value: (c: Contact) => string }[] = [
    { label: "Email", value: (c) => c.email },
    { label: "Phone", value: (c) => formatPhone(c.phone) },
    { label: "Job title", value: (c) => c.jobTitle },
    { label: "Company", value: (c) => companyMap.get(c.companyId ?? "")?.name ?? "" },
    { label: "Lifecycle", value: (c) => lifecycleMeta[c.lifecycleStage].label },
    { label: "Lead score", value: (c) => String(c.leadScore) },
    { label: "Last contacted", value: (c) => relativeTime(c.lastContactedAt) },
    { label: "Created", value: (c) => formatDate(c.createdAt) },
    { label: "Deals · tickets · activities", value: (c) => `${deals.filter((d) => d.contactIds.includes(c.id)).length} · ${tickets.filter((t) => t.contactId === c.id).length} · ${activities.filter((a) => a.links.contactIds.includes(c.id)).length}` },
  ];

  const merge = () => {
    const snap = mergeContacts(keep.id, drop.id);
    if (!snap) return;
    notify(`Merged ${snap.label} into ${keep.firstName} ${keep.lastName}${snap.summary.length ? ` · moved ${snap.summary.join(", ")}` : ""}`, { label: "Undo", run: () => undoMerge(snap) });
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Merge contacts"
      description="Pick the record to keep. Empty fields are filled from the other record; its deals, tickets, activities, Jira links and sequence enrolments move to the one you keep."
      className="w-[min(720px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={merge}>
            Merge into {keep.firstName} {keep.lastName}
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
                    <input type="radio" name="keep" checked={c.id === keep.id} onChange={() => setKeepId(c.id)} className="accent-white" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-sg-white">
                        {c.firstName} {c.lastName}
                      </span>
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
              const dv = r.value(drop);
              return (
                <tr key={r.label} className="border-t border-sg-line">
                  <td className="py-1.5 pr-2 text-2xs uppercase tracking-[0.1em] text-sg-dim">{r.label}</td>
                  {pair.map((c) => {
                    const v = r.value(c);
                    const fills = c.id === drop.id && !kv && !!dv;
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
      <p className="mt-3 text-2xs text-sg-dim">The highest lead score and the furthest lifecycle stage are kept. You can undo the merge from the confirmation toast.</p>
    </Modal>
  );
}
