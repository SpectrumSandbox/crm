"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";
import { isLikelyMobile } from "./tokens";

/** Enrol one or more contacts in a sequence, with per-contact warnings (already enrolled, no email / mobile, customer). */
export function EnrolDialog({ open, onOpenChange, sequenceId, contactIds: initial }: { open: boolean; onOpenChange: (v: boolean) => void; sequenceId?: string; contactIds?: string[] }) {
  const sequences = useCrm((s) => s.sequences);
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const enrollments = useCrm((s) => s.sequenceEnrollments);
  const enrollContacts = useCrm((s) => s.enrollContacts);
  const notify = useUi((s) => s.notify);
  const [seqId, setSeqId] = useState(sequenceId ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(initial ?? []));
  const [q, setQ] = useState("");
  const initialKey = (initial ?? []).join(",");
  useEffect(() => {
    if (!open) return;
    setSeqId(sequenceId ?? sequences.find((s) => s.active)?.id ?? "");
    setPicked(new Set(initial ?? []));
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sequenceId, initialKey]);

  const seq = sequences.find((s) => s.id === seqId);
  const kinds = new Set(seq?.steps.map((s) => s.kind) ?? []);
  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name] as const)), [companies]);

  const warnings = (contactId: string): string[] => {
    const c = contacts.find((x) => x.id === contactId);
    if (!c) return ["not found"];
    const w: string[] = [];
    const e = enrollments.find((x) => x.sequenceId === seqId && x.contactId === contactId);
    if (e && (e.status === "active" || e.status === "paused")) w.push("already enrolled — will be skipped");
    else if (e) w.push(`was in this sequence before (${e.status})`);
    const elsewhere = enrollments.filter((x) => x.contactId === contactId && x.sequenceId !== seqId && x.status === "active").length;
    if (elsewhere) w.push(`active in ${elsewhere} other sequence${elsewhere === 1 ? "" : "s"}`);
    if (kinds.has("email") && !c.email) w.push("no email address");
    if (kinds.has("whatsapp") && !isLikelyMobile(c.phone)) w.push("no mobile number for WhatsApp");
    if (c.lifecycleStage === "customer" || c.lifecycleStage === "evangelist") w.push("existing customer");
    if (c.leadStatus === "unqualified") w.push("marked unqualified");
    return w;
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts
      .filter((c) => !needle || `${c.firstName} ${c.lastName} ${c.email} ${c.jobTitle} ${companyName.get(c.companyId ?? "") ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
      .slice(0, 60);
  }, [contacts, q, picked, companyName]);

  const submit = () => {
    if (!seq || !picked.size) return;
    const r = enrollContacts(seq.id, Array.from(picked));
    notify(`${r.enrolled.length} enrolled in ${seq.name}${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped.map((x) => x.reason).join("; ")})` : ""}`);
    if (r.enrolled.length) onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Enrol in sequence"
      description="The first step is due straight away (or after its delay); later steps follow in WIB business days."
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">{picked.size} selected</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!seq || !picked.size || !seq.active} onClick={submit}>
            Enrol {picked.size || ""}
          </Button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      >
        <Field label="Sequence" hint={seq && !seq.active ? "This sequence is paused — turn it on before enrolling." : seq ? `${seq.steps.length} steps · ${seq.stopOnReply === false ? "keeps going after a reply" : "pauses when the contact replies"}` : undefined}>
          <Select value={seqId} onChange={(e) => setSeqId(e.target.value)}>
            <option value="">Pick a sequence…</option>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " (paused)"}
              </option>
            ))}
          </Select>
        </Field>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name, email, title or company" className="pl-7" aria-label="Search contacts" />
        </div>
        <ul className="mt-2 max-h-[38vh] overflow-y-auto rounded border border-sg-line">
          {list.map((c) => {
            const on = picked.has(c.id);
            const w = seq ? warnings(c.id) : [];
            return (
              <li key={c.id} className={cn("border-b border-sg-line last:border-b-0", on && "bg-sg-card-2/60")}>
                <label className="flex cursor-pointer items-start gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (on) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                    className="mt-0.5 accent-current"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-sg-white">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="ml-2 text-2xs text-sg-dim">
                      {c.jobTitle} · {companyName.get(c.companyId ?? "") ?? "No company"}
                    </span>
                    {w.length ? (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-2xs text-soft-orange">
                        <TriangleAlert className="size-3" aria-hidden /> {w.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
          {!list.length ? <li className="px-3 py-6 text-center text-xs text-sg-dim">No contacts match</li> : null}
        </ul>
      </div>
    </Modal>
  );
}
