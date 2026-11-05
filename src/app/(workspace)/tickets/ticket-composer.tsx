"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrm, useUi } from "@/lib/store";
import { BUSINESS_HOURS, SLA_POLICY, slaDueFor } from "@/lib/selectors";
import { ticketPriorityMeta } from "@/lib/meta";
import type { Ticket, TicketPriority } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";

const PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low"];
const CATEGORIES: Ticket["category"][] = ["Field Support", "Hardware Fault", "Software Defect", "Documentation", "Training"];
const WIB = 7 * 3_600_000;

/** ISO → "yyyy-mm-ddThh:mm" in WIB for <input type="datetime-local"> */
const toLocal = (iso: string) => new Date(Date.parse(iso) + WIB).toISOString().slice(0, 16);
/** "yyyy-mm-ddThh:mm" (WIB) → ISO, or null when empty / invalid */
const fromLocal = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}:00+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export interface ComposerPrefill {
  companyId?: string;
  contactId?: string;
  stageId?: string;
}

/**
 * New-ticket dialog for the service desk. Opened from the tickets list, the contact / company list rows and the
 * `/tickets?new=1&companyId=…&contactId=…` deep link. The SLA deadline counts service-desk business hours
 * (urgent: 24/7) and is shown before the ticket is created.
 */
export function TicketComposer({ prefill, onClose }: { prefill: ComposerPrefill; onClose: () => void }) {
  const router = useRouter();
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const openServiceTicket = useCrm((s) => s.openServiceTicket);
  const notify = useUi((s) => s.notify);

  const initialContact = contacts.find((c) => c.id === prefill.contactId);
  const supportLead = users.find((u) => u.team === "Service")?.id ?? currentUserId;
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState(prefill.companyId ?? initialContact?.companyId ?? "");
  const [contactId, setContactId] = useState(initialContact?.id ?? "");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [category, setCategory] = useState<Ticket["category"]>("Field Support");
  const [ownerId, setOwnerId] = useState(supportLead);
  const [override, setOverride] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const companyContacts = useMemo(
    () => contacts.filter((c) => !companyId || c.companyId === companyId).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    [contacts, companyId],
  );
  const computed = useMemo(() => slaDueFor(priority, now), [priority, now]);
  const overrideIso = override !== null ? fromLocal(override) : null;
  const dueIso = override !== null ? overrideIso : computed.dueAt;
  const valid = subject.trim().length > 2 && !!ownerId && !!dueIso && Date.parse(dueIso) > now;

  const submit = () => {
    if (!valid || !dueIso) return;
    const id = openServiceTicket({ subject, description, companyId: companyId || null, contactId: contactId || null, priority, category, ownerId, stageId: prefill.stageId, slaDueAt: override !== null ? dueIso : undefined });
    notify(`Ticket ${id.toUpperCase()} opened · SLA due ${formatDate(dueIso, "datetime")} WIB`, { label: "Open", run: () => router.push(`/tickets/${id}`) });
    onClose();
  };

  const policy = SLA_POLICY[priority];
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="New ticket"
      description={`Opens a ${category} ticket and logs it on the company and contact timelines.`}
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1 text-2xs text-sg-dim sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to create
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            Create ticket
          </Button>
        </>
      }
    >
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Field label="Subject" className="sm:col-span-2" hint={subject && subject.trim().length <= 2 ? "At least 3 characters" : undefined}>
          <Input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Gateway offline after power cut" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Symptoms, site, serial numbers, what has been tried…" />
        </Field>
        <Field label="Company">
          <Select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              if (contactId && !contacts.some((c) => c.id === contactId && c.companyId === e.target.value)) setContactId("");
            }}
          >
            <option value="">— none —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contact" hint={companyId ? `${companyContacts.length} at this company` : "Pick a company to narrow the list"}>
          <Select
            value={contactId}
            onChange={(e) => {
              setContactId(e.target.value);
              const co = contacts.find((c) => c.id === e.target.value)?.companyId;
              if (co && !companyId) setCompanyId(co);
            }}
          >
            <option value="">— none —</option>
            {companyContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
                {c.jobTitle ? ` · ${c.jobTitle}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={priority === p}
                onClick={() => setPriority(p)}
                className={cn("h-7 rounded border px-3 text-xs font-semibold", priority === p ? "border-sg-white text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
              >
                {ticketPriorityMeta[p].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as Ticket["category"])}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-lg border border-sg-line bg-sg-bg/50 p-3 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="sg-eyebrow">SLA deadline</div>
              <div className="mt-0.5 text-sm font-semibold text-sg-white">{dueIso ? `${formatDate(dueIso, "datetime")} WIB` : "Pick a valid date and time"}</div>
              <div className="text-2xs text-sg-dim">
                {override !== null
                  ? "Set by hand"
                  : `${ticketPriorityMeta[priority].label}: ${policy.label}${policy.basis === "business" ? ` · Mon–Fri ${String(BUSINESS_HOURS.startHour).padStart(2, "0")}:00–${BUSINESS_HOURS.endHour}:00 WIB, public holidays excluded` : ""}`}
              </div>
            </div>
            {override === null ? (
              <Button size="xs" variant="ghost" onClick={() => setOverride(toLocal(computed.dueAt))}>
                Change
              </Button>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => setOverride(null)}>
                Use the policy deadline
              </Button>
            )}
          </div>
          {override !== null && (
            <div className="mt-2">
              <Input type="datetime-local" aria-label="SLA due (WIB)" value={override} onChange={(e) => setOverride(e.target.value)} />
              {dueIso && Date.parse(dueIso) <= now ? <p className="mt-1 text-2xs text-soft-red">The deadline must be in the future.</p> : null}
              {!dueIso ? <p className="mt-1 text-2xs text-soft-red">Enter a date and time.</p> : null}
            </div>
          )}
          <p className="mt-2 text-2xs text-sg-dim">The clock pauses while the ticket is “Waiting on Customer” and resumes with the time that was left.</p>
        </div>
      </div>
    </Modal>
  );
}
