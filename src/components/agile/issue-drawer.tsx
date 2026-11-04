"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, Copy, Handshake, Link2, ListTree, MessageSquare, Plus, Ticket, Unlink, User, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useLinksForAgile, useUserMap } from "@/lib/selectors";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, type Issue } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, linkTypeMeta, priorityMeta } from "@/lib/meta";
import { cn, formatDate, formatIDR, fromDateInput, relativeTime, softChip, softText, spectrumDot, toDateInput } from "@/lib/utils";
import { Sheet, SheetClose, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";
import { Avatar, Chip, Kbd } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function IssueDrawer() {
  const issueId = useUi((s) => s.issueId);
  const openIssue = useUi((s) => s.openIssue);
  const issue = useCrm((s) => (issueId ? s.issues.find((i) => i.id === issueId) : undefined));
  return (
    <Sheet open={!!issue} onOpenChange={(o) => !o && openIssue(null)} title={issue ? `${issue.key} ${issue.summary}` : "Issue"}>
      {issue ? <IssueDetail key={issue.id} issue={issue} /> : null}
    </Sheet>
  );
}

function IssueDetail({ issue }: { issue: Issue }) {
  const updateIssue = useCrm((s) => s.updateIssue);
  const createIssue = useCrm((s) => s.createIssue);
  const addComment = useCrm((s) => s.addComment);
  const unlink = useCrm((s) => s.unlink);
  const allIssues = useCrm((s) => s.issues);
  const projects = useCrm((s) => s.projects);
  const epics = useCrm((s) => s.epics);
  const sprints = useCrm((s) => s.sprints);
  const users = useCrm((s) => s.users);
  const comments = useCrm((s) => s.issueComments);
  const deals = useCrm((s) => s.deals);
  const pipelines = useCrm((s) => s.pipelines);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const links = useLinksForAgile("issue", issue.id);
  const project = projects.find((p) => p.id === issue.projectId);
  const epic = epics.find((e) => e.id === issue.epicId);
  const parent = allIssues.find((i) => i.id === issue.parentId);
  const subtasks = allIssues.filter((i) => i.parentId === issue.id);
  const issueComments = comments.filter((c) => c.issueId === issue.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const TypeIcon = issueTypeMeta[issue.type].icon;

  const [summary, setSummary] = useState(issue.summary);
  const [description, setDescription] = useState(issue.description);
  const [editingDesc, setEditingDesc] = useState(false);
  const [comment, setComment] = useState("");
  const [newSub, setNewSub] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  useEffect(() => setSummary(issue.summary), [issue.summary]);
  useEffect(() => setDescription(issue.description), [issue.description]);

  // status hotkeys inside the drawer: 1–5
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || e.metaKey || e.ctrlKey) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < ISSUE_STATUSES.length) {
        e.preventDefault();
        updateIssue(issue.id, { status: ISSUE_STATUSES[idx] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issue.id, updateIssue]);

  const stageOf = useMemo(() => new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s] as const))), [pipelines]);

  const copyLink = () => {
    const url = `${window.location.origin}/board?issue=${issue.key}`;
    void navigator.clipboard?.writeText(url);
    notify(`Link to ${issue.key} copied`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="sg-spectrum-rule h-[2px] shrink-0" />
      <div className="flex shrink-0 items-center gap-2 border-b border-sg-line px-5 py-2.5 text-sm">
        <span className="text-sg-dim">{project?.name}</span>
        {parent && (
          <>
            <span className="text-sg-dim">/</span>
            <button type="button" onClick={() => openIssue(parent.id)} className="font-semibold text-sg-muted hover:text-sg-white">
              {parent.key}
            </button>
          </>
        )}
        <span className="text-sg-dim">/</span>
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={cn("flex items-center gap-1.5 rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset", softChip[issueTypeMeta[issue.type].color])}>
              <TypeIcon className="size-3.5" /> {issue.key}
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Change issue type</MenuLabel>
            {ISSUE_TYPES.map((t) => {
              const I = issueTypeMeta[t].icon;
              return (
                <MenuItem key={t} active={t === issue.type} onSelect={() => updateIssue(issue.id, { type: t })}>
                  <I className={cn("size-3.5", softText[issueTypeMeta[t].color])} /> {issueTypeMeta[t].label}
                </MenuItem>
              );
            })}
          </MenuContent>
        </Menu>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={copyLink} aria-label="Copy link" title="Copy link">
            <Copy />
          </Button>
          <SheetClose asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Close (Esc)" title="Close (Esc)">
              <X />
            </Button>
          </SheetClose>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_240px] md:overflow-hidden">
        {/* main column */}
        <div className="space-y-6 px-5 py-5 md:overflow-y-auto">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => summary.trim() && summary !== issue.summary && updateIssue(issue.id, { summary: summary.trim() })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            rows={2}
            className="w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 font-display text-xl font-extrabold leading-snug text-sg-white hover:border-sg-line focus:border-sg-white/50 focus:outline-none"
          />

          {/* status bar */}
          <div className="flex flex-wrap items-center gap-1.5">
            {ISSUE_STATUSES.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => updateIssue(issue.id, { status: s })}
                title={`Press ${i + 1}`}
                className={cn(
                  "flex h-7 items-center rounded border px-2.5 text-xs font-semibold transition-colors",
                  issue.status === s ? cn("ring-1 ring-inset", softChip[issueStatusMeta[s].color], "border-transparent") : "border-sg-line text-sg-muted hover:text-sg-white",
                )}
              >
                {issueStatusMeta[s].label}
              </button>
            ))}
          </div>

          <section>
            <div className="sg-eyebrow mb-1.5">Description</div>
            {editingDesc ? (
              <div className="space-y-2">
                <Textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[140px]" />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      updateIssue(issue.id, { description });
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDescription(issue.description);
                      setEditingDesc(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setEditingDesc(true)} className="block w-full rounded border border-transparent px-1 py-1 text-left text-sm leading-relaxed text-sg-muted hover:border-sg-line">
                {issue.description ? <RichText text={issue.description} /> : <span className="text-sg-dim">Add a description…</span>}
              </button>
            )}
          </section>

          {/* CRM links — the bridge */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="sg-eyebrow flex items-center gap-1.5">
                <Link2 className="size-3" /> Linked CRM records ({links.length})
              </span>
              <Button size="xs" variant="ghost" onClick={() => openDialog({ kind: "linkRecord", agileType: "issue", agileId: issue.id })}>
                <Plus /> Link record
              </Button>
            </div>
            <div className="space-y-1.5">
              {links.map((l) => {
                const Icon = { deal: Handshake, ticket: Ticket, company: Building2, contact: User }[l.crmType];
                const deal = l.crmType === "deal" ? deals.find((d) => d.id === l.crmId) : undefined;
                const stage = deal ? stageOf.get(deal.stageId) : undefined;
                return (
                  <div key={l.id} className="group flex items-center gap-2.5 rounded-md border border-sg-line bg-sg-bg/40 px-3 py-2">
                    <Icon className="size-4 shrink-0 text-sg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-2xs">
                        <span className={cn("font-semibold uppercase tracking-wider", softText[linkTypeMeta[l.linkType].color])}>{linkTypeMeta[l.linkType].label}</span>
                        <span className="text-sg-dim"> {l.crmType}</span>
                      </div>
                      <Link href={l.href} onClick={() => openIssue(null)} className="block truncate text-sm font-semibold text-sg-white hover:underline">
                        {l.label}
                      </Link>
                      {deal ? (
                        <div className="text-2xs text-sg-dim">
                          {formatIDR(deal.amount)} · {stage?.name} · closes {formatDate(deal.closeDate, "short")}
                        </div>
                      ) : (
                        <div className="truncate text-2xs text-sg-dim">{l.sub}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        unlink(l.id);
                        notify("Link removed");
                      }}
                      className="rounded p-1 text-sg-dim opacity-0 hover:text-soft-red group-hover:opacity-100"
                      aria-label="Unlink"
                    >
                      <Unlink className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              {!links.length && <p className="rounded-md border border-dashed border-sg-line-2 px-3 py-3 text-center text-xs text-sg-dim">Not linked to any deal, ticket, company or contact.</p>}
            </div>
          </section>

          {/* subtasks */}
          {issue.type !== "subtask" && (
            <section>
              <div className="sg-eyebrow mb-2 flex items-center gap-1.5">
                <ListTree className="size-3" /> Sub-tasks ({subtasks.filter((s) => s.status === "done").length}/{subtasks.length})
              </div>
              {subtasks.length > 0 && (
                <div className="mb-2 h-1 overflow-hidden rounded-full bg-sg-card-3">
                  <div className="h-full bg-soft-green" style={{ width: `${(subtasks.filter((s) => s.status === "done").length / subtasks.length) * 100}%` }} />
                </div>
              )}
              <div className="space-y-1">
                {subtasks.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-sg-card-2">
                    <input type="checkbox" checked={s.status === "done"} onChange={() => updateIssue(s.id, { status: s.status === "done" ? "todo" : "done" })} className="size-3.5 accent-white" aria-label="Done" />
                    <button type="button" onClick={() => openIssue(s.id)} className="text-xs font-semibold text-sg-dim hover:text-sg-white">
                      {s.key}
                    </button>
                    <span className={cn("flex-1 truncate text-sm", s.status === "done" ? "text-sg-dim line-through" : "text-sg-text")}>{s.summary}</span>
                    <Avatar user={s.assigneeId ? userMap.get(s.assigneeId) : null} size="xs" />
                  </div>
                ))}
              </div>
              <form
                className="mt-1.5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newSub.trim()) return;
                  createIssue({ projectId: issue.projectId, type: "subtask", summary: newSub.trim(), parentId: issue.id, epicId: issue.epicId, sprintId: issue.sprintId, status: "todo", storyPoints: 1 });
                  setNewSub("");
                }}
              >
                <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a sub-task and press Enter" className="h-8 flex-1 rounded border border-sg-line bg-transparent px-2.5 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/50 focus:outline-none" />
              </form>
            </section>
          )}

          {/* comments */}
          <section>
            <div className="sg-eyebrow mb-2 flex items-center gap-1.5">
              <MessageSquare className="size-3" /> Comments ({issueComments.length})
            </div>
            <div className="space-y-3">
              {issueComments.map((c) => {
                const u = userMap.get(c.authorId);
                return (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar user={u} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs">
                        <span className="font-semibold text-sg-white">{u?.name}</span> <span className="text-sg-dim">{relativeTime(c.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-sg-muted">{c.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 rounded-lg border border-sg-line focus-within:border-sg-line-2">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && comment.trim()) {
                    e.preventDefault();
                    addComment(issue.id, comment.trim());
                    setComment("");
                  }
                }}
                placeholder="Add a comment… (⌘↵)"
                className="min-h-[64px] border-0 bg-transparent hover:border-0 focus:border-0"
              />
              <div className="flex justify-end border-t border-sg-line px-2 py-1.5">
                <Button
                  size="xs"
                  variant="primary"
                  disabled={!comment.trim()}
                  onClick={() => {
                    addComment(issue.id, comment.trim());
                    setComment("");
                  }}
                >
                  Comment
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* details column */}
        <aside className="space-y-3 border-sg-line bg-sg-bg/50 px-4 py-5 md:overflow-y-auto md:border-l">
          <Detail label="Assignee">
            <PickMenu
              value={issue.assigneeId ?? ""}
              options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
              onChange={(v) => updateIssue(issue.id, { assigneeId: v || null })}
              display={
                <span className="flex items-center gap-2">
                  <Avatar user={issue.assigneeId ? userMap.get(issue.assigneeId) : null} size="xs" />
                  {issue.assigneeId ? userMap.get(issue.assigneeId)?.name : <span className="text-sg-dim">Unassigned</span>}
                </span>
              }
            />
          </Detail>
          <Detail label="Priority">
            <PickMenu
              value={issue.priority}
              options={ISSUE_PRIORITIES.map((p) => ({ value: p, label: priorityMeta[p].label }))}
              onChange={(v) => updateIssue(issue.id, { priority: v as Issue["priority"] })}
              display={
                <span className={cn("flex items-center gap-1.5", softText[priorityMeta[issue.priority].color])}>
                  {(() => {
                    const P = priorityMeta[issue.priority].icon;
                    return <P className="size-3.5" />;
                  })()}
                  {priorityMeta[issue.priority].label}
                </span>
              }
            />
          </Detail>
          <Detail label="Story points">
            <PickMenu value={String(issue.storyPoints ?? "")} options={[{ value: "", label: "None" }, ...[1, 2, 3, 5, 8, 13, 21].map((p) => ({ value: String(p), label: String(p) }))]} onChange={(v) => updateIssue(issue.id, { storyPoints: v ? Number(v) : null })} display={issue.storyPoints ?? <span className="text-sg-dim">None</span>} />
          </Detail>
          <Detail label="Epic">
            <PickMenu
              value={issue.epicId ?? ""}
              options={[{ value: "", label: "No epic" }, ...epics.filter((e) => e.projectId === issue.projectId).map((e) => ({ value: e.id, label: `${e.key} · ${e.name}` }))]}
              onChange={(v) => updateIssue(issue.id, { epicId: v || null })}
              display={
                epic ? (
                  <span className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-sm", spectrumDot[epic.color])} />
                    <span className="truncate">{epic.name}</span>
                  </span>
                ) : (
                  <span className="text-sg-dim">None</span>
                )
              }
            />
          </Detail>
          <Detail label="Sprint">
            <PickMenu
              value={issue.sprintId ?? ""}
              options={[{ value: "", label: "Backlog" }, ...sprints.filter((s) => s.projectId === issue.projectId && s.state !== "closed").map((s) => ({ value: s.id, label: `${s.name}${s.state === "active" ? " (active)" : ""}` }))]}
              onChange={(v) => updateIssue(issue.id, { sprintId: v || null })}
              display={sprints.find((s) => s.id === issue.sprintId)?.name ?? <span className="text-sg-dim">Backlog</span>}
            />
          </Detail>
          <Detail label="Due date">
            <input
              type="date"
              value={toDateInput(issue.dueDate)}
              onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value ? fromDateInput(e.target.value) : null })}
              className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-sm text-sg-text hover:border-sg-line focus:border-sg-white/50 focus:outline-none"
            />
          </Detail>
          <Detail label="Labels">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <button key={l} type="button" onClick={() => updateIssue(issue.id, { labels: issue.labels.filter((x) => x !== l) })} className="group flex items-center gap-0.5 rounded-sm bg-sg-card-3 px-1.5 py-0.5 text-2xs text-sg-text hover:bg-soft-red/20" title="Remove label">
                  {l}
                  <X className="size-2.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && labelDraft.trim()) {
                    e.preventDefault();
                    const l = labelDraft.trim().toLowerCase().replace(/\s+/g, "-");
                    if (!issue.labels.includes(l)) updateIssue(issue.id, { labels: [...issue.labels, l] });
                    setLabelDraft("");
                  }
                }}
                placeholder="+ label"
                className="h-5 w-16 bg-transparent text-2xs text-sg-text placeholder:text-sg-dim focus:outline-none"
              />
            </div>
          </Detail>
          <Detail label="Reporter">
            <span className="flex items-center gap-2 text-sm text-sg-text">
              <Avatar user={userMap.get(issue.reporterId)} size="xs" /> {userMap.get(issue.reporterId)?.name}
            </span>
          </Detail>
          <div className="border-t border-sg-line pt-3 text-2xs text-sg-dim">
            <div>Created {formatDate(issue.createdAt, "datetime")}</div>
            <div>Updated {relativeTime(issue.updatedAt)}</div>
          </div>
          <div className="text-2xs text-sg-dim">
            <Kbd>1</Kbd>–<Kbd>5</Kbd> set status · <Kbd>Esc</Kbd> close
          </div>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-2xs font-semibold uppercase tracking-[0.1em] text-sg-dim">{label}</div>
      {children}
    </div>
  );
}

function PickMenu({ value, options, onChange, display }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; display: React.ReactNode }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="flex h-7 w-full items-center gap-1 rounded border border-transparent px-1 text-left text-sm text-sg-text hover:border-sg-line">
          <span className="min-w-0 flex-1 truncate">{display}</span>
          <ChevronDown className="size-3 shrink-0 text-sg-dim" />
        </button>
      </MenuTrigger>
      <MenuContent>
        {options.map((o) => (
          <MenuItem key={o.value} active={o.value === value} onSelect={() => onChange(o.value)}>
            {o.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Minimal markdown: **bold** and "- " bullets, line breaks preserved. */
function RichText({ text }: { text: string }) {
  return (
    <span className="block space-y-1">
      {text.split("\n").map((line, i) => {
        const bullet = line.startsWith("- ");
        const parts = (bullet ? line.slice(2) : line).split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <strong key={j} className="font-semibold text-sg-white">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>));
        if (!line.trim()) return <span key={i} className="block h-1" />;
        return (
          <span key={i} className={cn("block", bullet && "pl-3 before:-ml-3 before:mr-1.5 before:content-['•']")}>
            {parts}
          </span>
        );
      })}
    </span>
  );
}

