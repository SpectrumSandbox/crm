"use client";

import { useParams } from "next/navigation";
import { RecordView } from "@/components/crm/record/record-view";

export default function CompanyRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordView type="company" id={decodeURIComponent(id)} />;
}
