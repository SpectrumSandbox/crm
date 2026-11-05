"use client";

import * as React from "react";
import { create } from "zustand";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";

/*
 * Toasts. `toast(message, { tone, action })` is the full API; the store's `useUi().notify(message, action)` keeps working
 * and is bridged here (its tone is inferred from the wording). Toasts queue instead of replacing each other, pause while
 * hovered or focused, can be dismissed, and ⌘Z / Ctrl+Z runs the newest visible "Undo". Every toast is announced through
 * a live region placed inside the open dialog when there is one (Radix hides everything outside a modal from AT).
 */

export type ToastTone = "success" | "info" | "warn" | "error";
export interface ToastAction {
  label: string;
  run: () => void;
}
export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** ms before it hides (paused while hovered / focused) */
  duration: number;
}

const MAX_VISIBLE = 3;
let seq = 0;

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id" | "duration"> & { duration?: number }) => number;
  dismiss: (id: number) => void;
}

export const useToasts = create<ToastStore>()((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    const duration = t.duration ?? (t.action ? 8000 : t.tone === "error" ? 7000 : t.tone === "warn" ? 5000 : 3200);
    set((s) => {
      // the same message twice in a row just restarts (no stack of duplicates)
      const rest = s.items.filter((x) => !(x.message === t.message && !x.action && !t.action));
      return { items: [...rest, { ...t, id, duration }].slice(-8) };
    });
    announce(t.message + (t.action ? `. ${t.action.label} with Control Z or Command Z.` : ""), t.tone === "error");
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

const WARN = /\b(not found|no linked|has no|already|first\b|blocked|restricted|missing|can['’]t|cannot|couldn['’]t|isn['’]t|aren['’]t|not allowed|unable|denied|locked|offline|nothing to|skipped|only\b.*\bcan)\b/i;
const ERROR = /\b(failed|error|invalid|rejected)\b/i;

/** Tone for a plain message from the legacy notify(): warnings and errors shouldn't wear a green check. */
export function inferTone(message: string, hasAction = false): ToastTone {
  // an Undo toast confirms something that happened
  if (hasAction) return ERROR.test(message) ? "error" : "success";
  if (ERROR.test(message)) return "error";
  if (WARN.test(message)) return "warn";
  return "success";
}

/** Show a toast. Returns its id (for dismissToast). */
export function toast(message: string, opts: { tone?: ToastTone; action?: ToastAction; duration?: number } = {}) {
  return useToasts.getState().push({ message, tone: opts.tone ?? inferTone(message, !!opts.action), action: opts.action, duration: opts.duration });
}
export function dismissToast(id: number) {
  useToasts.getState().dismiss(id);
}

/* ───────────── screen-reader announcements ───────────── */

function announce(text: string, assertive: boolean) {
  if (typeof document === "undefined") return;
  const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
  const host = open[open.length - 1] ?? document.body;
  let region = Array.from(host.children).find((c) => c instanceof HTMLElement && c.dataset.toastAnnouncer === (assertive ? "assertive" : "polite")) as HTMLElement | undefined;
  if (!region) {
    region = document.createElement("div");
    region.dataset.toastAnnouncer = assertive ? "assertive" : "polite";
    region.setAttribute("role", assertive ? "alert" : "status");
    region.setAttribute("aria-live", assertive ? "assertive" : "polite");
    region.setAttribute("aria-atomic", "true");
    region.className = "sr-only";
    host.appendChild(region);
  }
  const el = region;
  // a region that has just been created needs a beat before its content counts as a change
  el.textContent = "";
  window.setTimeout(() => {
    el.textContent = text;
  }, 80);
}

/* ───────────── viewport ───────────── */

const toneIcon = {
  success: { Icon: Check, cls: "text-soft-green", label: "Done" },
  info: { Icon: Info, cls: "text-soft-blue", label: "Note" },
  warn: { Icon: TriangleAlert, cls: "text-soft-yellow", label: "Warning" },
  error: { Icon: CircleAlert, cls: "text-soft-red", label: "Error" },
} as const;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** Mount once (the app shell does). Bridges useUi().notify and renders the toast stack. */
export function ToastViewport() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const [paused, setPaused] = React.useState(false);

  // bridge the store's notify()
  React.useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (s.toast && s.toast !== prev.toast) {
          useToasts.getState().push({ message: s.toast.message, tone: inferTone(s.toast.message, !!s.toast.action), action: s.toast.action });
        }
      }),
    [],
  );

  // ⌘Z / Ctrl+Z: run the newest visible Undo (text fields keep their own undo)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z" || isTyping(e.target)) return;
      const list = useToasts.getState().items;
      const undo = [...list].reverse().find((t) => t.action && /undo|restore|put back/i.test(t.action.label));
      if (!undo?.action) return;
      e.preventDefault();
      undo.action.run();
      useToasts.getState().dismiss(undo.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = items.slice(-MAX_VISIBLE);
  if (!visible.length) return null;
  return (
    <div
      aria-label="Notifications"
      role="region"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-3 print:hidden"
    >
      {visible.map((t) => (
        <ToastRow key={t.id} item={t} paused={paused} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({ item, paused, onDismiss }: { item: ToastItem; paused: boolean; onDismiss: () => void }) {
  const remaining = React.useRef(item.duration);
  const startedAt = React.useRef(0);
  React.useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const t = window.setTimeout(onDismiss, Math.max(400, remaining.current ?? item.duration));
    return () => {
      window.clearTimeout(t);
      remaining.current = (remaining.current ?? item.duration) - (Date.now() - (startedAt.current ?? Date.now()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  const { Icon, cls, label } = toneIcon[item.tone];
  return (
    <div
      data-testid="toast"
      data-tone={item.tone}
      className="pointer-events-auto flex max-w-[min(560px,calc(100vw-24px))] items-center gap-2 rounded-pill border border-sg-line-2 bg-sg-card-2 py-1.5 pl-4 pr-1.5 text-sm font-semibold text-sg-white shadow-pop animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <Icon className={cn("size-4 shrink-0", cls)} aria-label={label} />
      <span className="min-w-0 flex-1 truncate" title={item.message}>
        {item.message}
      </span>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.run();
            onDismiss();
          }}
          className="ml-1 flex shrink-0 items-center gap-1 rounded-pill border border-sg-line-2 px-2 py-0.5 text-xs text-sg-white hover:bg-sg-white hover:text-sg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
        >
          {item.action.label}
          {/undo/i.test(item.action.label) ? <span className="hidden text-2xs font-medium text-sg-dim sm:inline [@media(hover:none)]:hidden">⌘Z</span> : null}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="flex size-6 shrink-0 items-center justify-center rounded-full text-sg-dim hover:bg-sg-card-3 hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
