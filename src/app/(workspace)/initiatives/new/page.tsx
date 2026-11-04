"use client";

import { useSearchParams } from "next/navigation";
import { ProposalForm } from "@/components/initiatives/proposal-form";

export default function NewInitiativePage() {
  const editId = useSearchParams().get("edit");
  return <ProposalForm editId={editId} />;
}
