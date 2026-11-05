"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, CalendarDays, CircleAlert, FileText, Handshake, Kanban, Mail, Phone, Search, StickyNote, SquareCheck, Ticket, TriangleAlert, User } from "lucide-react";
import { useCrm, useUi, type DialogState } from "@/lib/store";
import { CAPABILITIES, ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, LIFECYCLE_STAGES, LINK_TYPES, type Capability, type CompanyTier, type CrmObjectType, type IssuePriority, type IssueStatus, type IssueType, type LifecycleStage, type LinkType, type Ticket as TicketRecord, type TicketPriority } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, lifecycleMeta, linkTypeMeta, priorityMeta, ticketPriorityMeta } from "@/lib/meta";
import { cn, formatDate, formatIDR, fromDateInput, fromDateTimeInput, isDateInput, parseIDR, toDateInput, toDateTimeInput } from "@/lib/utils";
import { defaultSlaDue, SLA_TARGETS } from "@/lib/slices/crm-extras";
import type { Contact, Company, Deal, EmailTemplate, User as UserRecord } from "@/lib/types";
import { Modal, Tabs } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/misc";
import { shortcutsFor } from "./hotkeys";
import { DealCloseHost } from "@/components/crm/deal-close";
import { composeDealName, ORIGINATION_LABEL, ORIGINATION_SOURCES } from "@/components/crm/deal-signals";
import { quoteTotals, settingsOf } from "@/components/crm/quote-math";
import type { DealOrigination } from "@/lib/types";

export function GlobalDialogs() {
  return (
    <>
      <DealCloseHost />
      <ActiveDialog />
    </>
  );
}

function ActiveDialog() {
  const dialog = useUi((s) => s.dialog);
  const close = useUi((s) => s.closeDialog);
  if (!dialog) return null;
  const props = { onClose: close };
  switch (dialog.kind) {
    case "createDeal":
      return <CreateDealDialog {...props} d={dialog} />;
    case "createIssue":
      return <CreateIssueDialog {...props} d={dialog} />;
    case "createContact":
      return <CreateContactDialog {...props} d={dialog} />;
    case "createCompany":
      return <CreateCompanyDialog {...props} />;
    case "logActivity":
      return <LogActivityDialog {...props} d={dialog} />;
    case "linkIssue":
      return <LinkIssueDialog {...props} d={dialog} />;
    case "linkRecord":
      return <LinkRecordDialog {...props} d={dialog} />;
    case "generateQuote":
      return <GenerateQuoteDialog {...props} d={dialog} />;
    case "shortcuts":
      return <ShortcutsDialog {...props} />;
  }
}

type Props<K extends DialogState["kind"]> = { onClose: () => void; d: Extract<DialogState, { kind: K }> };

/** submit on ⌘/Ctrl+Enter anywhere inside a dialog form */
function useSubmitHotkey(submit: () => void, enabled: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && enabled) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, enabled]);
}

function SubmitHint() {
  return (
    <span className="mr-auto hidden items-center gap-1 text-2xs text-sg-dim sm:flex">
      <Kbd>⌘</Kbd>
      <Kbd>↵</Kbd> to save
    </span>
  );
}

/* ───────────────────────── Create deal ───────────────────────── */

function CreateDealDialog({ onClose, d }: Props<"createDeal">) {
  const router = useRouter();
  const pipelines = useCrm((s) => s.pipelines);
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const createDeal = useCrm((s) => s.createDeal);
  const notify = useUi((s) => s.notify);
  const dealPipelines = pipelines.filter((p) => p.objectType === "deal");

  const [pipelineId, setPipelineId] = useState(d.pipelineId ?? dealPipelines[0]?.id ?? "");
  const pipeline = dealPipelines.find((p) => p.id === pipelineId) ?? dealPipelines[0];
  const [stageId, setStageId] = useState(d.stageId ?? pipeline?.stages[0]?.id ?? "");
  const [companyId, setCompanyId] = useState(d.companyId ?? "");
  const [contactId, setContactId] = useState(d.contactId ?? "");
  const company = companies.find((c) => c.id === companyId);
  const isCustomer = (c: Company | undefined) => !!c && (c.lifecycleStage === "customer" || c.lifecycleStage === "evangelist");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [tbd, setTbd] = useState(false);
  const [closeDate, setCloseDate] = useState(toDateInput(new Date(Date.now() + 45 * 86_400_000).toISOString()));
  const [ownerId, setOwnerId] = useState(company?.ownerId ?? currentUserId);
  const [capability, setCapability] = useState<Capability>(CAPABILITIES[0]);
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dealType, setDealType] = useState<Deal["dealType"]>(() => (isCustomer(companies.find((c) => c.id === d.companyId)) ? "Expansion" : "New Business"));
  const [typeTouched, setTypeTouched] = useState(false);
  const [channel, setChannel] = useState<DealOrigination["channel"]>(() => (isCustomer(companies.find((c) => c.id === d.companyId)) ? "follow_on" : "personal"));
  const [source, setSource] = useState("");
  const [originatorId, setOriginatorId] = useState(currentUserId);

  useEffect(() => {
    if (pipeline && !pipeline.stages.some((s) => s.id === stageId)) setStageId(pipeline.stages[0].id);
  }, [pipeline, stageId]);

  const parsedAmount = parseIDR(amount);
  const amountOk = tbd ? parsedAmount === null || parsedAmount >= 0 : parsedAmount !== null && parsedAmount > 0;
  const dateOk = isDateInput(closeDate);
  const finalName = composeDealName(name, company, companies);
  const valid = name.trim().length > 1 && amountOk && dateOk && !!stageId;
  const blocker = name.trim().length <= 1 ? "Name the deal" : !amountOk ? (tbd ? "Amount must be a number" : "Enter an amount above 0, or tick “Amount TBD”") : !dateOk ? "Pick a close date" : "";
  const submit = () => {
    if (!valid) return;
    const id = createDeal({
      name: finalName,
      amount: parsedAmount ?? 0,
      pipelineId: pipeline!.id,
      stageId,
      closeDate: fromDateInput(closeDate),
      ownerId,
      companyId: companyId || null,
      contactIds: contactId ? [contactId] : [],
      priority,
      dealType,
      capability,
      description: tbd && !parsedAmount ? "Amount to be confirmed." : "",
      origination: { channel, source: source || (channel === "follow_on" ? "follow_on" : undefined), originatorId: channel === "company" ? null : originatorId, firstContactAt: null, evidenceActivityId: null, recordedById: currentUserId, recordedAt: new Date().toISOString(), lockedAt: null },
    });
    notify("Deal created");
    onClose();
    router.push(`/deals/${id}`);
  };
  useSubmitHotkey(submit, valid);

  const companyContacts = contacts.filter((c) => !companyId || c.companyId === companyId);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create deal"
      description="Adds the deal to the pipeline and logs it on the company timeline."
      footer={
        <>
          {valid ? <SubmitHint /> : <span className="mr-auto text-2xs text-soft-orange">{blocker}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            Create deal
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Deal name" className="col-span-2" hint={finalName && finalName !== name.trim() ? `Saved as “${finalName}”` : undefined}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drone inspection programme — phase 1" />
        </Field>
        <Field label="Amount (IDR)" hint={parsedAmount !== null ? formatIDR(parsedAmount, "full") : "e.g. 2.500.000.000 · 2,5 M · 720 jt"}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2.500.000.000" aria-invalid={!!amount && !amountOk} className={amount && !amountOk ? "border-soft-red/60" : undefined} />
          <label className="mt-1 flex items-center gap-1.5 text-2xs text-sg-muted">
            <input type="checkbox" checked={tbd} onChange={(e) => setTbd(e.target.checked)} className="size-3.5 accent-white" /> Amount TBD
          </label>
        </Field>
        <Field label="Close date">
          <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} aria-invalid={!dateOk} className={dateOk ? undefined : "border-soft-red/60"} />
          {!dateOk && <p className="mt-1 text-2xs text-soft-red">Pick a close date</p>}
        </Field>
        <Field label="Pipeline">
          <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            {dealPipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stage">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {pipeline?.stages
              .filter((s) => !s.closed)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({Math.round(s.probability * 100)}%)
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Company">
          <Select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setContactId("");
              const c = companies.find((x) => x.id === e.target.value);
              if (c) setOwnerId(c.ownerId);
              if (!typeTouched) {
                setDealType(isCustomer(c) ? "Expansion" : "New Business");
                setChannel(isCustomer(c) ? "follow_on" : "personal");
              }
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
        <Field label="Primary contact">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— none —</option>
            {companyContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deal type" hint={!typeTouched && isCustomer(company) ? "Expansion — the company is already a customer" : undefined}>
          <Select
            value={dealType}
            onChange={(e) => {
              setDealType(e.target.value as Deal["dealType"]);
              setTypeTouched(true);
            }}
          >
            {(["New Business", "Expansion", "Renewal"] as const).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Capability">
          <Select value={capability} onChange={(e) => setCapability(e.target.value as Capability)}>
            {CAPABILITIES.map((c) => (
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
        <Field label="Priority">
          <div className="flex gap-1">
            {(["high", "medium", "low"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)} className={cn("h-7 rounded border px-3 text-xs font-semibold capitalize", priority === p ? "border-sg-white text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}>
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="How did this opportunity come in? (§4.1)" className="col-span-2" hint={channel === "company" ? "Company channels carry no Project Initiator weight — the PRC appoints a Project Lead." : "The earliest documented client contact in the CRM is the main evidence; it is locked at Proposal Sent."}>
          <div className="grid grid-cols-3 gap-2">
            <Select
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as DealOrigination["channel"]);
                setSource("");
              }}
              aria-label="Origination channel"
            >
              {(["personal", "follow_on", "company"] as const).map((c) => (
                <option key={c} value={c}>
                  {ORIGINATION_LABEL[c]}
                </option>
              ))}
            </Select>
            <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Origination source">
              <option value="">— source —</option>
              {ORIGINATION_SOURCES[channel].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select value={channel === "company" ? "" : originatorId} onChange={(e) => setOriginatorId(e.target.value)} disabled={channel === "company"} aria-label="Originator">
              {channel === "company" ? <option value="">No initiator (company channel)</option> : null}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  Originator: {u.name}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────── Create issue ───────────────────────── */

function CreateIssueDialog({ onClose, d }: Props<"createIssue">) {
  const projects = useCrm((s) => s.projects);
  const epics = useCrm((s) => s.epics);
  const sprints = useCrm((s) => s.sprints);
  const users = useCrm((s) => s.users);
  const createIssue = useCrm((s) => s.createIssue);
  const notify = useUi((s) => s.notify);
  const openIssue = useUi((s) => s.openIssue);

  const [projectId, setProjectId] = useState(d.projectId ?? projects[0]?.id ?? "");
  const [type, setType] = useState<IssueType>(d.link?.crmType === "ticket" ? "support_escalation" : d.link?.crmType === "deal" ? "deal_action" : "task");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>(d.status ?? "todo");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [epicId, setEpicId] = useState("");
  const activeSprint = sprints.find((s) => s.projectId === projectId && s.state === "active");
  const [sprintId, setSprintId] = useState(activeSprint?.id ?? "");
  const [points, setPoints] = useState("");
  const [linkType, setLinkType] = useState<LinkType>(d.link?.linkType ?? (d.link?.crmType === "ticket" ? "escalated_from" : "relates_to"));

  useEffect(() => {
    setEpicId("");
    setSprintId(sprints.find((s) => s.projectId === projectId && s.state === "active")?.id ?? "");
  }, [projectId, sprints]);

  const valid = summary.trim().length > 2 && !!projectId;
  const submit = () => {
    if (!valid) return;
    const id = createIssue({
      projectId,
      type,
      summary: summary.trim(),
      description,
      status,
      priority,
      assigneeId: assigneeId || null,
      epicId: epicId || null,
      sprintId: sprintId || null,
      storyPoints: points ? Number(points) : null,
      link: d.link ? { ...d.link, linkType } : undefined,
    });
    notify("Issue created");
    onClose();
    openIssue(id);
  };
  useSubmitHotkey(submit, valid);
  const record = useLinkedRecordLabel(d.link?.crmType, d.link?.crmId);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create issue"
      description={record ? `Will be linked to ${record}` : "Adds a work item to the agile board."}
      footer={
        <>
          <SubmitHint />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            Create issue
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as IssueType)}>
            {ISSUE_TYPES.filter((t) => t !== "subtask").map((t) => (
              <option key={t} value={t}>
                {issueTypeMeta[t].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Summary" className="col-span-2">
          <Input autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What needs to happen?" />
        </Field>
        <Field label="Description" className="col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Context, acceptance criteria, links…" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)}>
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {issueStatusMeta[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityMeta[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assignee">
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Story points">
          <Select value={points} onChange={(e) => setPoints(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 5, 8, 13].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Epic">
          <Select value={epicId} onChange={(e) => setEpicId(e.target.value)}>
            <option value="">No epic</option>
            {epics
              .filter((e) => e.projectId === projectId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.key} · {e.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Sprint">
          <Select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Backlog (no sprint)</option>
            {sprints
              .filter((s) => s.projectId === projectId && s.state !== "closed")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.state === "active" ? "· active" : ""}
                </option>
              ))}
          </Select>
        </Field>
        {d.link && (
          <Field label="Link type" className="col-span-2" hint={`Read as: this issue ${linkTypeMeta[linkType].label} ${record}`}>
            <Select value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)}>
              {LINK_TYPES.map((l) => (
                <option key={l} value={l}>
                  {linkTypeMeta[l].label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function useLinkedRecordLabel(type?: CrmObjectType, id?: string) {
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  if (!type || !id) return "";
  if (type === "contact") {
    const c = contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : "";
  }
  if (type === "company") return companies.find((x) => x.id === id)?.name ?? "";
  if (type === "deal") return deals.find((x) => x.id === id)?.name ?? "";
  return tickets.find((x) => x.id === id)?.subject ?? "";
}

/* ───────────────────────── Create contact / company ───────────────────────── */

function CreateContactDialog({ onClose, d }: Props<"createContact">) {
  const router = useRouter();
  const companies = useCrm((s) => s.companies);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const createContact = useCrm((s) => s.createContact);
  const notify = useUi((s) => s.notify);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [companyId, setCompanyId] = useState(d.companyId ?? "");
  const [stage, setStage] = useState<LifecycleStage>("lead");
  const [ownerId, setOwnerId] = useState(currentUserId);

  // suggest company from email domain (HubSpot-style auto-association)
  useEffect(() => {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || companyId) return;
    const match = companies.find((c) => domain === c.domain || domain.endsWith("." + c.domain) || c.domain.endsWith("." + domain));
    if (match) setCompanyId(match.id);
  }, [email, companies, companyId]);

  const contacts = useCrm((s) => s.contacts);
  /** same email (case-insensitive) — blocks creation */
  const emailDuplicate = useMemo(() => {
    const needle = email.trim().toLowerCase();
    return needle ? contacts.find((c) => c.email.trim().toLowerCase() === needle) : undefined;
  }, [contacts, email]);
  /** same first + last name at the same company — warning only */
  const nameDuplicates = useMemo(() => {
    const f = firstName.trim().toLowerCase();
    const l = lastName.trim().toLowerCase();
    if (!f || !companyId) return [];
    return contacts.filter((c) => c.companyId === companyId && c.firstName.trim().toLowerCase() === f && c.lastName.trim().toLowerCase() === l && c.id !== emailDuplicate?.id);
  }, [contacts, firstName, lastName, companyId, emailDuplicate]);

  const valid = firstName.trim().length > 0 && /\S+@\S+\.\S+/.test(email) && !emailDuplicate;
  const submit = () => {
    if (!valid) return;
    const company = companies.find((c) => c.id === companyId);
    const id = createContact({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone,
      jobTitle,
      companyId: companyId || null,
      ownerId,
      lifecycleStage: stage,
      leadStatus: "new",
      leadScore: stage === "lead" ? 35 : stage === "mql" ? 55 : stage === "sql" ? 70 : 20,
      city: company?.city ?? "Jakarta",
      source: "Outbound",
    });
    notify("Contact created");
    onClose();
    router.push(`/contacts/${id}`);
  };
  useSubmitHotkey(submit, valid);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create contact"
      footer={
        <>
          <SubmitHint />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            Create contact
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Email" className="col-span-2" hint={emailDuplicate ? undefined : "Company is matched automatically from the email domain."}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.co.id" className={emailDuplicate ? "border-soft-red/60" : undefined} aria-invalid={!!emailDuplicate} />
        </Field>
        {emailDuplicate && <DuplicateNotice tone="block" contacts={[emailDuplicate]} companies={companies} onOpen={onClose} />}
        {nameDuplicates.length > 0 && <DuplicateNotice tone="warn" contacts={nameDuplicates} companies={companies} onOpen={onClose} />}
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62 …" />
        </Field>
        <Field label="Job title">
          <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <Field label="Company">
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">— none —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lifecycle stage">
          <Select value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)}>
            {LIFECYCLE_STAGES.map((s) => (
              <option key={s} value={s}>
                {lifecycleMeta[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" className="col-span-2">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function DuplicateNotice({ tone, contacts, companies, onOpen }: { tone: "block" | "warn"; contacts: Contact[]; companies: Company[]; onOpen: () => void }) {
  const block = tone === "block";
  return (
    <div role={block ? "alert" : "status"} className={cn("col-span-2 rounded-lg border px-3 py-2 text-xs", block ? "border-soft-red/40 bg-soft-red/10" : "border-soft-yellow/40 bg-soft-yellow/10")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", block ? "text-soft-red" : "text-soft-yellow")}>
        {block ? <CircleAlert className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
        {block ? "A contact with this email already exists — open it instead of creating a duplicate." : "Possible duplicate: same name at the same company. You can still create this contact."}
      </div>
      <ul className="mt-1.5 space-y-1">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <Link href={`/contacts/${c.id}`} onClick={onOpen} className="font-semibold text-sg-white hover:underline">
              {c.firstName} {c.lastName}
            </Link>
            <span className="truncate text-sg-muted">
              {c.email}
              {c.companyId ? ` · ${companies.find((x) => x.id === c.companyId)?.name ?? ""}` : ""}
            </span>
            <span className="ml-auto shrink-0 text-sg-dim">{lifecycleMeta[c.lifecycleStage].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateCompanyDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const companies = useCrm((s) => s.companies);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const createCompany = useCrm((s) => s.createCompany);
  const enrichCompany = useCrm((s) => s.enrichCompany);
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("Jakarta");
  const [tier, setTier] = useState<CompanyTier>("Mid-Market");
  const [parentId, setParentId] = useState("");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [enrich, setEnrich] = useState(true);

  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const duplicate = companies.find((c) => cleanDomain && c.domain === cleanDomain);
  const valid = name.trim().length > 1 && /\./.test(cleanDomain) && !duplicate;
  const submit = () => {
    if (!valid) return;
    const id = createCompany({
      name: name.trim(),
      domain: cleanDomain,
      industry: industry || "Unclassified",
      city,
      country: "Indonesia",
      employees: 0,
      annualRevenue: 0,
      phone: "",
      description: "",
      tier,
      parentId: parentId || null,
      ownerId,
      lifecycleStage: "lead",
    });
    if (enrich) enrichCompany(id);
    notify(enrich ? "Company created and enriched" : "Company created");
    onClose();
    router.push(`/companies/${id}`);
  };
  useSubmitHotkey(submit, valid);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create company"
      footer={
        <>
          <SubmitHint />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            Create company
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company name" className="col-span-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Domain" className="col-span-2" hint={duplicate ? `Already in CRM: ${duplicate.name}` : "Used for de-duplication, contact auto-association and enrichment."}>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="company.co.id" className={duplicate ? "border-soft-red/60" : undefined} />
        </Field>
        <Field label="Industry">
          <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Mining" />
        </Field>
        <Field label="City">
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="Tier">
          <Select value={tier} onChange={(e) => setTier(e.target.value as CompanyTier)}>
            {(["Strategic", "Enterprise", "Mid-Market", "Emerging"] as const).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Parent company">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— none —</option>
            {companies
              .filter((c) => !c.parentId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
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
        <label className="flex items-end gap-2 pb-1.5 text-sm text-sg-muted">
          <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="size-4 accent-white" />
          Enrich from domain
        </label>
      </div>
    </Modal>
  );
}

/* ───────────────────────── New ticket (rendered by /tickets) ───────────────────────── */

const TICKET_CATEGORIES: TicketRecord["category"][] = ["Hardware Fault", "Software Defect", "Field Support", "Documentation", "Training"];
const TICKET_PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low"];
const toWibLocal = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 16);
const fromWibLocal = (v: string) => new Date(`${v}:00+07:00`).toISOString();

export function NewTicketDialog({ onClose, companyId: initialCompanyId, stageId, onCreated }: { onClose: () => void; companyId?: string; stageId?: string; onCreated?: (id: string) => void }) {
  const router = useRouter();
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const createTicket = useCrm((s) => s.createTicket);
  const notify = useUi((s) => s.notify);

  const supportLead = users.find((u) => u.team === "Service")?.id ?? currentUserId;
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState(initialCompanyId ?? "");
  const [contactId, setContactId] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [category, setCategory] = useState<TicketRecord["category"]>("Field Support");
  const [ownerId, setOwnerId] = useState(supportLead);
  const [slaLocal, setSlaLocal] = useState(() => toWibLocal(defaultSlaDue("medium")));
  const [slaTouched, setSlaTouched] = useState(false);

  const companyContacts = useMemo(() => contacts.filter((c) => !companyId || c.companyId === companyId).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)), [contacts, companyId]);

  const pickPriority = (p: TicketPriority) => {
    setPriority(p);
    if (!slaTouched) setSlaLocal(toWibLocal(defaultSlaDue(p)));
  };

  const slaValid = !!slaLocal && !Number.isNaN(Date.parse(fromWibLocal(slaLocal)));
  const valid = subject.trim().length > 2 && slaValid && !!ownerId;
  const submit = () => {
    if (!valid) return;
    const id = createTicket({
      subject,
      description,
      companyId: companyId || null,
      contactId: contactId || null,
      priority,
      category,
      ownerId,
      stageId,
      slaDueAt: fromWibLocal(slaLocal),
    });
    notify(`Ticket ${id.toUpperCase()} opened`, { label: "Open", run: () => router.push(`/tickets/${id}`) });
    onCreated?.(id);
    onClose();
  };
  useSubmitHotkey(submit, valid);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="New ticket"
      description={`Opens a ${category} ticket in Field Support and logs it on the company and contact timelines.`}
      footer={
        <>
          <SubmitHint />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            Create ticket
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Subject" className="col-span-2">
          <Input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Gateway offline after power cut" />
        </Field>
        <Field label="Description" className="col-span-2">
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
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— none —</option>
            {companyContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
                {c.jobTitle ? ` · ${c.jobTitle}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" className="col-span-2">
          <div className="flex gap-1">
            {TICKET_PRIORITIES.map((p) => (
              <button key={p} type="button" onClick={() => pickPriority(p)} className={cn("h-7 rounded border px-3 text-xs font-semibold", priority === p ? "border-sg-white text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}>
                {ticketPriorityMeta[p].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as TicketRecord["category"])}>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.team === "Service" ? " · Service" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SLA due (WIB)" className="col-span-2" hint={slaTouched ? `Set manually · default for ${ticketPriorityMeta[priority].label.toLowerCase()} is ${SLA_TARGETS[priority]}` : `Default for ${ticketPriorityMeta[priority].label.toLowerCase()} priority: ${SLA_TARGETS[priority]} → ${slaValid ? formatDate(fromWibLocal(slaLocal), "datetime") : "—"}`}>
          <div className="flex items-center gap-2">
            <Input
              type="datetime-local"
              value={slaLocal}
              onChange={(e) => {
                setSlaLocal(e.target.value);
                setSlaTouched(true);
              }}
              className={slaValid ? undefined : "border-soft-red/60"}
            />
            {slaTouched && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSlaTouched(false);
                  setSlaLocal(toWibLocal(defaultSlaDue(priority)));
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────── Log activity ───────────────────────── */

const activityTabs = [
  { value: "call" as const, label: "Call", icon: Phone },
  { value: "email" as const, label: "Email", icon: Mail },
  { value: "meeting" as const, label: "Meeting", icon: CalendarDays },
  { value: "note" as const, label: "Note", icon: StickyNote },
  { value: "task" as const, label: "Task", icon: SquareCheck },
];

/* email template personalisation */

const TEMPLATE_TOKENS = ["contact.first_name", "company.name", "deal.name", "deal.capability", "owner.first_name", "owner.meeting_link"] as const;
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

interface TemplateContext {
  contact?: Contact;
  company?: Company;
  deal?: Deal;
  owner?: UserRecord;
}

/** contact / company / deal / owner as seen from the record the email is logged on */
function templateContext(
  target: { type: CrmObjectType; id: string } | undefined,
  data: { contacts: Contact[]; companies: Company[]; deals: Deal[]; tickets: TicketRecord[]; users: UserRecord[]; openStage: (stageId: string) => boolean },
): TemplateContext {
  if (!target) return {};
  const { contacts, companies, deals, tickets, users, openStage } = data;
  const byRecency = (a: Deal, b: Deal) => a.closeDate.localeCompare(b.closeDate);
  const openDealFor = (pred: (d: Deal) => boolean) => deals.filter((d) => pred(d) && openStage(d.stageId)).sort(byRecency)[0] ?? deals.filter(pred).sort(byRecency)[0];
  let contact: Contact | undefined;
  let company: Company | undefined;
  let deal: Deal | undefined;
  let ownerId: string | undefined;
  if (target.type === "contact") {
    contact = contacts.find((c) => c.id === target.id);
    company = companies.find((c) => c.id === contact?.companyId);
    deal = contact ? openDealFor((d) => d.contactIds.includes(contact!.id)) : undefined;
    ownerId = contact?.ownerId;
  } else if (target.type === "company") {
    company = companies.find((c) => c.id === target.id);
    contact = contacts.filter((c) => c.companyId === target.id).sort((a, b) => b.leadScore - a.leadScore)[0];
    deal = openDealFor((d) => d.companyId === target.id);
    ownerId = company?.ownerId;
  } else if (target.type === "deal") {
    deal = deals.find((d) => d.id === target.id);
    company = companies.find((c) => c.id === deal?.companyId);
    contact = contacts.find((c) => c.id === deal?.contactIds[0]);
    ownerId = deal?.ownerId;
  } else {
    const t = tickets.find((x) => x.id === target.id);
    contact = contacts.find((c) => c.id === t?.contactId);
    company = companies.find((c) => c.id === t?.companyId);
    deal = t?.companyId ? openDealFor((d) => d.companyId === t.companyId) : undefined;
    ownerId = t?.ownerId;
  }
  return { contact, company, deal, owner: users.find((u) => u.id === ownerId) };
}

function tokenValue(token: string, ctx: TemplateContext): string | undefined {
  switch (token) {
    case "contact.first_name":
      return ctx.contact?.firstName || undefined;
    case "company.name":
      return ctx.company?.name || undefined;
    case "deal.name":
      return ctx.deal?.name || undefined;
    case "deal.capability":
      return ctx.deal?.capability || undefined;
    case "owner.first_name":
      return ctx.owner?.name.split(" ")[0] || undefined;
    case "owner.meeting_link":
      return ctx.owner ? `https://crm.spectrumgroup.id/meet/${ctx.owner.id}` : undefined;
    default:
      return undefined;
  }
}

/** replace every resolvable token; unresolved ones are left as {{token}} so they stay visible */
function renderTemplate(text: string, ctx: TemplateContext) {
  return text.replace(TOKEN_RE, (whole, token: string) => tokenValue(token, ctx) ?? whole);
}

function unresolvedTokens(...texts: string[]) {
  const found = new Set<string>();
  texts.forEach((t) => {
    for (const m of t.matchAll(TOKEN_RE)) found.add(m[1]);
  });
  return Array.from(found);
}

function TemplatePicker({ templates, value, onPick }: { templates: EmailTemplate[]; value: string; onPick: (t: EmailTemplate | null) => void }) {
  const users = useCrm((s) => s.users);
  return (
    <Field label="Template" hint={`Tokens: ${TEMPLATE_TOKENS.map((t) => `{{${t}}}`).join(" ")}`}>
      <Select value={value} onChange={(e) => onPick(templates.find((t) => t.id === e.target.value) ?? null)}>
        <option value="">No template — write from scratch</option>
        {Array.from(new Set(templates.map((t) => t.category))).map((cat) => (
          <optgroup key={cat} label={cat}>
            {templates
              .filter((t) => t.category === cat)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {users.find((u) => u.id === t.ownerId)?.name.split(" ")[0] ?? ""}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

function LogActivityDialog({ onClose, d }: Props<"logActivity">) {
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const users = useCrm((s) => s.users);
  const pipelines = useCrm((s) => s.pipelines);
  const emailTemplates = useCrm((s) => s.emailTemplates);
  const addActivity = useCrm((s) => s.addActivity);
  const currentUserId = useCrm((s) => s.currentUserId);
  const notify = useUi((s) => s.notify);

  const [type, setType] = useState(d.activityType);
  const [target, setTarget] = useState<{ type: CrmObjectType; id: string } | undefined>(d.target);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<"connected" | "left_voicemail" | "no_answer" | "busy" | "wrong_number">("connected");
  const [duration, setDuration] = useState("15");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [due, setDue] = useState(toDateInput(new Date(Date.now() + 2 * 86_400_000).toISOString()));
  const [dueTime, setDueTime] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [when, setWhen] = useState(() => toDateTimeInput(new Date().toISOString()));

  /** contacts this activity can also be logged on (attendees), and which are ticked by default */
  const candidates = useMemo(() => {
    if (!target) return { list: [] as Contact[], defaults: [] as string[] };
    if (target.type === "deal") {
      const deal = deals.find((x) => x.id === target.id);
      const list = contacts.filter((c) => deal?.contactIds.includes(c.id));
      return { list, defaults: list.map((c) => c.id) };
    }
    if (target.type === "company") return { list: contacts.filter((c) => c.companyId === target.id), defaults: [] };
    if (target.type === "ticket") {
      const t = tickets.find((x) => x.id === target.id);
      const list = contacts.filter((c) => c.id === t?.contactId || (!!t?.companyId && c.companyId === t.companyId));
      return { list, defaults: t?.contactId ? [t.contactId] : [] };
    }
    return { list: [] as Contact[], defaults: [] };
  }, [target, contacts, deals, tickets]);
  const [attendees, setAttendees] = useState<string[] | null>(null);
  const picked = attendees ?? candidates.defaults;
  useEffect(() => setAttendees(null), [target]);

  /** resolve associations the way HubSpot does: contact → its company; deal → its company + the attendees picked */
  const links = useMemo(() => {
    const l = { contactIds: [] as string[], companyIds: [] as string[], dealIds: [] as string[], ticketIds: [] as string[] };
    if (!target) return l;
    if (target.type === "contact") {
      l.contactIds.push(target.id);
      const c = contacts.find((x) => x.id === target.id);
      if (c?.companyId) l.companyIds.push(c.companyId);
    }
    if (target.type === "company") l.companyIds.push(target.id);
    if (target.type === "deal") {
      l.dealIds.push(target.id);
      const deal = deals.find((x) => x.id === target.id);
      if (deal?.companyId) l.companyIds.push(deal.companyId);
    }
    if (target.type === "ticket") {
      l.ticketIds.push(target.id);
      const t = tickets.find((x) => x.id === target.id);
      if (t?.companyId) l.companyIds.push(t.companyId);
    }
    picked.forEach((id) => !l.contactIds.includes(id) && l.contactIds.push(id));
    return l;
  }, [target, contacts, deals, tickets, picked]);

  const label = useLinkedRecordLabel(target?.type, target?.id);

  /* templates (email only) */
  const [templateId, setTemplateId] = useState("");
  const [confirmUnresolved, setConfirmUnresolved] = useState(false);
  const tplCtx = useMemo(() => {
    const closed = new Set(pipelines.flatMap((p) => p.stages.filter((st) => st.closed).map((st) => st.id)));
    return templateContext(target, { contacts, companies, deals, tickets, users, openStage: (id) => !closed.has(id) });
  }, [target, contacts, companies, deals, tickets, users, pipelines]);
  const applyTemplate = (t: EmailTemplate | null) => {
    setTemplateId(t?.id ?? "");
    setConfirmUnresolved(false);
    if (!t) return;
    setSubject(renderTemplate(t.subject, tplCtx));
    setBody(renderTemplate(t.body, tplCtx));
  };
  const unresolved = type === "email" ? unresolvedTokens(subject, body) : [];
  useEffect(() => setConfirmUnresolved(false), [subject, body]);

  const whenIso = fromDateTimeInput(when);
  const whenOk = type === "task" || (!!whenIso && Date.parse(whenIso) <= Date.now() + 60_000);
  const dueOk = type !== "task" || (isDateInput(due) && (!dueTime || /^\d{2}:\d{2}$/.test(dueTime)));
  const valid = !!target && (subject.trim().length > 0 || body.trim().length > 0) && whenOk && dueOk;
  const blocker = !target ? "" : !(subject.trim() || body.trim()) ? (type === "note" ? "Write the note" : "Add a subject or notes") : !whenOk ? (whenIso ? "“When” can't be in the future" : "Pick when it happened") : !dueOk ? "Pick a due date" : "";
  const submit = () => {
    if (!valid) return;
    if (unresolved.length && !confirmUnresolved) {
      setConfirmUnresolved(true);
      return;
    }
    // notes: first line is the subject (same as the timeline composer), the rest is the body
    const [firstLine, ...restLines] = body.trim().split("\n");
    const noteSubject = (firstLine ?? "").slice(0, 90) || "Note";
    const noteBody = restLines.join("\n").trim() || ((firstLine ?? "").length > 90 ? (firstLine ?? "") : "");
    const defaultSubject = { call: `Call with ${label}`, email: `Email: ${label}`, meeting: `Meeting: ${label}`, note: "Note", task: "Follow up" }[type];
    addActivity({
      type,
      subject: type === "note" ? noteSubject : subject.trim() || defaultSubject,
      body: type === "note" ? noteBody : body,
      links,
      ...(type !== "task" && whenIso ? { timestamp: whenIso } : {}),
      ...(type === "call" ? { callOutcome: outcome, durationMin: Number(duration) || 0, direction } : {}),
      ...(type === "email" ? { direction } : {}),
      ...(type === "meeting" ? { durationMin: Number(duration) || 0 } : {}),
      ...(type === "task" ? { dueAt: dueTime ? fromDateTimeInput(`${due}T${dueTime}`) : fromDateInput(due), done: false, ownerId: assigneeId, ...(assigneeId !== currentUserId ? { createdById: currentUserId } : {}) } : {}),
    });
    const assignee = users.find((u) => u.id === assigneeId);
    notify(type === "task" && assigneeId !== currentUserId ? `Task assigned to ${assignee?.name ?? "teammate"}` : `${type[0].toUpperCase() + type.slice(1)} logged`);
    onClose();
  };
  useSubmitHotkey(submit, valid);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Log ${type}`}
      description={target ? `On ${label}` : "Choose the record this belongs to"}
      footer={
        <>
          {valid || !blocker ? <SubmitHint /> : <span className="mr-auto text-2xs text-soft-orange">{blocker}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            {type === "task" ? "Create task" : confirmUnresolved && unresolved.length ? "Log with unresolved tokens" : `Log ${type}`}
          </Button>
        </>
      }
    >
      <Tabs
        value={type}
        onChange={setType}
        className="-mx-5 -mt-4 mb-4 px-4"
        items={activityTabs.map((t) => ({ value: t.value, label: <><t.icon className="size-3.5" /> {t.label}</> }))}
      />
      {!target && (
        <div className="mb-4">
          <RecordPicker onPick={(type, id) => setTarget({ type, id })} types={["contact", "company", "deal", "ticket"]} />
        </div>
      )}
      {target && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded border border-sg-line bg-sg-bg/50 px-3 py-2 text-xs">
            <span className="text-sg-muted">
              Associated with <span className="font-semibold text-sg-white">{label}</span>
              {links.companyIds.length + links.dealIds.length + links.contactIds.length + links.ticketIds.length > 1 && <span className="text-sg-dim"> + {links.companyIds.length + links.dealIds.length + links.contactIds.length + links.ticketIds.length - 1} related</span>}
            </span>
            {!d.target && (
              <button
                type="button"
                className="text-sg-dim hover:text-sg-white"
                onClick={() => {
                  setTarget(undefined);
                  setTemplateId("");
                }}
              >
                change
              </button>
            )}
          </div>
          {type === "email" && emailTemplates.length > 0 && <TemplatePicker templates={emailTemplates} value={templateId} onPick={applyTemplate} />}
          {type !== "note" && <Field label={type === "task" ? "Task" : "Subject"}><Input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
          {type === "call" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Outcome">
                <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                  <option value="connected">Connected</option>
                  <option value="left_voicemail">Left voicemail</option>
                  <option value="no_answer">No answer</option>
                  <option value="busy">Busy</option>
                  <option value="wrong_number">Wrong number</option>
                </Select>
              </Field>
              <Field label="Direction">
                <Select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound</option>
                </Select>
              </Field>
              <Field label="Minutes">
                <Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
              </Field>
            </div>
          )}
          {type === "email" && (
            <Field label="Direction">
              <Select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                <option value="outbound">Sent</option>
                <option value="inbound">Received</option>
              </Select>
            </Field>
          )}
          {type === "meeting" && (
            <Field label="Duration (minutes)">
              <Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
          )}
          {type === "task" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Due date">
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={!isDateInput(due)} className={isDateInput(due) ? undefined : "border-soft-red/60"} />
              </Field>
              <Field label="Time (WIB, optional)" hint={dueTime ? undefined : "Defaults to 17:00"}>
                <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </Field>
              <Field label="Assignee">
                <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === currentUserId ? `${u.name} (me)` : u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {type !== "task" && (
            <Field label="When (WIB)" hint={whenIso && Math.abs(Date.parse(whenIso) - Date.now()) > 5 * 60_000 ? `Logged as ${formatDate(whenIso, "datetime")} — "Last contacted" uses this time` : "Now, or pick an earlier time"}>
              <Input type="datetime-local" value={when} max={toDateTimeInput(new Date().toISOString())} onChange={(e) => setWhen(e.target.value)} aria-invalid={!whenOk} className={whenOk ? undefined : "border-soft-red/60"} />
            </Field>
          )}
          {candidates.list.length > 0 && type !== "task" && (
            <Field label="Also log on" hint={type === "note" ? undefined : `Updates "Last contacted" for ${picked.length === 1 ? "this contact" : `these ${picked.length} contacts`}`}>
              <div className="flex flex-wrap gap-1">
                {candidates.list.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setAttendees(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])}
                      className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", on ? "border-sg-white bg-sg-card-3 text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
                    >
                      {c.firstName} {c.lastName}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <Field label={type === "note" ? "Note" : type === "email" ? "Body" : "Notes"} hint={type === "note" ? "The first line becomes the note's title" : undefined}>
            <Textarea autoFocus={type === "note"} value={body} onChange={(e) => setBody(e.target.value)} placeholder={type === "call" ? "What was discussed? Next steps?" : ""} className={type === "email" && templateId ? "min-h-[160px]" : undefined} />
          </Field>
          {unresolved.length > 0 && (
            <div role="alert" className={cn("rounded-lg border px-3 py-2 text-xs", confirmUnresolved ? "border-soft-red/50 bg-soft-red/10" : "border-soft-yellow/40 bg-soft-yellow/10")}>
              <div className={cn("flex items-center gap-1.5 font-semibold", confirmUnresolved ? "text-soft-red" : "text-soft-yellow")}>
                <TriangleAlert className="size-3.5" />
                {unresolved.length === 1 ? "1 personalisation token could not be filled" : `${unresolved.length} personalisation tokens could not be filled`}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {unresolved.map((t) => (
                  <code key={t} className="rounded-sm bg-sg-bg/70 px-1.5 py-0.5 font-mono text-2xs text-sg-white ring-1 ring-inset ring-soft-yellow/40">{`{{${t}}}`}</code>
                ))}
              </div>
              <p className="mt-1.5 text-sg-muted">
                {unresolved.some((t) => !(TEMPLATE_TOKENS as readonly string[]).includes(t)) ? "Some tokens are not supported. " : ""}
                {`This ${label ? `record (${label})` : "record"} has no value for ${unresolved.length === 1 ? "it" : "them"} — edit the text above${confirmUnresolved ? ", or press log again to save as is." : " before saving."}`}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── Record picker (CRM side) ───────────────────────── */

export function RecordPicker({ onPick, types, exclude = [] }: { onPick: (type: CrmObjectType, id: string) => void; types: CrmObjectType[]; exclude?: string[] }) {
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const all: { type: CrmObjectType; id: string; label: string; sub: string }[] = [];
    if (types.includes("deal")) deals.forEach((d) => all.push({ type: "deal", id: d.id, label: d.name, sub: formatIDR(d.amount) }));
    if (types.includes("ticket")) tickets.forEach((t) => all.push({ type: "ticket", id: t.id, label: t.subject, sub: t.id.toUpperCase() }));
    if (types.includes("company")) companies.forEach((c) => all.push({ type: "company", id: c.id, label: c.name, sub: c.domain }));
    if (types.includes("contact")) contacts.forEach((c) => all.push({ type: "contact", id: c.id, label: `${c.firstName} ${c.lastName}`, sub: c.email }));
    const needle = q.trim().toLowerCase();
    return all.filter((o) => !exclude.includes(o.id) && (!needle || `${o.label} ${o.sub}`.toLowerCase().includes(needle))).slice(0, 40);
  }, [q, types, contacts, companies, deals, tickets, exclude]);
  const icon = { contact: User, company: Building2, deal: Handshake, ticket: Ticket } as const;
  return (
    <div className="rounded-lg border border-sg-line">
      <div className="flex items-center gap-2 border-b border-sg-line px-2.5">
        <Search className="size-3.5 text-sg-dim" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${types.map((t) => ({ contact: "contacts", company: "companies", deal: "deals", ticket: "tickets" })[t]).join(", ")}…`} className="h-9 flex-1 bg-transparent text-sm text-sg-white placeholder:text-sg-dim focus:outline-none" />
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {options.map((o) => {
          const Icon = icon[o.type];
          return (
            <button key={`${o.type}:${o.id}`} type="button" onClick={() => onPick(o.type, o.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-sg-text hover:bg-sg-card-3 hover:text-sg-white">
              <Icon className="size-3.5 shrink-0 text-sg-dim" />
              <span className="truncate">{o.label}</span>
              <span className="ml-auto shrink-0 truncate text-2xs text-sg-dim">{o.sub}</span>
            </button>
          );
        })}
        {!options.length && <p className="px-2 py-4 text-center text-xs text-sg-dim">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}

/* ───────────────────────── Link issue ⇄ CRM record ───────────────────────── */

function LinkIssueDialog({ onClose, d }: Props<"linkIssue">) {
  const issues = useCrm((s) => s.issues);
  const epics = useCrm((s) => s.epics);
  const crossLinks = useCrm((s) => s.crossLinks);
  const link = useCrm((s) => s.link);
  const notify = useUi((s) => s.notify);
  const openDialog = useUi((s) => s.openDialog);
  const label = useLinkedRecordLabel(d.crmType, d.crmId);
  const [q, setQ] = useState("");
  // "blocks" marks the deal "Blocked by engineering" on the board — make it a deliberate choice, never the default
  const [linkType, setLinkType] = useState<LinkType>(d.crmType === "ticket" ? "escalated_from" : "relates_to");
  const already = new Set(crossLinks.filter((x) => x.crmType === d.crmType && x.crmId === d.crmId).map((x) => x.agileId));
  const needle = q.trim().toLowerCase();
  const options = [
    ...epics.map((e) => ({ kind: "epic" as const, id: e.id, key: e.key, summary: e.name })),
    ...issues.map((i) => ({ kind: "issue" as const, id: i.id, key: i.key, summary: i.summary })),
  ].filter((o) => !already.has(o.id) && (!needle || `${o.key} ${o.summary}`.toLowerCase().includes(needle)));

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Link Jira work" description={`Connect an issue or epic to ${label}`}>
      <div className="space-y-3">
        <Field label="Relationship" hint={linkType === "blocks" && d.crmType === "deal" ? `“Blocks” flags this deal as blocked by engineering on the board and in the KPI until the issue is done.` : `Reads as: <issue> ${linkTypeMeta[linkType].label} ${label}`}>
          <Select value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)}>
            {LINK_TYPES.map((l) => (
              <option key={l} value={l}>
                {linkTypeMeta[l].label} — shown here as “{linkTypeMeta[l].crmSide}”
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-lg border border-sg-line">
          <div className="flex items-center gap-2 border-b border-sg-line px-2.5">
            <Search className="size-3.5 text-sg-dim" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by key or summary (e.g. UAV-102)" className="h-9 flex-1 bg-transparent text-sm text-sg-white placeholder:text-sg-dim focus:outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {options.slice(0, 50).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  link({ agileType: o.kind, agileId: o.id, crmType: d.crmType, crmId: d.crmId, linkType });
                  notify(`${o.key} linked`);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-sg-text hover:bg-sg-card-3 hover:text-sg-white"
              >
                <Kanban className="size-3.5 shrink-0 text-soft-cyan" />
                <span className="shrink-0 font-semibold text-sg-muted">{o.key}</span>
                <span className="truncate">{o.summary}</span>
                {o.kind === "epic" && <span className="ml-auto text-2xs uppercase tracking-wider text-soft-magenta">Epic</span>}
              </button>
            ))}
            {!options.length && <p className="px-2 py-4 text-center text-xs text-sg-dim">No unlinked issues match.</p>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "createIssue", link: { crmType: d.crmType, crmId: d.crmId, linkType } })}>
          + Create a new issue instead
        </Button>
      </div>
    </Modal>
  );
}

function LinkRecordDialog({ onClose, d }: Props<"linkRecord">) {
  const crossLinks = useCrm((s) => s.crossLinks);
  const link = useCrm((s) => s.link);
  const notify = useUi((s) => s.notify);
  const [linkType, setLinkType] = useState<LinkType>("relates_to");
  const existing = crossLinks.filter((x) => x.agileId === d.agileId).map((x) => x.crmId);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Link CRM record" description="Associate this work with a deal, ticket, company or contact.">
      <div className="space-y-3">
        <Field label="Relationship">
          <Select value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)}>
            {LINK_TYPES.map((l) => (
              <option key={l} value={l}>
                This {d.agileType} {linkTypeMeta[l].label}…
              </option>
            ))}
          </Select>
        </Field>
        <RecordPicker
          types={["deal", "ticket", "company", "contact"]}
          exclude={existing}
          onPick={(crmType, crmId) => {
            link({ agileType: d.agileType, agileId: d.agileId, crmType, crmId, linkType });
            notify("Record linked");
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}

/* ───────────────────────── Generate quote ───────────────────────── */

function GenerateQuoteDialog({ onClose, d }: Props<"generateQuote">) {
  const router = useRouter();
  const deals = useCrm((s) => s.deals);
  const lineItems = useCrm((s) => s.lineItems);
  const products = useCrm((s) => s.products);
  const companies = useCrm((s) => s.companies);
  const quoteSettings = useCrm((s) => s.quoteSettings);
  const createQuoteFromDeal = useCrm((s) => s.createQuoteFromDeal);
  const notify = useUi((s) => s.notify);
  const [dealId, setDealId] = useState(d.dealId ?? "");
  const deal = deals.find((x) => x.id === dealId);
  const items = useMemo(() => lineItems.filter((l) => l.dealId === dealId), [lineItems, dealId]);
  const settings = settingsOf(quoteSettings);
  const company = companies.find((c) => c.id === deal?.companyId);
  const t = quoteTotals(items, { settings, products, company });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Generate quote"
      description={settings.supplierPkp ? "Draft quote from the deal's line items · PPN 12% on DPP 11/12 (PMK 131/2024)" : "Draft quote from the deal's line items · supplier not PKP, no PPN"}
      footer={
        deal ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!items.length}
              onClick={() => {
                const id = createQuoteFromDeal(deal.id);
                onClose();
                if (!id) return;
                notify("Draft quote created — set the termin and submit it for the Finance check");
                router.push(`/quotes/${id}`);
              }}
            >
              <FileText /> Create draft quote
            </Button>
          </>
        ) : undefined
      }
    >
      {!deal ? (
        <RecordPicker types={["deal"]} onPick={(_t, id) => setDealId(id)} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sg-white">{deal.name}</div>
            {!d.dealId && (
              <button type="button" className="text-xs text-sg-dim hover:text-sg-white" onClick={() => setDealId("")}>
                change deal
              </button>
            )}
          </div>
          {items.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wider text-sg-dim">
                  <th className="pb-1 font-semibold">Product</th>
                  <th className="pb-1 text-right font-semibold">Qty</th>
                  <th className="pb-1 text-right font-semibold">Disc.</th>
                  <th className="pb-1 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => {
                  const p = products.find((x) => x.id === l.productId);
                  return (
                    <tr key={l.id} className="border-t border-sg-line">
                      <td className="py-1.5 pr-2">
                        <div className="text-sg-text">{p?.name}</div>
                        <div className="text-2xs text-sg-dim">
                          {p?.sku} · {formatIDR(l.unitPrice, "full")} ea
                        </div>
                      </td>
                      <td className="sg-num py-1.5 text-right">{l.quantity}</td>
                      <td className="sg-num py-1.5 text-right">{l.discountPct}%</td>
                      <td className="sg-num py-1.5 text-right text-sg-white">{formatIDR(l.quantity * l.unitPrice * (1 - l.discountPct / 100), "full")}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-sg-line-2 text-xs">
                  <td colSpan={3} className="py-1 text-right text-sg-muted">Harga jual (subtotal)</td>
                  <td className="sg-num py-1 text-right text-sg-text">{formatIDR(t.subtotal, "full")}</td>
                </tr>
                {t.pkp && (
                  <>
                    <tr className="text-xs">
                      <td colSpan={3} className="py-0.5 text-right text-sg-dim">DPP nilai lain (11/12)</td>
                      <td className="sg-num py-0.5 text-right text-sg-muted">{formatIDR(t.dpp, "full")}</td>
                    </tr>
                    <tr className="text-xs">
                      <td colSpan={3} className="py-0.5 text-right text-sg-dim">PPN {t.vatRate}% × DPP · faktur code {t.fakturCode}</td>
                      <td className="sg-num py-0.5 text-right text-sg-muted">{formatIDR(t.vat, "full")}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t border-sg-line-2">
                  <td colSpan={3} className="py-1.5 text-right font-semibold text-sg-white">Total</td>
                  <td className="sg-num py-1.5 text-right font-bold text-sg-white">{formatIDR(t.total, "full")}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="rounded border border-dashed border-sg-line-2 p-4 text-center text-sm text-sg-muted">This deal has no line items yet — add products on the deal record first.</p>
          )}
          {items.length > 0 && <p className="text-2xs text-sg-dim">Quotations are checked by Finance before they are sent (§4.7). Expected cash after client withholding: {formatIDR(t.expectedCash, "full")}.</p>}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── Shortcuts ───────────────────────── */

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const SHORTCUTS = shortcutsFor(pathname);
  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Keyboard shortcuts" description="Everything is reachable without the mouse.">
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <div className="sg-eyebrow mb-2">{g}</div>
            <ul className="space-y-1.5">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 text-sm text-sg-text">
                  <span>{s.label}</span>
                  <span className="flex shrink-0 gap-1">
                    {s.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
