"use client";

/* Annex B reminder (§3.1, §15.1): short BCC drafts in batches of 10 (mailto length limit) plus copy-to-clipboard. */
import { useMemo, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { REMINDER_BATCH, REMINDER_SUBJECT, logAnnexBReminder, reminderBatches, reminderBody, reminderHref } from "./annex-b";

export function AnnexBReminderModal({ recipients, onClose }: { recipients: User[]; onClose: () => void }) {
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const addActivity = useCrm((s) => s.addActivity);
  const notify = useUi((s) => s.notify);
  const sender = users.find((u) => u.id === currentUserId)?.name ?? "HR";
  const batches = useMemo(() => reminderBatches(recipients), [recipients]);
  const [opened, setOpened] = useState<number[]>([]);
  const [logged, setLogged] = useState(false);
  const withEmail = batches.flat();

  const log = (how: string) => {
    if (logged) return;
    logAnnexBReminder(withEmail, sender, addActivity, how);
    setLogged(true);
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied`);
      log("copied the addresses and the reminder");
    } catch {
      notify("Copy failed — select the text manually");
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Annex B reminder"
      description={`${withEmail.length} recipient${withEmail.length === 1 ? "" : "s"} · drafts of up to ${REMINDER_BATCH} addresses in BCC so mail clients open them reliably`}
      className="w-[min(600px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-2xs text-sg-dim">{logged ? "Logged as an activity note" : "Sending is logged once as an activity note"}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ul className="divide-y divide-sg-line rounded-lg border border-sg-line">
          {batches.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 text-sg-muted">
                <span className="font-semibold text-sg-white">
                  Batch {i + 1} of {batches.length}
                </span>{" "}
                · {b.map((r) => r.name).join(", ")}
              </span>
              <a
                href={reminderHref(b)}
                onClick={() => {
                  setOpened((x) => (x.includes(i) ? x : [...x, i]));
                  log("drafted the reminder (BCC, in batches)");
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-sg-line-2 px-2.5 text-xs font-semibold text-sg-text hover:border-sg-white hover:text-sg-white"
              >
                <Mail className="size-3.5" /> {opened.includes(i) ? "Opened" : "Open draft"}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!withEmail.length} onClick={() => copy(withEmail.map((r) => r.email.trim()).join("; "), "Addresses")}>
            <Copy /> Copy all addresses
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(`${REMINDER_SUBJECT}\n\n${reminderBody(sender)}`, "Full reminder text")}>
            <Copy /> Copy the full message
          </Button>
        </div>
        <p className="text-2xs text-sg-dim">The drafts carry a short message with the signing link; paste the full message from the clipboard if you prefer the long version.</p>
      </div>
    </Modal>
  );
}
