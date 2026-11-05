"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, FileText, Mail, MessageSquare, Plus, Search, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { EmailTemplate } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Chip, EmptyState, Kbd } from "@/components/ui/misc";
import { Combobox } from "@/components/ui/combobox";
import { confirm } from "@/components/ui/confirm";
import { AutomationNav } from "@/components/automation/nav";
import { STARTER_TEMPLATES } from "@/components/automation/catalog";
import { renderTemplate, templateChannelOf, templateLanguageOf, tokenContext, TOKENS, unknownTokens, unresolvedTokens, waLink, WA_HARD_LIMIT, WA_SOFT_LIMIT } from "@/components/automation/tokens";

const CATEGORIES: EmailTemplate["category"][] = ["Prospecting", "Follow-up", "Meeting", "Onboarding", "Support"];

export default function TemplatesPage() {
  const templates = useCrm((s) => s.emailTemplates);
  const sequences = useCrm((s) => s.sequences);
  const workflows = useCrm((s) => s.workflows);
  const createTemplate = useCrm((s) => s.createTemplate);
  const notify = useUi((s) => s.notify);
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<"" | "email" | "whatsapp">("");
  const [category, setCategory] = useState<"" | EmailTemplate["category"]>("");
  const [language, setLanguage] = useState<"" | "id" | "en">("");
  const [view, setView] = useState<"mine" | "library">("mine");
  const selected = params.get("t");
  const select = (id: string | null) => router.replace(id ? `/automation/templates?t=${id}` : "/automation/templates");

  const usage = useMemo(() => {
    const m = new Map<string, string[]>();
    sequences.forEach((s) => s.steps.forEach((st) => st.templateId && m.set(st.templateId, [...(m.get(st.templateId) ?? []), `Sequence: ${s.name}`])));
    workflows.forEach((w) => w.actions.forEach((a) => a.kind === "email_contact" && a.config.template && m.set(a.config.template, [...(m.get(a.config.template) ?? []), `Workflow: ${w.name}`])));
    return m;
  }, [sequences, workflows]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return templates.filter(
      (t) =>
        (!channel || templateChannelOf(t) === channel) &&
        (!category || t.category === category) &&
        (!language || templateLanguageOf(t) === language) &&
        (!needle || `${t.name} ${t.subject} ${t.body}`.toLowerCase().includes(needle)),
    );
  }, [templates, q, channel, category, language]);

  const current = templates.find((t) => t.id === selected) ?? null;
  const newTemplate = (ch: "email" | "whatsapp") => {
    const id = createTemplate({ name: ch === "whatsapp" ? "New WhatsApp message" : "New email", subject: ch === "whatsapp" ? "WhatsApp" : "", body: ch === "whatsapp" ? "Halo {{contact.first_name}}, " : "Hi {{contact.first_name}},\n\n\n\n{{owner.first_name}}", category: "Follow-up", templateChannel: ch, templateLanguage: ch === "whatsapp" ? "id" : "en" });
    setView("mine");
    select(id);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Templates" crumbs={[{ href: "/automation", label: "Automation" }]}>
        <Button variant="outline" size="md" onClick={() => newTemplate("whatsapp")}>
          <MessageSquare /> New WhatsApp
        </Button>
        <Button variant="primary" size="md" onClick={() => newTemplate("email")}>
          <Plus /> New email
        </Button>
      </PageHeader>
      <AutomationNav />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-sg-line lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-sg-line p-2" role="group" aria-label="Template source">
            {(["mine", "library"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("h-7 flex-1 rounded text-xs font-semibold", view === v ? "bg-sg-card-3 text-sg-white" : "text-sg-muted hover:text-sg-white")}>
                {v === "mine" ? `Workspace · ${templates.length}` : "Starter library"}
              </button>
            ))}
          </div>
          {view === "mine" ? (
            <>
              <div className="space-y-2 border-b border-sg-line p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" aria-hidden />
                  <Input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="pl-7" aria-label="Search templates" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Select value={channel} onChange={(e) => setChannel(e.target.value as "" | "email" | "whatsapp")} aria-label="Channel">
                    <option value="">Any channel</option>
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                  </Select>
                  <Select value={category} onChange={(e) => setCategory(e.target.value as "" | EmailTemplate["category"])} aria-label="Category">
                    <option value="">Any type</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                  <Select value={language} onChange={(e) => setLanguage(e.target.value as "" | "id" | "en")} aria-label="Language">
                    <option value="">Any lang.</option>
                    <option value="id">Bahasa</option>
                    <option value="en">English</option>
                  </Select>
                </div>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {rows.map((t) => {
                  const wa = templateChannelOf(t) === "whatsapp";
                  const used = usage.get(t.id)?.length ?? 0;
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => select(t.id)} aria-current={t.id === selected ? "true" : undefined} className={cn("flex w-full items-start gap-2 border-b border-sg-line px-3 py-2.5 text-left", t.id === selected ? "bg-sg-card-2" : "hover:bg-sg-card")}>
                        {wa ? <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-soft-green" aria-label="WhatsApp" /> : <Mail className="mt-0.5 size-3.5 shrink-0 text-soft-blue" aria-label="Email" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-sg-white">{t.name}</span>
                          <span className="block truncate text-2xs text-sg-dim">{wa ? t.body : t.subject}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          <Chip color="blue">{t.category}</Chip>
                          <span className="text-[10px] uppercase text-sg-dim">
                            {templateLanguageOf(t)}
                            {used ? ` · ${used} use${used === 1 ? "" : "s"}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!rows.length ? <li className="px-3 py-8 text-center text-xs text-sg-dim">No templates match</li> : null}
              </ul>
            </>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {STARTER_TEMPLATES.map((st) => {
                const have = templates.find((t) => t.id === st.id);
                return (
                  <li key={st.id} className="border-b border-sg-line px-3 py-3">
                    <div className="flex items-start gap-2">
                      {st.templateChannel === "whatsapp" ? <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-soft-green" aria-hidden /> : <Mail className="mt-0.5 size-3.5 shrink-0 text-soft-blue" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-sg-white">{st.name}</div>
                        <div className="text-2xs text-sg-dim">{st.note}</div>
                        <p className="mt-1 line-clamp-3 whitespace-pre-line text-2xs text-sg-muted">{st.body}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      {have ? (
                        <button type="button" className="flex items-center gap-1 text-2xs font-semibold text-soft-green hover:underline" onClick={() => { setView("mine"); select(st.id); }}>
                          <Check className="size-3" aria-hidden /> In workspace — open
                        </button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            const { note: _n, ...tpl } = st;
                            const id = createTemplate(tpl);
                            notify(`Added “${st.name}”`);
                            setView("mine");
                            select(id);
                          }}
                        >
                          <Sparkles /> Add to workspace
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
        <div className="min-h-0 overflow-y-auto">
          {current ? (
            <TemplateEditor key={current.id} template={current} usedBy={usage.get(current.id) ?? []} onDeleted={() => select(null)} onDuplicated={select} />
          ) : (
            <EmptyState icon={FileText} title="Pick a template">
              Templates personalise with tokens like {"{{contact.first_name}}"} and are shared by the log-email dialog, sequences and workflows. WhatsApp templates open wa.me with the message pre-filled.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateEditor({ template, usedBy, onDeleted, onDuplicated }: { template: EmailTemplate; usedBy: string[]; onDeleted: () => void; onDuplicated: (id: string) => void }) {
  const state = useCrm((s) => s);
  const updateTemplate = useCrm((s) => s.updateTemplate);
  const createTemplate = useCrm((s) => s.createTemplate);
  const deleteTemplate = useCrm((s) => s.deleteTemplate);
  const restoreTemplate = useCrm((s) => s.restoreTemplate);
  const notify = useUi((s) => s.notify);
  const [draft, setDraft] = useState<EmailTemplate>(template);
  const [contactId, setContactId] = useState<string>(state.contacts[0]?.id ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [focus, setFocus] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(template), [template]);
  const wa = templateChannelOf(draft) === "whatsapp";
  const dirty = JSON.stringify({ ...draft, templateUpdatedAt: null }) !== JSON.stringify({ ...template, templateUpdatedAt: null });
  const ctx = useMemo(() => tokenContext(state, contactId ? { type: "contact", id: contactId } : null, contactId || null), [state, contactId]);
  const unknown = unknownTokens([draft.subject, draft.body]);
  const unresolved = unresolvedTokens([draft.subject, draft.body], ctx).filter((t) => !unknown.includes(t));
  const preview = { subject: renderTemplate(draft.subject, ctx), body: renderTemplate(draft.body, ctx) };
  const contact = state.contacts.find((c) => c.id === contactId);
  const link = wa ? waLink(contact?.phone, preview.body) : null;
  const owner = state.users.find((u) => u.id === template.ownerId);

  const save = () => {
    if (!draft.name.trim() || !draft.body.trim()) return;
    if (wa && draft.body.length > WA_HARD_LIMIT) return;
    updateTemplate(template.id, { ...draft, name: draft.name.trim() });
    notify(`Saved “${draft.name.trim()}”`);
  };

  const insert = (token: string) => {
    const text = `{{${token}}}`;
    if (focus === "subject" && !wa) {
      const el = subjectRef.current;
      const at = el?.selectionStart ?? draft.subject.length;
      setDraft((d) => ({ ...d, subject: d.subject.slice(0, at) + text + d.subject.slice(at) }));
      return;
    }
    const el = bodyRef.current;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft((d) => ({ ...d, body: d.body.slice(0, at) + text + d.body.slice(at) }));
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  return (
    <div
      className="grid gap-4 p-4 sm:p-5 2xl:grid-cols-2"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
    >
      <section className="space-y-3 rounded-xl border border-sg-line bg-sg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field label="Channel">
            <Select value={templateChannelOf(draft)} onChange={(e) => setDraft((d) => ({ ...d, templateChannel: e.target.value as "email" | "whatsapp" }))}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </Select>
          </Field>
          <Field label="Language">
            <Select value={templateLanguageOf(draft)} onChange={(e) => setDraft((d) => ({ ...d, templateLanguage: e.target.value as "id" | "en" }))}>
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Type">
            <Select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as EmailTemplate["category"] }))}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner">
            <Input value={owner?.name ?? "—"} readOnly disabled />
          </Field>
        </div>
        {!wa ? (
          <Field label="Subject">
            <Input ref={subjectRef} value={draft.subject} onFocus={() => setFocus("subject")} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </Field>
        ) : null}
        <Field label={wa ? "Message" : "Body"} hint={wa ? `${draft.body.length} / ${WA_HARD_LIMIT} characters${draft.body.length > WA_SOFT_LIMIT ? " — long for a chat; consider shortening" : ""}` : undefined} error={wa && draft.body.length > WA_HARD_LIMIT ? "WhatsApp messages are limited to 4,096 characters" : undefined}>
          <Textarea ref={bodyRef} value={draft.body} onFocus={() => setFocus("body")} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} className="min-h-[220px] font-mono text-xs" />
        </Field>
        <div>
          <div className="sg-eyebrow mb-1">Insert token {focus === "subject" && !wa ? "into subject" : "at the cursor"}</div>
          <div className="flex flex-wrap gap-1">
            {TOKENS.map((t) => (
              <button key={t.token} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t.token)} className="h-6 rounded-sm border border-sg-line px-1.5 text-2xs text-sg-muted hover:border-sg-line-2 hover:text-sg-white" title={`{{${t.token}}}`}>
                {t.group} · {t.label}
              </button>
            ))}
          </div>
        </div>
        {unknown.length ? (
          <p className="flex items-center gap-1.5 text-2xs text-soft-red">
            <TriangleAlert className="size-3" aria-hidden /> Unknown token{unknown.length === 1 ? "" : "s"}: {unknown.map((t) => `{{${t}}}`).join(", ")} — they’ll be sent as typed.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-sg-line pt-3">
          <Button variant="primary" size="sm" disabled={!dirty || !draft.name.trim() || !draft.body.trim() || (wa && draft.body.length > WA_HARD_LIMIT)} onClick={save}>
            Save <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">⌘↵</Kbd>
          </Button>
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={() => setDraft(template)}>
              Revert
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const { id: _id, ownerId: _o, ...rest } = draft;
              const id = createTemplate({ ...rest, name: `${draft.name} (copy)` });
              onDuplicated(id);
              notify("Template duplicated");
            }}
          >
            <Copy /> Duplicate
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            onClick={async () => {
              if (usedBy.length && !(await confirm({ title: `Delete “${template.name}”?`, body: `It is used by ${usedBy.join(", ")}. Those steps and actions will fail until you pick another template.`, confirmLabel: "Delete anyway", tone: "danger" }))) return;
              const snap = deleteTemplate(template.id);
              onDeleted();
              if (snap) notify(`Deleted “${template.name}”`, { label: "Undo", run: () => restoreTemplate(snap) });
            }}
          >
            <Trash2 /> Delete
          </Button>
        </div>
        <p className="text-[10px] text-sg-dim">
          {usedBy.length ? `Used by ${usedBy.join(" · ")}` : "Not used by any sequence or workflow"}
          {template.templateUpdatedAt ? ` · edited ${relativeTime(template.templateUpdatedAt)}` : ""}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-sg-line bg-sg-card p-4">
        <div className="flex items-end gap-2">
          <Field label="Preview as" className="flex-1">
            <Combobox value={contactId} onChange={(v) => setContactId(v ?? "")} options={state.contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`, detail: state.companies.find((x) => x.id === c.companyId)?.name }))} placeholder="Pick a contact" />
          </Field>
        </div>
        {wa ? (
          <div className="rounded-xl bg-[#0b141a] p-3">
            <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#005c4b] px-3 py-2 text-sm leading-relaxed text-white">{preview.body}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-sg-line bg-sg-bg/60">
            <div className="border-b border-sg-line px-3 py-2 text-xs">
              <span className="text-sg-dim">To:</span> <span className="text-sg-text">{contact?.email || "—"}</span>
              <div className="mt-0.5 font-semibold text-sg-white">{preview.subject || <span className="text-sg-dim">(no subject)</span>}</div>
            </div>
            <div className="whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-sg-text">{preview.body}</div>
          </div>
        )}
        {unresolved.length ? (
          <p className="flex items-center gap-1.5 text-2xs text-soft-orange">
            <TriangleAlert className="size-3" aria-hidden /> Empty for this contact: {unresolved.map((t) => `{{${t}}}`).join(", ")}
          </p>
        ) : null}
        {wa ? (
          link ? (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-soft-green hover:underline">
              <MessageSquare className="size-3.5" aria-hidden /> Test in WhatsApp ({contact?.phone})
            </a>
          ) : (
            <p className="text-2xs text-sg-dim">{contact?.firstName ?? "This contact"} has no number usable for WhatsApp.</p>
          )
        ) : null}
      </section>
    </div>
  );
}
