"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Columns3, Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CSV_FORMATS, downloadCsv, getCsvFormat, setCsvFormat, type CsvColumn, type CsvFormat } from "@/lib/csv";
import { Kbd } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  className?: string;
  /** set false to keep a column always visible (the first column is always kept) */
  hideable?: boolean;
}

const colsKey = (tableId: string) => `sg-table-cols:${tableId}`;

function readHidden(tableId: string | undefined): string[] {
  if (!tableId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(colsKey(tableId));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeHidden(tableId: string | undefined, hidden: string[]) {
  if (!tableId) return;
  try {
    if (hidden.length) window.localStorage.setItem(colsKey(tableId), JSON.stringify(hidden));
    else window.localStorage.removeItem(colsKey(tableId));
  } catch {
    /* storage unavailable (private mode) — visibility still works for this session */
  }
}

/**
 * Dense, keyboard-first record table:
 *  j / k (or ↑ ↓) move the cursor, Enter opens, x toggles selection, / focuses the filter.
 * Pass `tableId` to persist column visibility per table, and `exportCsv` to offer an
 * "Export CSV" of exactly the rows in view (filters + search + sort applied).
 * The selection only ever holds rows that are in view: changing a filter, list or search drops the others,
 * so a bulk action can never touch records the user cannot see.
 * Pass `query` + `onQueryChange` to control the search box (e.g. to keep it in the URL).
 */
export function SmartTable<T extends { id: string }>({
  rows,
  columns,
  hrefFor,
  searchText,
  initialSort,
  toolbar,
  bulkActions,
  emptyText = "No records match these filters.",
  tableId,
  exportCsv,
  query,
  onQueryChange,
}: {
  rows: T[];
  columns: Column<T>[];
  hrefFor: (row: T) => string;
  searchText: (row: T) => string;
  initialSort?: { id: string; dir: 1 | -1 };
  toolbar?: React.ReactNode;
  bulkActions?: (selected: string[], clear: () => void) => React.ReactNode;
  emptyText?: string;
  /** stable id used to persist column visibility in localStorage */
  tableId?: string;
  exportCsv?: { filename: string | (() => string); columns: CsvColumn<T>[] };
  /** controlled search text */
  query?: string;
  onQueryChange?: (q: string) => void;
}) {
  const router = useRouter();
  const [localQ, setLocalQ] = useState("");
  const q = query ?? localQ;
  const setQ = (v: string) => {
    if (onQueryChange) onQueryChange(v);
    if (query === undefined) setLocalQ(v);
  };
  const [sort, setSort] = useState(initialSort ?? { id: columns[0].id, dir: 1 as 1 | -1 });
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [hidden, setHidden] = useState<string[]>(() => readHidden(tableId));
  useEffect(() => setHidden(readHidden(tableId)), [tableId]);
  const shownColumns = useMemo(() => columns.filter((c, i) => i === 0 || c.hideable === false || !hidden.includes(c.id)), [columns, hidden]);
  const toggleColumn = (id: string) =>
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      writeHidden(tableId, next);
      return next;
    });

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => searchText(r).toLowerCase().includes(needle)) : rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return filtered;
    const sv = col.sortValue;
    return [...filtered].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      return x > y ? sort.dir : x < y ? -sort.dir : 0;
    });
  }, [rows, q, sort, columns, searchText]);

  /* membership of the view (order-insensitive): when it changes, drop selected rows that left it */
  const membership = useMemo(() => visible.map((r) => r.id).sort().join("|"), [visible]);
  useEffect(() => {
    const inView = new Set(membership ? membership.split("|") : []);
    setSelected((s) => {
      if (!s.size) return s;
      const next = new Set(Array.from(s).filter((id) => inView.has(id)));
      return next.size === s.size ? s : next;
    });
    setCursor((c) => Math.min(c, Math.max(0, inView.size - 1)));
  }, [membership]);

  const [csvFormat, setFormat] = useState<CsvFormat>("comma");
  useEffect(() => setFormat(getCsvFormat()), []);
  const exportAs = (format: CsvFormat) => {
    if (!exportCsv) return;
    setCsvFormat(format);
    setFormat(format);
    downloadCsv(typeof exportCsv.filename === "function" ? exportCsv.filename() : exportCsv.filename, visible, exportCsv.columns, format);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) {
        if (e.key === "Escape") el.blur();
        if (e.key === "ArrowDown" && el.dataset.pageFilter !== undefined) {
          e.preventDefault();
          el.blur();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog],[role=menu]")) return;
      // Enter / x on a focused in-cell control (owner menu, link) belongs to that control, not the row
      if ((e.key === "Enter" || e.key === "x") && el.closest("button,a,label")) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(visible.length - 1, c + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter" && visible[cursor]) {
        e.preventDefault();
        router.push(hrefFor(visible[cursor]));
      } else if (e.key === "x" && visible[cursor]) {
        e.preventDefault();
        toggle(visible[cursor].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-sg-line px-5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <input data-page-filter value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this view" className="h-8 w-60 rounded border border-sg-line bg-sg-bg/60 pl-7 pr-8 text-sm text-sg-text placeholder:text-sg-dim focus:border-sg-white/60 focus:outline-none" />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">/</Kbd>
        </div>
        {toolbar}
        <div className="ml-auto flex items-center gap-2 text-2xs text-sg-dim">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Choose columns">
                <Columns3 /> Columns
                {hidden.some((h) => columns.some((c, i) => i > 0 && c.hideable !== false && c.id === h)) ? <span className="rounded-sm bg-sg-card-3 px-1 text-[10px] text-sg-muted">{shownColumns.length}/{columns.length}</span> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1.5">
              <div className="sg-eyebrow px-1.5 pb-1 pt-1">Visible columns</div>
              {columns.map((c, i) => {
                const locked = i === 0 || c.hideable === false;
                const on = locked || !hidden.includes(c.id);
                return (
                  <label key={c.id} className={cn("flex items-center gap-2 rounded px-1.5 py-1 text-sm", locked ? "text-sg-dim" : "cursor-pointer text-sg-text hover:bg-sg-card-3 hover:text-sg-white")}>
                    <input type="checkbox" checked={on} disabled={locked} onChange={() => toggleColumn(c.id)} className="size-3.5 accent-white" />
                    {c.header}
                    {locked ? <span className="ml-auto text-[10px] uppercase tracking-wider">always</span> : null}
                  </label>
                );
              })}
              {hidden.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setHidden([]);
                    writeHidden(tableId, []);
                  }}
                  className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-sg-muted hover:bg-sg-card-3 hover:text-sg-white"
                >
                  Show all columns
                </button>
              )}
            </PopoverContent>
          </Popover>
          {exportCsv && <CsvExportMenu count={visible.length} format={csvFormat} onExport={exportAs} />}
          <span className="hidden items-center gap-1 lg:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>X</Kbd> select
          </span>
          <span className="sg-num font-semibold text-sg-muted">
            {visible.length} of {rows.length}
          </span>
        </div>
      </div>

      {selected.size > 0 && bulkActions && (
        <div className="flex items-center gap-3 border-b border-sg-line bg-sg-card-2 px-5 py-2 text-sm">
          <span className="font-semibold text-sg-white">{selected.size} selected</span>
          {bulkActions(Array.from(selected), () => setSelected(new Set()))}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-sg-dim hover:text-sg-white">
            Clear
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-sg-bg">
            <tr className="text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
              <th className="w-10 border-b border-sg-line py-2 pl-5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.id)))}
                  className="size-3.5 cursor-pointer accent-white"
                />
              </th>
              {shownColumns.map((c) => (
                <th key={c.id} className={cn("whitespace-nowrap border-b border-sg-line px-3 py-2 font-semibold", c.align === "right" && "text-right", c.className)}>
                  {c.sortValue ? (
                    <button type="button" className={cn("inline-flex items-center gap-1 hover:text-sg-white", sort.id === c.id && "text-sg-white")} onClick={() => setSort((s) => ({ id: c.id, dir: s.id === c.id ? ((-s.dir) as 1 | -1) : 1 }))}>
                      {c.header}
                      {sort.id === c.id ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {visible.map((row, i) => (
              <tr
                key={row.id}
                data-row={i}
                onMouseEnter={() => setCursor(i)}
                onClick={(e) => {
                  // clicks inside portalled menus/popovers bubble through React — ignore anything outside the row's DOM
                  if (!e.currentTarget.contains(e.target as Node)) return;
                  if ((e.target as HTMLElement).closest("a,button,input,select,label")) return;
                  router.push(hrefFor(row));
                }}
                className={cn("cursor-pointer", i === cursor ? "bg-sg-card-2" : "hover:bg-sg-card", selected.has(row.id) && "bg-soft-blue/10")}
              >
                <td className={cn("border-b border-sg-line py-2 pl-5", i === cursor && "shadow-[inset_2px_0_0_rgb(var(--sg-white))]")}>
                  <input type="checkbox" aria-label="Select row" checked={selected.has(row.id)} onChange={() => toggle(row.id)} className="size-3.5 cursor-pointer accent-white" />
                </td>
                {shownColumns.map((c) => (
                  <td key={c.id} className={cn("border-b border-sg-line px-3 py-2 align-middle", c.align === "right" && "text-right", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="px-5 py-12 text-center text-sm text-sg-muted">{emptyText}</p>}
      </div>
    </div>
  );
}

/** "Export CSV" with a choice of dialect (comma, or semicolon for Excel on Indonesian-locale Windows); remembers the last one */
export function CsvExportMenu({ count, format, onExport, size = "sm", variant = "ghost" }: { count: number; format: CsvFormat; onExport: (format: CsvFormat) => void; size?: "sm" | "md"; variant?: "ghost" | "outline" }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant={variant} size={size} disabled={!count} title={`Export the ${count} rows in view`}>
          <Download /> Export CSV
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Export {count} rows as</MenuLabel>
        {CSV_FORMATS.map((f) => (
          <MenuItem key={f.id} active={f.id === format} onSelect={() => onExport(f.id)}>
            <span className="flex flex-col">
              <span>{f.label}</span>
              <span className="text-2xs text-sg-dim">{f.hint}</span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
