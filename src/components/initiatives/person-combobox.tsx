"use client";

/* Searchable person picker — type to filter by name, title, team or email; ↑/↓ + Enter to pick; eligibility inline (§3). */
import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useCrm } from "@/lib/store";
import type { User } from "@/lib/types";
import { participationEligibility } from "@/lib/initiatives/engine";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";

export function PersonCombobox({
  value,
  onChange,
  users,
  placeholder = "Choose a person…",
  disabled,
  ariaLabel = "Person",
  showEligibility = true,
}: {
  value: string;
  onChange: (userId: string) => void;
  /** candidates (already filtered by the caller, e.g. not on the team) */
  users: User[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  showEligibility?: boolean;
}) {
  const profiles = useCrm((s) => s.employeeProfiles);
  const allUsers = useCrm((s) => s.users);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = allUsers.find((u) => u.id === value);

  const eligibility = useMemo(() => {
    const map = new Map<string, ReturnType<typeof participationEligibility>>();
    for (const u of users) map.set(u.id, participationEligibility(profiles.find((p) => p.userId === u.id)));
    return map;
  }, [users, profiles]);

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = [...users].sort((a, b) => a.name.localeCompare(b.name));
    if (!terms.length) return list;
    return list.filter((u) => {
      const hay = `${u.name} ${u.title} ${u.team} ${u.email}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [users, q]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
      listRef.current?.querySelectorAll("li")[Math.min(filtered.length - 1, active + 1)]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      listRef.current?.querySelectorAll("li")[Math.max(0, active - 1)]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const u = filtered[active];
      if (u) pick(u.id);
    }
  };

  const status = (id: string) => {
    const r = eligibility.get(id) ?? participationEligibility(profiles.find((p) => p.userId === id));
    return !r.ok ? { cls: "text-soft-red", label: "Not eligible", title: r.blockers.join("\n") } : r.warnings.length ? { cls: "text-soft-yellow", label: "Eligible · note", title: r.warnings.join("\n") } : { cls: "text-soft-green", label: "Eligible", title: "Eligible (§3.1)" };
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setActive(0);
        else setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-8 w-full items-center gap-2 rounded border border-sg-line bg-sg-bg/60 px-2.5 text-left text-sm text-sg-text transition-colors hover:border-sg-line-2 focus:border-sg-white/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-sg-white/40 disabled:opacity-50"
        >
          {selected ? (
            <>
              <Avatar user={selected} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                {selected.name} <span className="text-sg-dim">— {selected.title}</span>
              </span>
              {showEligibility ? <span className={cn("shrink-0 text-2xs font-semibold", status(selected.id).cls)}>{status(selected.id).label}</span> : null}
            </>
          ) : (
            <span className="flex-1 truncate text-sg-dim">{placeholder}</span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-sg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-32px))] p-0">
        <div className="flex items-center gap-2 border-b border-sg-line px-2.5">
          <Search className="size-3.5 text-sg-dim" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Search name, title, team or email"
            aria-label="Search people"
            aria-controls={listId}
            className="h-9 w-full bg-transparent text-sm text-sg-text placeholder:text-sg-dim focus:outline-none"
          />
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto py-1">
          {filtered.map((u, i) => {
            const st = status(u.id);
            return (
              <li
                key={u.id}
                role="option"
                aria-selected={u.id === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(u.id)}
                className={cn("flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm", i === active ? "bg-sg-card-3" : "")}
              >
                <Avatar user={u} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sg-white">{u.name}</span>
                  <span className="block truncate text-2xs text-sg-dim">
                    {u.title} · {u.team}
                  </span>
                </span>
                {showEligibility ? (
                  <span className={cn("shrink-0 text-2xs font-semibold", st.cls)} title={st.title}>
                    {st.label}
                  </span>
                ) : null}
                {u.id === value ? <Check className="size-3.5 shrink-0 text-sg-white" /> : null}
              </li>
            );
          })}
          {!filtered.length ? <li className="px-3 py-3 text-xs text-sg-dim">No one matches “{q}”.</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
