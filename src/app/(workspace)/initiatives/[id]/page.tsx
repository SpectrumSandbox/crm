"use client";

import { useParams } from "next/navigation";
import { InitiativeDetail } from "@/components/initiatives/detail/initiative-detail";

export default function InitiativePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params?.id ?? "");
  return <InitiativeDetail key={id} id={id} />;
}
