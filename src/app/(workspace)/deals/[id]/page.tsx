"use client";

import { useParams } from "next/navigation";
import { RecordView } from "@/components/crm/record/record-view";

export default function DealRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordView type="deal" id={decodeURIComponent(id)} />;
}
