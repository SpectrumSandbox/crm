"use client";

import { useParams } from "next/navigation";
import { PrintPacket } from "@/components/initiatives/detail/print-packet";

/** Printable PRC packet (Annex A + Annex D Part 1) in a light print layout. */
export default function InitiativePrintPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params?.id ?? "");
  return <PrintPacket key={id} id={id} />;
}
