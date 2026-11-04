"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Pencil, Send, Sparkles, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Initiative } from "@/lib/initiatives/types";
import { proposalGaps } from "@/lib/initiatives/engine";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Cite } from "@/components/initiatives/shared";

/** Status-dependent primary actions in the page header. */
export function HeaderActions({ ini }: { ini: Initiative }) {
  const members = useCrm((s) => s.initiativeMembers);
  const submitInitiative = useCrm((s) => s.submitInitiative);
  const deleteDraft = useCrm((s) => s.deleteDraft);
  const activateInitiative = useCrm((s) => s.activateInitiative);
  const completeInitiative = useCrm((s) => s.completeInitiative);
  const notify = useUi((s) => s.notify);
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const gaps = useMemo(() => proposalGaps(ini, members), [ini, members]);

  if (ini.status === "draft") {
    return (
      <>
        <Link href={`/initiatives/new?edit=${encodeURIComponent(ini.id)}`} className={buttonVariants({ variant: "outline", size: "md" })}>
          <Pencil /> Edit proposal
        </Link>
        {gaps.length === 0 ? (
          <Button
            variant="primary"
            onClick={() => {
              submitInitiative(ini.id);
              notify("Submitted to the PRC — acknowledgment due within 1 business day");
            }}
          >
            <Send /> Submit to PRC
          </Button>
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="subtle" className="text-soft-yellow">
                <CircleAlert /> Submit to PRC · {gaps.length} gap{gaps.length === 1 ? "" : "s"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <div className="flex items-center font-display text-sm font-extrabold text-sg-white">
                Proposal incomplete <Cite s="2.2" />
              </div>
              <p className="mt-1 text-xs text-sg-muted">The PRC only accepts complete proposals. Fill these in before submitting:</p>
              <ul className="mt-2 space-y-1">
                {gaps.map((g) => (
                  <li key={g} className="flex items-start gap-1.5 text-xs text-sg-text">
                    <CircleAlert className="mt-0.5 size-3 shrink-0 text-soft-yellow" /> {g}
                  </li>
                ))}
              </ul>
              <Link href={`/initiatives/new?edit=${encodeURIComponent(ini.id)}`} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-3 w-full")}>
                <Pencil /> Complete the proposal
              </Link>
            </PopoverContent>
          </Popover>
        )}
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete draft
        </Button>
        <Modal
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this draft?"
          description="The proposal and its proposed team are removed. This cannot be undone."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteDraft(ini.id);
                  setConfirmDelete(false);
                  notify("Draft deleted");
                  router.push("/initiatives");
                }}
              >
                <Trash2 /> Delete draft
              </Button>
            </>
          }
        >
          <p className="text-sm text-sg-text">“{ini.title}” has not been submitted, so no PRC record exists yet.</p>
        </Modal>
      </>
    );
  }

  if (ini.status === "approved") {
    return (
      <Button
        variant="primary"
        onClick={() => {
          activateInitiative(ini.id);
          notify(`${ini.code ?? ini.title} is now active`);
        }}
      >
        <Sparkles /> Kick off project
      </Button>
    );
  }

  if (ini.status === "active") {
    return (
      <>
        <Button variant="primary" onClick={() => setConfirmComplete(true)}>
          <CircleCheck /> Mark completed
        </Button>
        <Modal
          open={confirmComplete}
          onOpenChange={setConfirmComplete}
          title="Mark project completed?"
          description={`${ini.code ?? ini.trackingNo} · ${ini.title}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmComplete(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  completeInitiative(ini.id);
                  setConfirmComplete(false);
                  notify("Project completed — final reconciliation due within 30 days");
                }}
              >
                <CircleCheck /> Mark completed
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-sg-text">
            <p>
              Finance performs a <strong className="text-sg-white">final reconciliation within 30 days</strong> of completion: actual revenue and direct costs are compared with the monthly entries and any difference is settled in the
              next bonus run <Cite s="4.4" />.
            </p>
            <p className="text-xs text-sg-muted">Revenue recognised after completion (e.g. retention or final milestone payments) can still be recorded on the Financials tab.</p>
          </div>
        </Modal>
      </>
    );
  }

  return null;
}
