"use client";

import * as React from "react";
import { create } from "zustand";
import { Button } from "./button";
import { Input } from "./input";
import { Modal } from "./overlays";

/*
 * Confirmation dialog with a promise API, mounted once by the app shell:
 *   if (await confirm({ title: "Delete this payment?", body: "…", confirmLabel: "Delete", tone: "danger" })) remove();
 * Prefer an Undo toast for reversible actions; use confirm() when the action can't be undone or affects other people.
 */

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** the person must type this text (e.g. a project code) before confirming */
  requireText?: string;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ pending: Pending | null; set: (p: Pending | null) => void }>()((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}));

/** Ask the person to confirm. Resolves true on confirm, false on cancel / Esc / close. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = useConfirmStore.getState().pending;
    prev?.resolve(false);
    useConfirmStore.getState().set({ ...options, resolve });
  });
}

/** Hook form of confirm() for components that prefer it. */
export function useConfirm() {
  return confirm;
}

export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const setPending = useConfirmStore((s) => s.set);
  const [typed, setTyped] = React.useState("");
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    setTyped("");
    if (!pending) return;
    // destructive: start on Cancel so Enter doesn't destroy by accident
    const t = window.setTimeout(() => (pending.tone === "danger" ? cancelRef : confirmRef).current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [pending]);

  if (!pending) return null;
  const done = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };
  const blocked = !!pending.requireText && typed.trim() !== pending.requireText;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && done(false)}
      title={pending.title}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={() => done(false)}>
            {pending.cancelLabel ?? "Cancel"}
          </Button>
          <Button ref={confirmRef} variant={pending.tone === "danger" ? "danger" : "primary"} size="sm" disabled={blocked} onClick={() => done(true)}>
            {pending.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) done(true);
        }}
        className="space-y-3 text-sm text-sg-muted"
      >
        {pending.body ? <div>{pending.body}</div> : null}
        {pending.requireText ? (
          <label className="block">
            <span className="mb-1 block text-xs">
              Type <span className="font-semibold text-sg-white">{pending.requireText}</span> to confirm
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
