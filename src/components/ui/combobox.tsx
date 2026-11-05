"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { tokenFilter } from "@/lib/search";
import { cn } from "@/lib/utils";
import { fieldClass, useFieldControl } from "./input";

export interface ComboboxOption {
  value: string;
  label: string;
  /** secondary text (title · team) — searchable */
  detail?: string;
  /** extra search terms */
  keywords?: string[];
  /** leading visual (avatar, dot) */
  icon?: React.ReactNode;
  /** trailing visual (eligibility badge, count) */
  badge?: React.ReactNode;
  disabled?: boolean;
  /** shown under the option when disabled, e.g. why someone can't be picked */
  disabledReason?: string;
}

/**
 * Searchable single select: a field-styled button that opens a filterable list (type to filter by label, detail or
 * keywords; ↑↓ Enter; Esc closes). Use for person / record pickers with more than a handful of options.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Type to filter…",
  emptyText = "No matches",
  allowClear,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const a11y = useFieldControl({ id, "aria-describedby": ariaDescribedBy });
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value) ?? null;
  const listId = React.useId();

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <span className={cn("relative block", className)}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={a11y.id}
            aria-label={ariaLabel}
            aria-describedby={a11y["aria-describedby"]}
            aria-invalid={a11y["aria-invalid"]}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            className={cn(fieldClass, "flex h-8 items-center gap-2 pr-7 text-left", allowClear && selected && "pr-12")}
          >
            {selected?.icon ? <span className="shrink-0">{selected.icon}</span> : null}
            <span className={cn("min-w-0 flex-1 truncate", !selected && "text-sg-dim")}>{selected ? selected.label : placeholder}</span>
            {selected?.detail ? <span className="hidden max-w-[45%] truncate text-2xs text-sg-dim sm:inline">{selected.detail}</span> : null}
          </button>
        </PopoverPrimitive.Trigger>
        {allowClear && selected && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${selected.label}`}
            onClick={() => onChange(null)}
            className="absolute right-6 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sg-dim hover:bg-sg-card-3 hover:text-sg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sg-white/60"
          >
            <X className="size-3" />
          </button>
        ) : null}
        <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-sg-muted" />
      </span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-[60] w-[max(var(--radix-popover-trigger-width),260px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-sg-line bg-sg-card-2 shadow-pop focus:outline-none"
        >
          <Command loop filter={tokenFilter} label={ariaLabel ?? placeholder}>
            <div className="flex items-center gap-2 border-b border-sg-line px-2.5">
              <Search aria-hidden className="size-3.5 shrink-0 text-sg-dim" />
              <Command.Input autoFocus placeholder={searchPlaceholder} className="h-9 flex-1 bg-transparent text-sm text-sg-white placeholder:text-sg-dim focus:outline-none" />
            </div>
            <Command.List id={listId} className="max-h-[min(320px,var(--radix-popover-content-available-height))] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-xs text-sg-muted">{emptyText}</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  keywords={[o.detail ?? "", ...(o.keywords ?? [])]}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm text-sg-text aria-selected:bg-sg-card-3 aria-selected:text-sg-white data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
                >
                  {o.icon ? <span className="shrink-0">{o.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.detail || (o.disabled && o.disabledReason) ? <span className="block truncate text-2xs text-sg-dim">{o.disabled && o.disabledReason ? o.disabledReason : o.detail}</span> : null}
                  </span>
                  {o.badge ? <span className="shrink-0">{o.badge}</span> : null}
                  {o.value === value ? <Check className="size-3.5 shrink-0 text-sg-white" aria-label="Selected" /> : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
