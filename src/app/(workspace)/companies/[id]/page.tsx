"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardList, Layers, Ticket as TicketIcon } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useGroupRollups } from "@/lib/selectors";
import { cn, formatIDR, relativeTime } from "@/lib/utils";
import { RecordView } from "@/components/crm/record/record-view";
import { reviewOverdue } from "../account-utils";

export default function CompanyRecordPage() {
  const { id } = useParams<{ id: string }>();
  const companyId = decodeURIComponent(id);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AccountRibbon id={companyId} />
      <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
        <RecordView type="company" id={companyId} />
      </div>
    </div>
  );
}

/**
 * Group context above the company record: whole-group roll-ups (all business units) and the account plan,
 * so a parent account shows more than its directly linked deals.
 */
function AccountRibbon({ id }: { id: string }) {
  const companies = useCrm((s) => s.companies);
  const accountPlans = useCrm((s) => s.accountPlans);
  const rollups = useGroupRollups();
  const company = companies.find((c) => c.id === id);
  if (!company) return null;

  // the top of the hierarchy this unit belongs to
  let top = company;
  for (let i = 0; i < 10 && top.parentId; i += 1) {
    const parent = companies.find((c) => c.id === top.parentId);
    if (!parent) break;
    top = parent;
  }
  const group = rollups.group.get(top.id);
  const isGroup = (group?.unitIds.length ?? 1) > 1;
  const plan = accountPlans.find((p) => p.companyId === top.id) ?? accountPlans.find((p) => p.companyId === id);
  if (!isGroup && !plan && company.tier !== "Strategic") return null;
  const overdue = plan ? reviewOverdue(plan.cadence, plan.lastReviewedAt) : false;
  const planTarget = plan?.companyId ?? top.id;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-sg-line bg-sg-card/60 px-4 py-1.5 text-2xs text-sg-muted sm:px-5">
      {isGroup && group ? (
        <>
          <span className="flex items-center gap-1.5 font-semibold text-sg-text">
            <Layers className="size-3.5 text-soft-cyan" />
            {top.id === id ? `${top.name} group` : <>Part of <Link href={`/companies/${top.id}`} className="hover:text-sg-white hover:underline">{top.name}</Link></>}
            <span className="font-normal text-sg-dim">· {group.unitIds.length} units</span>
          </span>
          <span>
            Group pipeline <b className="sg-num text-sg-white">{formatIDR(group.openPipeline)}</b> · {group.openDeals} open
          </span>
          <span>
            Won 12 mo <b className="sg-num text-soft-green">{formatIDR(group.wonTtm)}</b>
          </span>
          <span className={cn("flex items-center gap-1", group.breaches ? "text-soft-red" : undefined)}>
            <TicketIcon className="size-3" /> {group.openTickets} open {group.openTickets === 1 ? "ticket" : "tickets"}
            {group.breaches ? ` · ${group.breaches} past SLA` : ""}
          </span>
          {group.csat !== null ? <span>CSAT {group.csat.toFixed(1)}/5</span> : null}
          {group.lastAt ? <span>Last touch {relativeTime(group.lastAt)}</span> : null}
        </>
      ) : null}
      <Link href={`/companies/${planTarget}/plan`} className={cn("ml-auto flex items-center gap-1 font-semibold hover:text-sg-white", overdue ? "text-soft-orange" : "text-sg-text")}>
        <ClipboardList className="size-3.5" />
        {plan ? (overdue ? "Account plan · review due" : `Account plan · reviewed ${relativeTime(plan.lastReviewedAt)}`) : "Start an account plan"} →
      </Link>
    </div>
  );
}
