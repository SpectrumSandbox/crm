"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn, formatDate, formatIDR, fromDateInput, fromDateTimeInput, isDateInput, parseIDR, toDateInput, toDateTimeInput } from "@/lib/utils";

type Editor =
  | { kind: "text"; value: string; required?: boolean }
  | { kind: "email"; value: string }
  | { kind: "textarea"; value: string }
  | { kind: "number"; value: number; min?: number; max?: number }
  /** rupiah: accepts "8.400.000.000", "8,4 M", "720 jt", "Rp 2.950.000.000" */
  | { kind: "money"; value: number; allowZero?: boolean }
  | { kind: "date"; value: string }
  /** date + time in WIB (e.g. a ticket SLA deadline) */
  | { kind: "datetime"; value: string }
  | { kind: "select"; value: string; options: { value: string; label: string }[] };

/** turn the draft into the value handed to onSave, or an error message */
function validate(editor: Editor, value: string): { ok: true; value: string } | { ok: false; error: string } {
  switch (editor.kind) {
    case "date":
      return isDateInput(value) ? { ok: true, value: fromDateInput(value) } : { ok: false, error: "Pick a date" };
    case "datetime": {
      const iso = fromDateTimeInput(value);
      return iso ? { ok: true, value: iso } : { ok: false, error: "Pick a date and time" };
    }
    case "money": {
      const n = parseIDR(value);
      if (n === null) return { ok: false, error: value.trim() ? "Not an amount — try 8.400.000.000 or 8,4 M" : "Enter an amount" };
      if (n < 0 || (n === 0 && !editor.allowZero)) return { ok: false, error: "Amount must be above 0" };
      return { ok: true, value: String(n) };
    }
    case "number": {
      const n = parseIDR(value);
      if (n === null) return { ok: false, error: value.trim() ? "Not a number" : "Enter a number" };
      if (editor.min !== undefined && n < editor.min) return { ok: false, error: `Minimum ${editor.min}` };
      if (editor.max !== undefined && n > editor.max) return { ok: false, error: `Maximum ${editor.max}` };
      return { ok: true, value: String(n) };
    }
    case "email":
      return /^\S+@\S+\.\S+$/.test(value.trim()) ? { ok: true, value: value.trim() } : { ok: false, error: "Enter a valid email" };
    case "text":
      return editor.required && !value.trim() ? { ok: false, error: "Can't be empty" } : { ok: true, value };
    default:
      return { ok: true, value };
  }
}

const initialDraft = (editor: Editor) => (editor.kind === "date" ? toDateInput(editor.value) : editor.kind === "datetime" ? toDateTimeInput(editor.value) : String(editor.value ?? ""));

/**
 * HubSpot-style inline property: label over value; click (or Enter when focused) to edit,
 * Enter / blur saves, Esc cancels. Invalid input keeps the editor open with a red hint instead of saving.
 */
export function EditableProperty({
  label,
  display,
  editor,
  onSave,
  readOnly,
  hint,
}: {
  label: string;
  display: React.ReactNode;
  editor?: Editor;
  onSave?: (value: string) => void;
  readOnly?: boolean;
  /** small grey line under the value (e.g. why a field is locked) */
  hint?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null);

  const start = () => {
    if (readOnly || !editor) return;
    setDraft(initialDraft(editor));
    setError(null);
    setEditing(true);
  };
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = (value = draft) => {
    if (!editor || !onSave) {
      setEditing(false);
      return;
    }
    if (value === initialDraft(editor)) {
      setEditing(false);
      setError(null);
      return;
    }
    const v = validate(editor, value);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setEditing(false);
    setError(null);
    onSave(v.value);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
    if (e.key === "Enter" && editor?.kind !== "textarea") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Enter" && editor?.kind === "textarea" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  const inputCls = cn("w-full rounded border bg-sg-bg px-2 py-1 text-sm text-sg-white focus:outline-none", error ? "border-soft-red/70" : "border-sg-white/50");
  const preview =
    editing && editor && !error
      ? editor.kind === "money"
        ? (() => {
            const n = parseIDR(draft);
            return n !== null ? formatIDR(n, "full") : null;
          })()
        : editor.kind === "datetime"
          ? (() => {
              const iso = fromDateTimeInput(draft);
              return iso ? `${formatDate(iso, "datetime")} WIB` : null;
            })()
          : null
      : null;

  return (
    <div className="group py-1.5">
      <div className="text-2xs font-semibold uppercase tracking-[0.1em] text-sg-dim">{label}</div>
      {editing && editor ? (
        <div className="mt-0.5">
          {editor.kind === "select" ? (
            <select ref={ref} value={draft} onChange={(e) => commit(e.target.value)} onBlur={cancel} onKeyDown={onKeyDown} aria-label={label} className={cn(inputCls, "[&>option]:bg-sg-card")}>
              {editor.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : editor.kind === "textarea" ? (
            <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()} onKeyDown={onKeyDown} rows={3} aria-label={label} className={inputCls} />
          ) : (
            <input
              ref={ref}
              type={editor.kind === "date" ? "date" : editor.kind === "datetime" ? "datetime-local" : editor.kind === "email" ? "email" : "text"}
              inputMode={editor.kind === "number" ? "numeric" : editor.kind === "money" ? "decimal" : undefined}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onBlur={() => commit()}
              onKeyDown={onKeyDown}
              aria-label={label}
              aria-invalid={!!error}
              className={inputCls}
            />
          )}
          {error ? (
            <p role="alert" className="mt-1 text-2xs text-soft-red">
              {error} · Esc to cancel
            </p>
          ) : preview ? (
            <p className="mt-1 text-2xs text-sg-dim">{preview}</p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={readOnly || !editor}
          aria-label={!readOnly && editor ? `Edit ${label}` : undefined}
          className={cn("mt-0.5 flex w-full items-start gap-2 rounded px-1 py-0.5 -mx-1 text-left text-sm text-sg-text", !readOnly && editor && "hover:bg-sg-card-2 focus:bg-sg-card-2 focus:outline-none")}
        >
          <span className="min-w-0 flex-1 break-words">{display ?? <span className="text-sg-dim">—</span>}</span>
          {!readOnly && editor && <Pencil className="mt-0.5 size-3 shrink-0 text-sg-dim opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" />}
        </button>
      )}
      {hint && !editing ? <div className="mt-0.5 text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}
