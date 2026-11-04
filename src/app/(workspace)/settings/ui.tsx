"use client";

/* Small building blocks shared by the Settings sections. */
import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";

export function Section({
  id,
  title,
  icon: Icon,
  subtitle,
  actions,
  children,
}: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-sg-line bg-sg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <Icon className="size-4 text-sg-muted" />
        <h2 className="font-display text-sm font-extrabold text-sg-white">{title}</h2>
        {subtitle ? <span className="text-2xs text-sg-dim">{subtitle}</span> : null}
        {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "yellow" | "orange" | "red" }) {
  return (
    <div className="min-w-0">
      <div className="sg-eyebrow">{label}</div>
      <div
        className={cn(
          "sg-num mt-0.5 truncate font-display text-base font-extrabold",
          tone === "green" ? "text-soft-green" : tone === "yellow" ? "text-soft-yellow" : tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : "text-sg-white",
        )}
      >
        {value}
      </div>
      {hint ? <div className="truncate text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

const calloutTone = {
  info: { box: "border-sg-line bg-sg-card-2/60 text-sg-muted", icon: Info },
  warn: { box: "border-soft-yellow/30 bg-soft-yellow/10 text-soft-yellow", icon: TriangleAlert },
  danger: { box: "border-soft-red/30 bg-soft-red/10 text-soft-red", icon: CircleAlert },
  ok: { box: "border-soft-green/30 bg-soft-green/10 text-soft-green", icon: CircleCheck },
} as const;

export function Callout({ tone = "info", children, className }: { tone?: keyof typeof calloutTone; children: React.ReactNode; className?: string }) {
  const t = calloutTone[tone];
  const Icon = t.icon;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed", t.box, className)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

/** Confirmation dialog; `onConfirm` may be async — the button shows progress until it settles. */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const runRef = useRef<() => Promise<void>>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  runRef.current = run;
  // ⌘/Ctrl+Enter confirms
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void runRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} size="sm" onClick={() => void run()} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-sg-text">
        {children}
      </div>
    </Modal>
  );
}
