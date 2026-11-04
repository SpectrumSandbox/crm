"use client";

import { useSearchParams } from "next/navigation";
import { ProposalForm } from "@/components/initiatives/proposal-form";

export default function NewInitiativePage() {
  const params = useSearchParams();
  const editId = params.get("edit");
  const fromDeal = params.get("fromDeal");
  // the prefill is read once on mount; after the first save the URL becomes ?edit=<id> and the same form keeps editing
  return <ProposalForm editId={editId} fromDealId={fromDeal} />;
}
