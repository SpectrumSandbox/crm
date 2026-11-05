"use client";

/* /disputes/[id] — one §14 dispute: stages, deadlines, recusal, votes, decisions and the audit trail. */
import { useParams } from "next/navigation";
import { DisputeDetail } from "@/components/me/dispute-detail";

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  return <DisputeDetail id={id} />;
}
