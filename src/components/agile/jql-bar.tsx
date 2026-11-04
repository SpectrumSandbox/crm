"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlert, Search, Star, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { compileJql, parseJql, suggestJql, type JqlContext, type JqlSuggestion } from "@/lib/jql";
import type { Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ───────────── store-backed context + compiled predicate ───────────── */

export function useJqlContext(): JqlContext {
  const users = useCrm((s) => s.users);
  const sprints = useCrm((s) => s.sprints);
  const epics = useCrm((s) => s.epics);
  const projects = useCrm((s) => s.projects);
  const deals = useCrm((s) => s.deals);
  const contacts = useCrm((s) => s.contacts);
  const crossLinks = useCrm((s) => s.crossLinks);
  const pipelines = useCrm((s) => s.pipelines);
  const currentUserId = useCrm((s) => s.currentUserId);
  return useMemo(() => ({ users, sprints, epics, projects, deals, contacts, crossLinks, pipelines, currentUserId }), [users, sprints, epics, projects, deals, contacts, crossLinks, pipelines, currentUserId]);
}

export function useJql(q: string) {
  const ctx = useJqlContext();
  return useMemo(() => {
    const parsed = parseJql(q, ctx);
    return { parsed, errors: parsed.errors, match: compileJql(parsed, ctx), active: parsed.terms.length > 0 || parsed.text.length > 0 };
  }, [q, ctx]);
}

/** Query kept in the URL as ?q= (replaceState — no navigation, no scroll jump). */
export function useUrlQuery(): [string, (q: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get("q") ?? "";
  const [q, setQ] = useState(fromUrl);
  useEffect(() => {
    setQ((cur) => (cur === fromUrl ? cur : fromUrl));
  }, [fromUrl]);
  const update = (next: string) => {
    setQ(next);
    try {
      const url = new URL(window.location.href);
      if (next.trim()) url.searchParams.set("q", next);
      else url.searchParams.delete("q");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* non-browser */
    }
  };
  return [q, update];
}

/* ───────────── saved queries (localStorage) ───────────── */

const SAVED_KEY = "sg-agile-saved-queries";

function readSaved(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function useSavedQueries(): [string[], (next: string[]) => void] {
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    setSaved(readSaved());
    const onStorage = (e: StorageEvent) => e.key === SAVED_KEY && setSaved(readSaved());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const write = (next: string[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return [saved, write];
}

/* ───────────── the bar ───────────── */

export function JqlBar({ value, onChange, issues, className, errors }: { value: string; onChange: (q: string) => void; issues: Issue[]; className?: string; errors: { message: string; token: string }[] }) {
  const ctx = useJqlContext();
  const notify = useUi((s) => s.notify);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [saved, setSaved] = useSavedQueries();

  const sugg = useMemo(() => suggestJql(value, caret, ctx, issues), [value, caret, ctx, issues]);
  const open = focused && !dismissed && sugg.suggestions.length > 0;
  useEffect(() => setHi(0), [sugg.suggestions.length, sugg.start]);

  const trimmed = value.trim();
  const isSaved = !!trimmed && saved.includes(trimmed);

  const apply = (s: JqlSuggestion) => {
    const next = value.slice(0, sugg.start) + s.insert + value.slice(sugg.end).replace(/^\s+/, "");
    onChange(next);
    const pos = sugg.start + s.insert.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const toggleSave = () => {
    if (!trimmed) return;
    if (isSaved) {
      setSaved(saved.filter((x) => x !== trimmed));
      notify("Saved query removed");
    } else {
      setSaved([...saved, trimmed].slice(-12));
      notify("Query saved");
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
        <input
          ref={inputRef}
          data-page-filter
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(false);
          }}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + sugg.suggestions.length) % sugg.suggestions.length);
              return;
            }
            if (open && (e.key === "Tab" || e.key === "Enter")) {
              e.preventDefault();
              apply(sugg.suggestions[hi]!);
              return;
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              if (open) setDismissed(true);
              else (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder='Filter: status:"in progress" assignee:me points:>3 …'
          aria-label="Issue query"
          aria-autocomplete="list"
          aria-expanded={open}
          className={cn(
            "h-8 w-full rounded border bg-sg-bg/60 pl-7 pr-14 font-mono text-xs text-sg-text placeholder:font-sans placeholder:text-sg-dim focus:outline-none",
            errors.length ? "border-soft-orange/60 focus:border-soft-orange" : "border-sg-line focus:border-sg-white/60",
          )}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {value && (
            <button type="button" onClick={() => onChange("")} className="rounded p-1 text-sg-dim hover:text-sg-white" aria-label="Clear query" title="Clear">
              <X className="size-3.5" />
            </button>
          )}
          <button type="button" onClick={toggleSave} disabled={!trimmed} className={cn("rounded p-1 disabled:opacity-30", isSaved ? "text-soft-yellow" : "text-sg-dim hover:text-sg-white")} aria-label={isSaved ? "Remove saved query" : "Save query"} title={isSaved ? "Remove from saved queries" : "Save this query"}>
            <Star className="size-3.5" />
          </button>
        </div>
        {open && (
          <div role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full min-w-[280px] overflow-y-auto rounded-lg border border-sg-line bg-sg-card-2 p-1 shadow-pop">
            {sugg.suggestions.map((s, idx) => (
              <button
                key={`${s.label}-${idx}`}
                type="button"
                role="option"
                aria-selected={idx === hi}
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(s);
                }}
                onMouseEnter={() => setHi(idx)}
                className={cn("flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs", idx === hi ? "bg-sg-card-3 text-sg-white" : "text-sg-text")}
              >
                <span className="font-mono">{s.label}</span>
                {s.hint && <span className="truncate text-2xs text-sg-dim">{s.hint}</span>}
              </button>
            ))}
            <div className="border-t border-sg-line px-2 pb-0.5 pt-1 text-[10px] text-sg-dim">↑↓ choose · Tab/Enter insert · Esc close</div>
          </div>
        )}
      </div>
      {errors.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {errors.map((er, i) => (
            <p key={i} className="flex items-start gap-1 text-2xs text-soft-orange">
              <CircleAlert className="mt-px size-3 shrink-0" />
              <span>
                <code className="font-mono text-sg-text">{er.token}</code> — {er.message} <span className="text-sg-dim">(ignored)</span>
              </span>
            </p>
          ))}
        </div>
      )}
      {saved.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Star className="size-3 text-sg-dim" />
          {saved.map((s) => (
            <span key={s} className={cn("group flex max-w-[260px] items-center rounded-pill border text-2xs", s === trimmed ? "border-sg-white bg-sg-white text-sg-bg" : "border-sg-line text-sg-muted hover:border-sg-line-2 hover:text-sg-white")}>
              <button type="button" onClick={() => onChange(s)} className="truncate py-0.5 pl-2 pr-1 font-mono" title={s}>
                {s}
              </button>
              <button type="button" onClick={() => setSaved(saved.filter((x) => x !== s))} className="pr-1.5 opacity-60 hover:opacity-100" aria-label={`Remove saved query ${s}`}>
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
