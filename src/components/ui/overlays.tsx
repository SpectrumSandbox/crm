"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────── Modal dialog ───────────── */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-sg-line bg-sg-card shadow-pop",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            className,
          )}
        >
          <div className="sg-spectrum-rule h-[2px]" />
          <div className="flex items-start justify-between gap-4 border-b border-sg-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="font-display text-lg font-bold text-sg-white">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-xs text-sg-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded p-1 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[62vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-sg-line bg-sg-bg/40 px-5 py-3">{footer}</div> : null}
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
  children,
  width = "w-[min(760px,100vw)]",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-sg-line bg-sg-card shadow-drawer focus:outline-none",
            "data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
            width,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
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
        "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm text-sg-text outline-none data-[highlighted]:bg-sg-card-3 data-[highlighted]:text-sg-white",
        destructive && "text-soft-red data-[highlighted]:text-soft-red",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {active ? <Check className="size-3.5 text-sg-white" /> : null}
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

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-1 overflow-x-auto border-b border-sg-line", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(it.value)}
            className={cn(
              "relative -mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold transition-colors",
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
