"use client";

import { useParams } from "next/navigation";
import { RecordView } from "@/components/crm/record/record-view";

export default function TicketRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordView type="ticket" id={decodeURIComponent(id)} />;
}
