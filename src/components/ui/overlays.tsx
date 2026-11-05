"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────── Modal dialog ───────────── */

const MODAL_WIDTH = {
  sm: "w-[min(420px,calc(100vw-32px))]",
  md: "w-[min(560px,calc(100vw-32px))]",
  lg: "w-[min(720px,calc(100vw-32px))]",
  xl: "w-[min(920px,calc(100vw-32px))]",
} as const;

/**
 * Dialog. Centred with inset-x-0 + mx-auto (no translate, so the enter animation can't push it sideways); bounded by the
 * dynamic viewport with the header and footer always visible and the body scrolling; a bottom sheet on phones.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: keyof typeof MODAL_WIDTH;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] flex-col overflow-hidden rounded-t-xl border border-sg-line bg-sg-card pb-[env(safe-area-inset-bottom)] shadow-pop",
            "sm:bottom-auto sm:top-[10vh] sm:max-h-[80dvh] sm:rounded-xl sm:pb-0",
            MODAL_WIDTH[size],
            className,
            // phones: always a full-width bottom sheet, whatever width the caller asked for
            "max-sm:w-full max-sm:max-w-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95",
          )}
        >
          <div className="sg-spectrum-rule h-[2px] shrink-0" />
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-sg-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-lg font-bold text-sg-white">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-xs text-sg-muted">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded text-sg-dim hover:bg-sg-card-2 hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-sg-line bg-sg-bg/40 px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ───────────── Right-side sheet (slide-over drawer) ───────────── */

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = "w-[min(760px,100vw)]",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by screen readers when the sheet opens (aria-describedby). Omit when the title says it all. */
  description?: string;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-sg-line bg-sg-card shadow-drawer focus:outline-none",
            "data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
            width,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description> : null}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const SheetClose = DialogPrimitive.Close;

/* ───────────── Dropdown menu ───────────── */

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuContent({ children, align = "start", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={4}
        className={cn("z-[60] max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[180px] overflow-y-auto rounded-lg border border-sg-line bg-sg-card-2 p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0", className)}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({ children, onSelect, active, className, destructive }: { children: React.ReactNode; onSelect?: () => void; active?: boolean; className?: string; destructive?: boolean }) {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm text-sg-text outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sg-white/50 data-[highlighted]:bg-sg-card-3 data-[highlighted]:text-sg-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        destructive && "text-soft-red data-[highlighted]:text-soft-red",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {active ? <Check className="size-3.5 text-sg-white" aria-label="Selected" /> : null}
    </DropdownPrimitive.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DropdownPrimitive.Label className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">{children}</DropdownPrimitive.Label>;
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-sg-line" />;
}

/* ───────────── Popover ───────────── */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ children, className, align = "start" }: { children: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={4} className={cn("z-[60] rounded-lg border border-sg-line bg-sg-card-2 p-3 shadow-pop focus:outline-none", className)}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/* ───────────── Tabs (controlled, lightweight) ───────────── */

const tabDomId = (base: string, value: string, part: "tab" | "panel") => `${base}-${part}-${value.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * WAI-ARIA tabs: roving tabindex, ←/→ (wrapping), Home/End move focus and select.
 * Pass `id` and render the matching <TabPanel tabsId={id} value=…> to wire aria-controls / aria-labelledby.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const auto = React.useId();
  const base = id ?? auto.replace(/:/g, "");
  const [refs] = React.useState(() => new Map<string, HTMLButtonElement>());
  const hasSelected = items.some((it) => it.value === value);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!items.length) return;
    const at = Math.max(0, items.findIndex((it) => it.value === value));
    let next = -1;
    if (e.key === "ArrowRight") next = (at + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = items[next];
    onChange(target.value);
    refs.get(target.value)?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" onKeyDown={onKeyDown} className={cn("flex items-center gap-1 overflow-x-auto border-b border-sg-line", className)}>
      {items.map((it, i) => {
        const active = it.value === value;
        const focusable = active || (!hasSelected && i === 0);
        return (
          <button
            key={it.value}
            ref={(el) => {
              if (el) refs.set(it.value, el);
              else refs.delete(it.value);
            }}
            id={tabDomId(base, it.value, "tab")}
            role="tab"
            aria-selected={active}
            aria-controls={id ? tabDomId(base, it.value, "panel") : undefined}
            tabIndex={focusable ? 0 : -1}
            type="button"
            onClick={() => onChange(it.value)}
            className={cn(
              "relative -mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sg-white/60",
              active ? "border-sg-white text-sg-white" : "border-transparent text-sg-muted hover:text-sg-white",
            )}
          >
            {it.label}
            {typeof it.count === "number" ? <span className="rounded-sm bg-sg-card-3 px-1 text-[10px] text-sg-muted">{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Panel for <Tabs id=…>: render the active one (or all, hiding the inactive ones). */
export function TabPanel({ tabsId, value, children, className, hidden }: { tabsId: string; value: string; children: React.ReactNode; className?: string; hidden?: boolean }) {
  return (
    <div role="tabpanel" id={tabDomId(tabsId, value, "panel")} aria-labelledby={tabDomId(tabsId, value, "tab")} tabIndex={0} hidden={hidden} className={cn("focus-visible:outline-none", className)}>
      {children}
    </div>
  );
}
