"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn, fromDateInput, toDateInput } from "@/lib/utils";

type Editor =
  | { kind: "text"; value: string }
  | { kind: "email"; value: string }
  | { kind: "textarea"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string }
  | { kind: "select"; value: string; options: { value: string; label: string }[] };

/**
 * HubSpot-style inline property: label over value; click (or Enter when focused) to edit,
 * Enter / blur saves, Esc cancels.
 */
export function EditableProperty({
  label,
  display,
  editor,
  onSave,
  readOnly,
}: {
  label: string;
  display: React.ReactNode;
  editor?: Editor;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null);

  const start = () => {
    if (readOnly || !editor) return;
    setDraft(editor.kind === "date" ? toDateInput(editor.value) : String(editor.value ?? ""));
    setEditing(true);
  };
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = (value = draft) => {
    setEditing(false);
    if (!editor || !onSave) return;
    const original = editor.kind === "date" ? toDateInput(editor.value) : String(editor.value ?? "");
    if (value === original) return;
    if (editor.kind === "date") {
      if (value) onSave(fromDateInput(value));
      return;
    }
    if (editor.kind === "number") {
      const n = Number(value.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(n)) onSave(String(n));
      return;
    }
    onSave(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setEditing(false);
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

  const inputCls = "w-full rounded border border-sg-white/50 bg-sg-bg px-2 py-1 text-sm text-sg-white focus:outline-none";

  return (
    <div className="group py-1.5">
      <div className="text-2xs font-semibold uppercase tracking-[0.1em] text-sg-dim">{label}</div>
      {editing && editor ? (
        <div className="mt-0.5">
          {editor.kind === "select" ? (
            <select
              ref={ref}
              value={draft}
              onChange={(e) => commit(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={onKeyDown}
              className={cn(inputCls, "[&>option]:bg-sg-card")}
            >
              {editor.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : editor.kind === "textarea" ? (
            <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()} onKeyDown={onKeyDown} rows={3} className={inputCls} />
          ) : (
            <input
              ref={ref}
              type={editor.kind === "date" ? "date" : editor.kind === "email" ? "email" : "text"}
              inputMode={editor.kind === "number" ? "numeric" : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit()}
              onKeyDown={onKeyDown}
              className={inputCls}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={readOnly || !editor}
          className={cn(
            "mt-0.5 flex w-full items-start gap-2 rounded px-1 py-0.5 -mx-1 text-left text-sm text-sg-text",
            !readOnly && editor && "hover:bg-sg-card-2 focus:bg-sg-card-2 focus:outline-none",
          )}
        >
          <span className="min-w-0 flex-1 break-words">{display ?? <span className="text-sg-dim">—</span>}</span>
          {!readOnly && editor && <Pencil className="mt-0.5 size-3 shrink-0 text-sg-dim opacity-0 group-hover:opacity-100" />}
        </button>
      )}
    </div>
  );
}
