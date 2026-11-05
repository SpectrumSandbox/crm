"use client";

import { useParams } from "next/navigation";
import { QuoteDocument } from "@/components/crm/quote-document";

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  return <QuoteDocument id={decodeURIComponent(id)} />;
}
