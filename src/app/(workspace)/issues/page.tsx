"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardList, Link2, Plus, Trash2, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, type Issue } from "@/lib/types";
import { issueStatusMeta, issueTypeMeta, priorityMeta } from "@/lib/meta";
import { cn, relativeTime, softChip, softText, spectrumDot } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar, EmptyState, Kbd } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { JqlBar, useJql, useUrlQuery } from "@/components/agile/jql-bar";
import { useProjectParam } from "@/components/agile/project-param";
import { createIssueKey, useAgileHotkeys } from "@/components/agile/use-agile-hotkeys";

type SortKey = "key" | "type" | "summary" | "status" | "priority" | "assignee" | "sprint" | "epic" | "points" | "links" | "updated";

const COLS: { key: SortKey; label: string; className: string; numeric?: boolean }[] = [
  { key: "key", label: "Key", className: "w-[88px]" },
  { key: "type", label: "Type", className: "w-[44px]" },
  { key: "summary", label: "Summary", className: "min-w-[260px]" },
  { key: "status", label: "Status", className: "w-[110px]" },
  { key: "priority", label: "Priority", className: "w-[90px]" },
  { key: "assignee", label: "Assignee", className: "w-[140px]" },
  { key: "sprint", label: "Sprint", className: "w-[120px]" },
  { key: "epic", label: "Epic", className: "w-[150px]" },
  { key: "points", label: "Pts", className: "w-[52px]", numeric: true },
  { key: "links", label: "CRM", className: "w-[52px]", numeric: true },
  { key: "updated", label: "Updated", className: "w-[86px]" },
];

export default function IssuesPage() {
  const issues = useCrm((s) => s.issues);
  const projects = useCrm((s) => s.projects);
  const sprints = useCrm((s) => s.sprints);
  const epics = useCrm((s) => s.epics);
  const users = useCrm((s) => s.users);
  const crossLinks = useCrm((s) => s.crossLinks);
  const updateIssueTracked = useCrm((s) => s.updateIssueTracked);
  const deleteIssues = useCrm((s) => s.deleteIssues);
  const restoreIssues = useCrm((s) => s.restoreIssues);
  const openIssue = useUi((s) => s.openIssue);
  const openDialog = useUi((s) => s.openDialog);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();

  const [projectId, setProjectId] = useProjectParam("all");
  const [q, setQ] = useUrlQuery();
  const jql = useJql(q);
  const [hideSubtasks, setHideSubtasks] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updated", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<number | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const sprintById = useMemo(() => new Map(sprints.map((s) => [s.id, s])), [sprints]);
  const epicById = useMemo(() => new Map(epics.map((e) => [e.id, e])), [epics]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    crossLinks.forEach((x) => x.agileType === "issue" && m.set(x.agileId, (m.get(x.agileId) ?? 0) + 1));
    return m;
  }, [crossLinks]);

  const projectIssues = useMemo(() => (projectId === "all" ? issues : issues.filter((i) => i.projectId === projectId)), [issues, projectId]);

  const rows = useMemo(() => {
    const keyNum = (i: Issue) => Number(i.key.split("-")[1]) || 0;
    const val = (i: Issue): string | number => {
      switch (sort.key) {
        case "key":
          return `${projectById.get(i.projectId)?.key ?? ""}-${String(keyNum(i)).padStart(6, "0")}`;
        case "type":
          return issueTypeMeta[i.type].label;
        case "summary":
          return i.summary.toLowerCase();
        case "status":
          return ISSUE_STATUSES.indexOf(i.status);
        case "priority":
          return priorityMeta[i.priority].weight;
        case "assignee":
          return i.assigneeId ? (userMap.get(i.assigneeId)?.name ?? "") : "~";
        case "sprint":
          return i.sprintId ? (sprintById.get(i.sprintId)?.name ?? "") : "~";
        case "epic":
          return i.epicId ? (epicById.get(i.epicId)?.key ?? "") : "~";
        case "points":
          return i.storyPoints ?? -1;
        case "links":
          return linkCount.get(i.id) ?? 0;
        case "updated":
          return i.updatedAt;
      }
    };
    return projectIssues
      .filter((i) => (!hideSubtasks || i.type !== "subtask") && (!jql.active || jql.match(i)))
      .map((i) => ({ i, v: val(i) }))
      .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * sort.dir || a.i.key.localeCompare(b.i.key))
      .map((x) => x.i);
  }, [projectIssues, hideSubtasks, jql, sort, projectById, userMap, sprintById, epicById, linkCount]);

  const chosen = rows.filter((r) => selected.has(r.id));
  const allOn = rows.length > 0 && chosen.length === rows.length;
  const someOn = chosen.length > 0 && !allOn;

  useAgileHotkeys((e) => {
    if (createIssueKey(e, projectId === "all" ? undefined : projectId)) return true;
    if (e.key === "Escape" && selected.size) {
      setSelected(new Set());
      return true;
    }
    return false;
  });

  const toggleRow = (idx: number, shift: boolean) => {
    const id = rows[idx]!.id;
    const next = new Set(selected);
    if (shift && lastClicked.current !== null) {
      const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)];
      const on = !selected.has(id);
      rows.slice(a, b + 1).forEach((r) => (on ? next.add(r.id) : next.delete(r.id)));
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    lastClicked.current = idx;
    setSelected(next);
  };

  /** apply a patch to many issues, with Undo restoring each issue's previous values */
  const bulkSet = <K extends keyof Issue>(field: K, value: Issue[K], label: string, only?: (i: Issue) => boolean) => {
    const targets = chosen.filter((i) => (only ? only(i) : true) && i[field] !== value);
    const skipped = only ? chosen.filter((i) => !only(i)).length : 0;
    if (!targets.length) {
      notify(skipped ? `No change — ${skipped} selected issue${skipped === 1 ? "" : "s"} belong to another project` : "Nothing to change");
      return;
    }
    const prev = targets.map((i) => ({ id: i.id, value: i[field] }));
    targets.forEach((i) => updateIssueTracked(i.id, { [field]: value } as Partial<Issue>));
    notify(`${label} for ${targets.length} issue${targets.length === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped (other project)` : ""}`, {
      label: "Undo",
      run: () => prev.forEach((p) => updateIssueTracked(p.id, { [field]: p.value } as Partial<Issue>)),
    });
  };

  const bulkDelete = () => {
    const ids = chosen.map((i) => i.id);
    const snap = deleteIssues(ids);
    setSelected(new Set());
    const extra = snap.issues.length - ids.length;
    notify(`Deleted ${ids.length} issue${ids.length === 1 ? "" : "s"}${extra > 0 ? ` and ${extra} sub-task${extra === 1 ? "" : "s"}` : ""}`, { label: "Undo", run: () => restoreIssues(snap) });
  };

  const chosenProjects = new Set(chosen.map((i) => i.projectId));
  const sprintOptions = sprints.filter((s) => s.state !== "closed" && chosenProjects.has(s.projectId)).sort((a, b) => a.projectId.localeCompare(b.projectId) || (a.state === b.state ? a.startDate.localeCompare(b.startDate) : a.state === "active" ? -1 : 1));
  const projectEmpty = projectId !== "all" && projectIssues.length === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Issues" meta={<span className="text-sm text-sg-dim">{project ? project.name : "All projects"}</span>}>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} wrapperClassName="w-48" aria-label="Project">
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </Select>
        <Button variant="primary" onClick={() => openDialog({ kind: "createIssue", projectId: projectId === "all" ? undefined : projectId })}>
          <Plus /> Create issue <Kbd className="ml-1 border-sg-bg/30 bg-transparent text-sg-bg/70">C</Kbd>
        </Button>
      </PageHeader>

      <div className="flex shrink-0 flex-wrap items-start gap-x-4 gap-y-2 border-b border-sg-line px-5 py-2 text-xs">
        <JqlBar value={q} onChange={setQ} issues={issues} errors={jql.errors} className="w-full min-w-[260px] flex-1 lg:max-w-[640px]" />
        <label className="flex h-8 cursor-pointer items-center gap-1.5 text-sg-muted">
          <input type="checkbox" checked={hideSubtasks} onChange={(e) => setHideSubtasks(e.target.checked)} className="size-3.5 accent-white" />
          Hide sub-tasks
        </label>
        <span className="ml-auto flex h-8 items-center text-sg-dim">
          {rows.length} of {projectIssues.length} issues
        </span>
      </div>

      {/* bulk action bar */}
      {chosen.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-sg-line bg-sg-card-2 px-5 py-1.5 text-xs">
          <span className="font-semibold text-sg-white">{chosen.length} selected</span>
          <BulkMenu label="Status">
            {ISSUE_STATUSES.map((s) => (
              <MenuItem key={s} onSelect={() => bulkSet("status", s, `Status → ${issueStatusMeta[s].label}`)}>
                <span className={cn("size-2 rounded-full", spectrumDot[issueStatusMeta[s].color])} /> {issueStatusMeta[s].label}
              </MenuItem>
            ))}
          </BulkMenu>
          <BulkMenu label="Assignee">
            <MenuItem onSelect={() => bulkSet("assigneeId", null, "Unassigned")}>Unassigned</MenuItem>
            <MenuSeparator />
            {users.map((u) => (
              <MenuItem key={u.id} onSelect={() => bulkSet("assigneeId", u.id, `Assigned to ${u.name}`)}>
                <Avatar user={u} size="xs" /> {u.name}
              </MenuItem>
            ))}
          </BulkMenu>
          <BulkMenu label="Sprint">
            <MenuItem onSelect={() => bulkSet("sprintId", null, "Moved to backlog")}>Backlog (no sprint)</MenuItem>
            {sprintOptions.length > 0 && <MenuSeparator />}
            {sprintOptions.length > 0 && chosenProjects.size > 1 && <MenuLabel>Applies to that sprint's project only</MenuLabel>}
            {sprintOptions.map((s) => (
              <MenuItem key={s.id} onSelect={() => bulkSet("sprintId", s.id, `Moved to ${s.name}`, (i) => i.projectId === s.projectId)}>
                {s.name}
                <span className="ml-auto text-2xs text-sg-dim">{s.state === "active" ? "active" : "future"}</span>
              </MenuItem>
            ))}
          </BulkMenu>
          <BulkMenu label="Priority">
            {ISSUE_PRIORITIES.map((p) => {
              const P = priorityMeta[p].icon;
              return (
                <MenuItem key={p} onSelect={() => bulkSet("priority", p, `Priority → ${priorityMeta[p].label}`)}>
                  <P className={cn("size-3.5", softText[priorityMeta[p].color])} /> {priorityMeta[p].label}
                </MenuItem>
              );
            })}
          </BulkMenu>
          <Button size="sm" variant="danger" onClick={bulkDelete}>
            <Trash2 /> Delete
          </Button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto flex items-center gap-1 text-sg-dim hover:text-sg-white">
            <X className="size-3.5" /> Clear <Kbd>Esc</Kbd>
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {projectEmpty ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-dashed border-sg-line-2 bg-sg-card/40">
              <EmptyState
                icon={ClipboardList}
                title={`${project?.name ?? "This project"} has no issues yet`}
                action={
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => openDialog({ kind: "createIssue", projectId })}>
                      <Plus /> Create the first issue
                    </Button>
                    <Link href={`/backlog?project=${projectId}`} className="flex h-7 items-center rounded border border-sg-line-2 px-2.5 text-xs font-semibold text-sg-text hover:border-sg-white hover:text-sg-white">
                      Open backlog
                    </Link>
                  </div>
                }
              >
                Every {project?.key} story, task and bug will be listed here with bulk editing and JQL search.
              </EmptyState>
            </div>
          </div>
        ) : (
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10 bg-sg-bg">
              <tr>
                <th className="w-9 border-b border-sg-line px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = someOn;
                    }}
                    onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                    className="size-3.5 accent-white"
                    aria-label="Select all visible issues"
                  />
                </th>
                {COLS.map((c) => {
                  const on = sort.key === c.key;
                  return (
                    <th key={c.key} className={cn("border-b border-sg-line px-2 py-2 text-left font-semibold", c.className, c.numeric && "text-right")} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.key === "updated" || c.key === "priority" || c.numeric ? -1 : 1 }))}
                        className={cn("inline-flex items-center gap-0.5 text-2xs uppercase tracking-[0.1em]", on ? "text-sg-white" : "text-sg-dim hover:text-sg-white")}
                      >
                        {c.label}
                        {on && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => {
                const T = issueTypeMeta[i.type].icon;
                const P = priorityMeta[i.priority].icon;
                const sp = i.sprintId ? sprintById.get(i.sprintId) : undefined;
                const ep = i.epicId ? epicById.get(i.epicId) : undefined;
                const assignee = i.assigneeId ? userMap.get(i.assigneeId) : undefined;
                const links = linkCount.get(i.id) ?? 0;
                const on = selected.has(i.id);
                return (
                  <tr key={i.id} onClick={() => openIssue(i.id)} className={cn("group h-8 cursor-pointer", on ? "bg-sg-card-2" : "hover:bg-sg-card")}>
                    <td className="border-b border-sg-line px-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => undefined}
                        onClick={(e) => toggleRow(idx, e.shiftKey)}
                        className="size-3.5 accent-white"
                        aria-label={`Select ${i.key}`}
                      />
                    </td>
                    <td className="border-b border-sg-line px-2 font-semibold text-sg-muted">{i.key}</td>
                    <td className="border-b border-sg-line px-2" title={issueTypeMeta[i.type].label}>
                      <T className={cn("size-3.5", softText[issueTypeMeta[i.type].color])} aria-label={issueTypeMeta[i.type].label} />
                    </td>
                    <td className="max-w-0 border-b border-sg-line px-2">
                      <span className={cn("block truncate text-sm", i.status === "done" ? "text-sg-dim line-through" : "text-sg-text group-hover:text-sg-white")}>
                        {i.type === "subtask" && <span className="text-sg-dim">↳ </span>}
                        {i.summary}
                      </span>
                    </td>
                    <td className="border-b border-sg-line px-2">
                      <span className={cn("inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", softChip[issueStatusMeta[i.status].color])}>{issueStatusMeta[i.status].label}</span>
                    </td>
                    <td className="border-b border-sg-line px-2">
                      <span className={cn("inline-flex items-center gap-1", softText[priorityMeta[i.priority].color])}>
                        <P className="size-3.5" /> {priorityMeta[i.priority].label}
                      </span>
                    </td>
                    <td className="border-b border-sg-line px-2">
                      <span className="flex items-center gap-1.5 truncate">
                        <Avatar user={assignee ?? null} size="xs" />
                        <span className={cn("truncate", assignee ? "text-sg-text" : "text-sg-dim")}>{assignee?.name ?? "Unassigned"}</span>
                      </span>
                    </td>
                    <td className="max-w-0 border-b border-sg-line px-2">
                      <span className={cn("block truncate", sp?.state === "active" ? "text-soft-cyan" : sp ? "text-sg-muted" : "text-sg-dim")}>{sp?.name ?? "Backlog"}</span>
                    </td>
                    <td className="max-w-0 border-b border-sg-line px-2">
                      {ep ? (
                        <span className="flex items-center gap-1 truncate" title={`${ep.key} · ${ep.name}`}>
                          <span className={cn("size-2 shrink-0 rounded-sm", spectrumDot[ep.color])} />
                          <span className="truncate text-sg-muted">{ep.name}</span>
                        </span>
                      ) : (
                        <span className="text-sg-dim">—</span>
                      )}
                    </td>
                    <td className="sg-num border-b border-sg-line px-2 text-right text-sg-muted">{i.storyPoints ?? "—"}</td>
                    <td className="border-b border-sg-line px-2 text-right">
                      {links ? (
                        <span className="inline-flex items-center gap-0.5 text-soft-yellow" title={`${links} linked CRM record${links === 1 ? "" : "s"}`}>
                          <Link2 className="size-3" />
                          <span className="sg-num">{links}</span>
                        </span>
                      ) : (
                        <span className="text-sg-dim">—</span>
                      )}
                    </td>
                    <td className="border-b border-sg-line px-2 text-sg-dim" title={i.updatedAt}>
                      {relativeTime(i.updatedAt)}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={COLS.length + 1} className="py-16 text-center text-sm text-sg-muted">
                    No issues match{jql.active ? " this query" : ""}.
                    {(jql.active || hideSubtasks) && (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setQ("");
                            setHideSubtasks(false);
                          }}
                        >
                          Clear filters
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BulkMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="outline">
          {label} <ChevronDown />
        </Button>
      </MenuTrigger>
      <MenuContent>{children}</MenuContent>
    </Menu>
  );
}
