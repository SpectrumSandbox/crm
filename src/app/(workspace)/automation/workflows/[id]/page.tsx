"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Workflow } from "lucide-react";
import { useCrm } from "@/lib/store";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/misc";
import { AutomationNav } from "@/components/automation/nav";
import { WorkflowBuilder } from "@/components/automation/workflow-builder";

export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const isNew = id === "new";
  const wf = useCrm((s) => s.workflows.find((w) => w.id === id));
  const title = isNew ? "New workflow" : (wf?.name ?? "Workflow");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} crumbs={[{ href: "/automation", label: "Automation" }]} />
      <AutomationNav />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!isNew && !wf ? (
          <EmptyState icon={Workflow} title="Workflow not found">
            It may have been deleted. Check the run log or start a new one.
          </EmptyState>
        ) : (
          <WorkflowBuilder key={isNew ? "new" : id} workflowId={isNew ? null : id} openTest={params.get("test") === "1"} />
        )}
      </div>
    </div>
  );
}
