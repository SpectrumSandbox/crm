"use client";

import { useParams } from "next/navigation";
import { RecordView } from "@/components/crm/record/record-view";

export default function ContactRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordView type="contact" id={decodeURIComponent(id)} />;
}
