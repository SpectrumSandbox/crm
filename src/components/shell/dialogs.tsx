"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, FileText, Handshake, Kanban, Mail, Phone, Search, StickyNote, SquareCheck, Ticket, User } from "lucide-react";
import { useCrm, useUi, type DialogState } from "@/lib/store";
import { CAPABILITIES, ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, LIFECYCLE_STAGES, LINK_TYPES, type Capability, type CompanyTier, type CrmObjectType, type IssuePriority, type IssueStatus, type IssueType, type LifecycleStage, type LinkType } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, lifecycleMeta, linkTypeMeta, priorityMeta } from "@/lib/meta";
import { cn, formatIDR, fromDateInput, toDateInput } from "@/lib/utils";
import { Modal, Tabs } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/misc";
import { SHORTCUTS } from "./hotkeys";

export function GlobalDialogs() {
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
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [closeDate, setCloseDate] = useState(toDateInput(new Date(Date.now() + 45 * 86_400_000).toISOString()));
  const [ownerId, setOwnerId] = useState(company?.ownerId ?? currentUserId);
  const [capability, setCapability] = useState<Capability>(CAPABILITIES[0]);
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");

  useEffect(() => {
    if (pipeline && !pipeline.stages.some((s) => s.id === stageId)) setStageId(pipeline.stages[0].id);
  }, [pipeline, stageId]);

  const valid = name.trim().length > 1 && Number(amount.replace(/[^\d]/g, "")) >= 0 && !!stageId;
  const submit = () => {
    if (!valid) return;
    const prefix = company ? `${company.name.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase()} — ` : "";
    const id = createDeal({
      name: name.includes(" — ") ? name.trim() : prefix + name.trim(),
      amount: Number(amount.replace(/[^\d]/g, "")) || 0,
      pipelineId: pipeline!.id,
      stageId,
      closeDate: fromDateInput(closeDate),
      ownerId,
      companyId: companyId || null,
      contactIds: contactId ? [contactId] : [],
      priority,
      dealType: "New Business",
      capability,
      description: "",
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
          <SubmitHint />
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
        <Field label="Deal name" className="col-span-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drone inspection programme — phase 1" />
        </Field>
        <Field label="Amount (IDR)">
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500000000" />
          {amount ? <p className="mt-1 text-2xs text-sg-dim">{formatIDR(Number(amount.replace(/[^\d]/g, "")) || 0, "full")}</p> : null}
        </Field>
        <Field label="Close date">
          <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
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
            {pipeline?.stages.map((s) => (
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
        <Field label="Priority" className="col-span-2">
          <div className="flex gap-1">
            {(["high", "medium", "low"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)} className={cn("h-7 rounded border px-3 text-xs font-semibold capitalize", priority === p ? "border-sg-white text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}>
                {p}
              </button>
            ))}
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

  const valid = firstName.trim().length > 0 && /\S+@\S+\.\S+/.test(email);
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
        <Field label="Email" className="col-span-2" hint="Company is matched automatically from the email domain.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.co.id" />
        </Field>
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

/* ───────────────────────── Log activity ───────────────────────── */

const activityTabs = [
  { value: "call" as const, label: "Call", icon: Phone },
  { value: "email" as const, label: "Email", icon: Mail },
  { value: "meeting" as const, label: "Meeting", icon: CalendarDays },
  { value: "note" as const, label: "Note", icon: StickyNote },
  { value: "task" as const, label: "Task", icon: SquareCheck },
];

function LogActivityDialog({ onClose, d }: Props<"logActivity">) {
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const addActivity = useCrm((s) => s.addActivity);
  const notify = useUi((s) => s.notify);

  const [type, setType] = useState(d.activityType);
  const [target, setTarget] = useState<{ type: CrmObjectType; id: string } | undefined>(d.target);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<"connected" | "left_voicemail" | "no_answer" | "busy" | "wrong_number">("connected");
  const [duration, setDuration] = useState("15");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [due, setDue] = useState(toDateInput(new Date(Date.now() + 2 * 86_400_000).toISOString()));

  /** resolve associations the way HubSpot does: contact → its company + its open deals */
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
      l.contactIds.push(...(deal?.contactIds ?? []).slice(0, 1));
    }
    if (target.type === "ticket") {
      l.ticketIds.push(target.id);
      const t = tickets.find((x) => x.id === target.id);
      if (t?.companyId) l.companyIds.push(t.companyId);
      if (t?.contactId) l.contactIds.push(t.contactId);
    }
    return l;
  }, [target, contacts, deals, tickets]);

  const label = useLinkedRecordLabel(target?.type, target?.id);
  const valid = !!target && (subject.trim().length > 0 || body.trim().length > 0);
  const submit = () => {
    if (!valid) return;
    const defaultSubject = { call: `Call with ${label}`, email: `Email: ${label}`, meeting: `Meeting: ${label}`, note: "Note", task: "Follow up" }[type];
    addActivity({
      type,
      subject: subject.trim() || defaultSubject,
      body,
      links,
      ...(type === "call" ? { callOutcome: outcome, durationMin: Number(duration) || 0, direction } : {}),
      ...(type === "email" ? { direction } : {}),
      ...(type === "meeting" ? { durationMin: Number(duration) || 0 } : {}),
      ...(type === "task" ? { dueAt: fromDateInput(due), done: false } : {}),
    });
    notify(`${type[0].toUpperCase() + type.slice(1)} logged`);
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
          <SubmitHint />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            {type === "task" ? "Create task" : `Log ${type}`}
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
              <button type="button" className="text-sg-dim hover:text-sg-white" onClick={() => setTarget(undefined)}>
                change
              </button>
            )}
          </div>
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
            <Field label="Due date">
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          )}
          <Field label={type === "note" ? "Note" : "Notes"}>
            <Textarea autoFocus={type === "note"} value={body} onChange={(e) => setBody(e.target.value)} placeholder={type === "call" ? "What was discussed? Next steps?" : ""} />
          </Field>
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
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${types.join(", ")}s…`} className="h-9 flex-1 bg-transparent text-sm text-sg-white placeholder:text-sg-dim focus:outline-none" />
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
  const [linkType, setLinkType] = useState<LinkType>(d.crmType === "ticket" ? "escalated_from" : d.crmType === "deal" ? "blocks" : "relates_to");
  const already = new Set(crossLinks.filter((x) => x.crmType === d.crmType && x.crmId === d.crmId).map((x) => x.agileId));
  const needle = q.trim().toLowerCase();
  const options = [
    ...epics.map((e) => ({ kind: "epic" as const, id: e.id, key: e.key, summary: e.name })),
    ...issues.map((i) => ({ kind: "issue" as const, id: i.id, key: i.key, summary: i.summary })),
  ].filter((o) => !already.has(o.id) && (!needle || `${o.key} ${o.summary}`.toLowerCase().includes(needle)));

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Link Jira work" description={`Connect an issue or epic to ${label}`}>
      <div className="space-y-3">
        <Field label="Relationship" hint={`Reads as: <issue> ${linkTypeMeta[linkType].label} ${label}`}>
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
  const generateQuote = useCrm((s) => s.generateQuote);
  const notify = useUi((s) => s.notify);
  const [dealId, setDealId] = useState(d.dealId ?? "");
  const deal = deals.find((x) => x.id === dealId);
  const items = lineItems.filter((l) => l.dealId === dealId);
  const subtotal = items.reduce((sum, l) => sum + l.quantity * l.unitPrice * (1 - l.discountPct / 100), 0);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Generate quote"
      description="Creates a draft quote from the deal's line items (11% VAT)."
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
                generateQuote(deal.id);
                notify("Draft quote created");
                onClose();
                router.push(`/deals/${deal.id}`);
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
                        <div className="text-2xs text-sg-dim">{p?.sku}</div>
                      </td>
                      <td className="sg-num py-1.5 text-right">{l.quantity}</td>
                      <td className="sg-num py-1.5 text-right">{l.discountPct}%</td>
                      <td className="sg-num py-1.5 text-right text-sg-white">{formatIDR(l.quantity * l.unitPrice * (1 - l.discountPct / 100))}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-sg-line-2">
                  <td colSpan={3} className="py-1.5 text-right text-sg-muted">
                    Subtotal · VAT 11% · <span className="font-semibold text-sg-white">Total</span>
                  </td>
                  <td className="sg-num py-1.5 text-right font-bold text-sg-white">{formatIDR(subtotal * 1.11)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="rounded border border-dashed border-sg-line-2 p-4 text-center text-sm text-sg-muted">This deal has no line items yet — add products on the deal record first.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── Shortcuts ───────────────────────── */

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
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
