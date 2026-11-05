"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/overlays";

const LABELS = ["", "Very unhappy", "Unhappy", "Neutral", "Happy", "Very happy"];

/** Optional customer-satisfaction capture when a ticket is resolved (usually relayed from WhatsApp or a call). */
export function CsatDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const ticket = useCrm((s) => s.tickets.find((t) => t.id === ticketId));
  const rateTicket = useCrm((s) => s.rateTicket);
  const notify = useUi((s) => s.notify);
  const [score, setScore] = useState<number | null>(ticket?.csat ?? null);
  const [comment, setComment] = useState(ticket?.csatComment ?? "");
  if (!ticket) return null;

  const save = () => {
    if (score === null) return;
    const prev = { csat: ticket.csat ?? null, comment: ticket.csatComment ?? "" };
    rateTicket(ticketId, score, comment);
    notify(`CSAT ${score}/5 recorded on ${ticketId.toUpperCase()}`, { label: "Undo", run: () => rateTicket(ticketId, prev.csat, prev.comment) });
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`How did the customer rate ${ticketId.toUpperCase()}?`}
      description="Optional. The rating feeds the account's CSAT on the companies list and the tickets dashboard."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <Button variant="primary" disabled={score === null} onClick={save}>
            Save rating
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-sg-text">{ticket.subject}</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Customer satisfaction, 1 to 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              onClick={() => setScore(n)}
              className={cn("flex h-14 w-16 flex-col items-center justify-center rounded-lg border text-2xs", score === n ? "border-sg-white bg-sg-card-2 text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
            >
              <span className="flex items-center gap-0.5 font-display text-base font-extrabold">
                {n} <Star className={cn("size-3.5", score !== null && n <= score ? "text-soft-yellow" : "text-sg-dim")} />
              </span>
              {LABELS[n]}
            </button>
          ))}
        </div>
        <Field label="Customer comment">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What the customer said, e.g. “Fast fix, thanks for the remote reboot”" />
        </Field>
      </div>
    </Modal>
  );
}
