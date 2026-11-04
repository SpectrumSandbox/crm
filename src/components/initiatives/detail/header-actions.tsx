"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Pencil, Printer, Send, Sparkles, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { Initiative } from "@/lib/initiatives/types";
import { approvalTier, proposalGaps } from "@/lib/initiatives/engine";
import { TIER_META } from "@/lib/initiatives/policy";
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
  const tier = TIER_META[approvalTier(ini).tier];
  const packet = (
    <Link href={`/initiatives/${encodeURIComponent(ini.id)}/print`} className={buttonVariants({ variant: "outline", size: "md" })} title="Printable PRC packet — Annex A proposal and Annex D Role and Weight Agreement">
      <Printer /> PRC packet
    </Link>
  );

  if (ini.status === "draft") {
    return (
      <>
        {packet}
        <Link href={`/initiatives/new?edit=${encodeURIComponent(ini.id)}`} className={buttonVariants({ variant: "outline", size: "md" })}>
          <Pencil /> Edit proposal
        </Link>
        {gaps.length === 0 ? (
          <Button
            variant="primary"
            onClick={() => {
              submitInitiative(ini.id);
              notify(`Submitted to the PRC — acknowledgment within 1 business day; ${tier.label} decides within ${tier.decisionBusinessDays}`);
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
                Proposal incomplete <Cite s="4.3" />
              </div>
              <p className="mt-1 text-xs text-sg-muted">The PMO returns incomplete proposals with a list of what is missing. Fill these in before submitting:</p>
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
      <>
        {packet}
        <Button
        variant="primary"
        onClick={() => {
          activateInitiative(ini.id);
          notify(`${ini.code ?? ini.title} is now active`);
        }}
      >
        <Sparkles /> Kick off project
        </Button>
      </>
    );
  }

  if (ini.status === "active") {
    return (
      <>
        {packet}
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
              A project closes when all deliverables are accepted, the final invoice is paid or written off and final costs are booked; the Project Lead submits the close-out report (Annex G). Within <strong className="text-sg-white">30 days</strong> Finance recalculates the total pool on final figures: a higher pool is paid with the next salary, an overpayment comes first from deferred and carried-forward amounts <Cite s="8.3" />.
            </p>
            <p className="text-xs text-sg-muted">Deferred amounts vest {ini.deferralMonths || 6} months after close (§9.3); a final invoice collected later still earns a late-collection bonus for eligible members (§8.3) — record it on the Payments tab.</p>
          </div>
        </Modal>
      </>
    );
  }

  return packet;
}
